import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import app from "../src/app";
import { prisma } from "../src/config/prisma";

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

describe("India Chat Backend API Tests", () => {
  let user1Token: string;
  let user1RefreshToken: string;
  let user1Id: string;

  let user2Token: string;
  let user2Id: string;

  let directConvId: string;
  let groupConvId: string;
  let messageId: string;

  it("1. Health Check", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.status).toBe("healthy");
  });

  it("1b. Auth - Register & Login with ID & Password", async () => {
    const uniqueNum = Date.now().toString().slice(-6);
    const regUsername = `passuser_${uniqueNum}`;
    const regPassword = "secretPassword123";

    // 1. Register
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: regUsername,
        displayName: "Password User",
        password: regPassword,
        identifier: `pass_${uniqueNum}@example.com`,
      }),
    });
    expect(regRes.status).toBe(201);
    const regData = await regRes.json();
    expect(regData.success).toBe(true);
    expect(regData.accessToken).toBeDefined();
    expect(regData.user.username).toBe(regUsername);

    // 2. Login with correct password
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: regUsername,
        password: regPassword,
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.success).toBe(true);
    expect(loginData.accessToken).toBeDefined();

    // 3. Login with wrong password
    const badLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: regUsername,
        password: "wrongpassword",
      }),
    });
    expect(badLoginRes.status).toBe(401);
  });

  it("2. Auth - Request OTP for User 1", async () => {
    const res = await fetch(`${baseUrl}/api/auth/otp/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination: "testuser1@example.com" })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.devOtp).toBeDefined();

    // Verify OTP
    const verifyRes = await fetch(`${baseUrl}/api/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination: "testuser1@example.com",
        code: data.devOtp,
        username: "testuser1",
        displayName: "Test User One"
      })
    });
    expect(verifyRes.status).toBe(200);
    const verifyData = await verifyRes.json();
    expect(verifyData.success).toBe(true);
    expect(verifyData.accessToken).toBeDefined();
    expect(verifyData.user.id).toBeDefined();

    user1Token = verifyData.accessToken;
    user1RefreshToken = verifyData.refreshToken;
    user1Id = verifyData.user.id;
  });

  it("3. Auth - Request & Verify OTP for User 2", async () => {
    const res = await fetch(`${baseUrl}/api/auth/otp/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination: "+919876543210" })
    });
    const data = await res.json();

    const verifyRes = await fetch(`${baseUrl}/api/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination: "+919876543210",
        code: data.devOtp,
        username: "testuser2",
        displayName: "Test User Two"
      })
    });
    const verifyData = await verifyRes.json();
    user2Token = verifyData.accessToken;
    user2Id = verifyData.user.id;
    expect(user2Token).toBeDefined();
  });

  it("4. Auth - Me & Refresh Token", async () => {
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${user1Token}` }
    });
    expect(meRes.status).toBe(200);
    const meData = await meRes.json();
    expect(meData.user.username).toBe("testuser1");

    const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: user1RefreshToken })
    });
    expect(refreshRes.status).toBe(200);
    const refreshData = await refreshRes.json();
    expect(refreshData.accessToken).toBeDefined();
    user1Token = refreshData.accessToken;
  });

  it("5. Users - Search & Update Me", async () => {
    const updateRes = await fetch(`${baseUrl}/api/users/me`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ bio: "Namaste India!" })
    });
    expect(updateRes.status).toBe(200);
    const updateData = await updateRes.json();
    expect(updateData.user.bio).toBe("Namaste India!");

    const searchRes = await fetch(`${baseUrl}/api/users/search?q=testuser2`, {
      headers: { Authorization: `Bearer ${user1Token}` }
    });
    expect(searchRes.status).toBe(200);
    const searchData = await searchRes.json();
    expect(searchData.users.length).toBeGreaterThan(0);
    expect(searchData.users[0].id).toBe(user2Id);
  });

  it("6. Conversations - Create Direct & Get By ID", async () => {
    const convRes = await fetch(`${baseUrl}/api/conversations/direct`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ userId: user2Id })
    });
    expect(convRes.status === 200 || convRes.status === 201).toBe(true);
    const convData = await convRes.json();
    expect(convData.conversation.id).toBeDefined();
    directConvId = convData.conversation.id;

    // Get by ID
    const getRes = await fetch(`${baseUrl}/api/conversations/${directConvId}`, {
      headers: { Authorization: `Bearer ${user1Token}` }
    });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.conversation.id).toBe(directConvId);
  });

  it("7. Conversations - Create Group, Update Title, & List Members", async () => {
    const groupRes = await fetch(`${baseUrl}/api/conversations/group`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: "Chai Pe Charcha",
        memberIds: [user2Id]
      })
    });
    expect(groupRes.status).toBe(201);
    const groupData = await groupRes.json();
    groupConvId = groupData.conversation.id;

    // Update group title
    const updateRes = await fetch(`${baseUrl}/api/conversations/${groupConvId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title: "Chai Pe Charcha VIP" })
    });
    expect(updateRes.status).toBe(200);
    const updateData = await updateRes.json();
    expect(updateData.conversation.title).toBe("Chai Pe Charcha VIP");

    // Members
    const membersRes = await fetch(`${baseUrl}/api/conversations/${groupConvId}/members`, {
      headers: { Authorization: `Bearer ${user1Token}` }
    });
    expect(membersRes.status).toBe(200);
    const membersData = await membersRes.json();
    expect(membersData.members.length).toBe(2);
  });

  it("8. Messages - Send Message with Attachment", async () => {
    const sendRes = await fetch(`${baseUrl}/api/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        conversationId: directConvId,
        body: "Hello from User 1!",
        type: "TEXT",
        attachments: [
          {
            originalName: "invoice.pdf",
            storagePath: "uploads/invoice.pdf",
            mimeType: "application/pdf",
            sizeBytes: 10240
          }
        ]
      })
    });
    expect(sendRes.status).toBe(201);
    const sendData = await sendRes.json();
    expect(sendData.message.id).toBeDefined();
    expect(sendData.message.attachments.length).toBe(1);
    expect(sendData.message.attachments[0].originalName).toBe("invoice.pdf");
    messageId = sendData.message.id;
  });

  it("9. Messages - History, Edit, Mark Read, Delete", async () => {
    // History
    const historyRes = await fetch(`${baseUrl}/api/messages/conversation/${directConvId}`, {
      headers: { Authorization: `Bearer ${user1Token}` }
    });
    expect(historyRes.status).toBe(200);
    const historyData = await historyRes.json();
    expect(historyData.messages.length).toBeGreaterThan(0);

    // Edit
    const editRes = await fetch(`${baseUrl}/api/messages/${messageId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ body: "Hello from User 1 (edited)!" })
    });
    expect(editRes.status).toBe(200);
    const editData = await editRes.json();
    expect(editData.message.body).toBe("Hello from User 1 (edited)!");

    // Mark Read by User 2
    const readRes = await fetch(`${baseUrl}/api/messages/${messageId}/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user2Token}` }
    });
    expect(readRes.status).toBe(200);

    // Remove
    const deleteRes = await fetch(`${baseUrl}/api/messages/${messageId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${user1Token}` }
    });
    expect(deleteRes.status).toBe(200);
  });

  it("10. User Blocking - Block Prevents Messaging", async () => {
    // User 2 blocks User 1
    const blockRes = await fetch(`${baseUrl}/api/users/${user1Id}/block`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user2Token}` }
    });
    expect(blockRes.status).toBe(201);

    // User 1 tries to send message to direct conversation
    const sendBlockedRes = await fetch(`${baseUrl}/api/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        conversationId: directConvId,
        body: "Are you there?"
      })
    });
    expect(sendBlockedRes.status).toBe(403);

    // User 2 unblocks User 1
    const unblockRes = await fetch(`${baseUrl}/api/users/${user1Id}/block`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${user2Token}` }
    });
    expect(unblockRes.status).toBe(200);
  });

  it("11. Translate - Hindi & Hinglish to English", async () => {
    const res1 = await fetch(`${baseUrl}/api/translate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: "kaise ho bhai",
        targetLang: "en"
      })
    });
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.success).toBe(true);
    expect(typeof data1.translatedText).toBe("string");
    expect(data1.translatedText.length).toBeGreaterThan(0);

    const res2 = await fetch(`${baseUrl}/api/translate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: "नमस्ते, मैं घर जा रहा हूँ",
        targetLang: "en"
      })
    });
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.success).toBe(true);
    expect(data2.detectedSource).toBe("hi");
  });
});
