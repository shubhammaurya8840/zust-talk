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

  it("1b. Auth - Email OTP Register, Login, Reset & Change Password + Profile Fields", async () => {
    const uniqueNum = Date.now().toString().slice(-6);
    const regUsername = `passuser_${uniqueNum}`;
    const regEmail = `pass_${uniqueNum}@example.com`;
    const regPassword = "secretPassword123";
    const resetPassword = "resetPassword456";
    const finalPassword = "finalPassword789";

    // 1. Send Registration Email OTP
    const sendOtpRes = await fetch(`${baseUrl}/api/auth/email/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: regEmail,
        purpose: "REGISTER",
      }),
    });
    expect(sendOtpRes.status).toBe(200);
    const sendOtpData = await sendOtpRes.json();
    expect(sendOtpData.success).toBe(true);
    expect(sendOtpData.devOtp).toBeDefined();

    // 2. Verify Registration Email OTP
    const verifyOtpRes = await fetch(`${baseUrl}/api/auth/email/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: regEmail,
        code: sendOtpData.devOtp,
        purpose: "REGISTER",
      }),
    });
    expect(verifyOtpRes.status).toBe(200);
    const verifyOtpData = await verifyOtpRes.json();
    expect(verifyOtpData.success).toBe(true);
    expect(verifyOtpData.verificationToken).toBeDefined();

    // 3. Complete Registration with verificationToken & primaryLanguage
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: regEmail,
        verificationToken: verifyOtpData.verificationToken,
        username: regUsername,
        displayName: "Password User",
        primaryLanguage: "hi",
        password: regPassword,
      }),
    });
    expect(regRes.status).toBe(201);
    const regData = await regRes.json();
    expect(regData.success).toBe(true);
    expect(regData.accessToken).toBeDefined();
    expect(regData.user.username).toBe(regUsername);
    expect(regData.user.primaryLanguage).toBe("hi");

    // 4. Login with correct password (using email or username)
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: regEmail,
        password: regPassword,
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.success).toBe(true);
    expect(loginData.accessToken).toBeDefined();

    // 5. Login with wrong password
    const badLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: regUsername,
        password: "wrongpassword",
      }),
    });
    expect(badLoginRes.status).toBe(401);

    // 6. Forgot Password via Email OTP
    const forgotOtpRes = await fetch(`${baseUrl}/api/auth/email/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: regEmail,
        purpose: "RESET_PASSWORD",
      }),
    });
    expect(forgotOtpRes.status).toBe(200);
    const forgotOtpData = await forgotOtpRes.json();
    expect(forgotOtpData.devOtp).toBeDefined();

    const resetRes = await fetch(`${baseUrl}/api/auth/forgot-password/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: regEmail,
        code: forgotOtpData.devOtp,
        newPassword: resetPassword,
      }),
    });
    expect(resetRes.status).toBe(200);

    // 7. Login with reset password
    const loginResetRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: regEmail,
        password: resetPassword,
      }),
    });
    expect(loginResetRes.status).toBe(200);
    const loginResetData = await loginResetRes.json();
    const userToken = loginResetData.accessToken;

    // 8. Change Password in Settings
    const changePwRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        currentPassword: resetPassword,
        newPassword: finalPassword,
      }),
    });
    expect(changePwRes.status).toBe(200);

    // 9. Update primaryLanguage & socialLinks via PATCH /api/users/me
    const patchProfileRes = await fetch(`${baseUrl}/api/users/me`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        primaryLanguage: "mr",
        socialLinks: {
          instagram: "https://instagram.com/zust_test",
          github: "github.com/zust_test",
        },
      }),
    });
    expect(patchProfileRes.status).toBe(200);
    const patchProfileData = await patchProfileRes.json();
    expect(patchProfileData.user.primaryLanguage).toBe("mr");
    expect(patchProfileData.user.socialLinks.instagram).toBe("https://instagram.com/zust_test");

    // 10. Settings: Verify / Change Gmail via OTP
    const newEmail = `changed_${uniqueNum}@example.com`;
    const sendChangeOtpRes = await fetch(`${baseUrl}/api/users/me/email/send-otp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ email: newEmail }),
    });
    expect(sendChangeOtpRes.status).toBe(200);
    const sendChangeOtpData = await sendChangeOtpRes.json();
    expect(sendChangeOtpData.devOtp).toBeDefined();

    const verifyChangeEmailRes = await fetch(`${baseUrl}/api/users/me/email/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        email: newEmail,
        code: sendChangeOtpData.devOtp,
      }),
    });
    expect(verifyChangeEmailRes.status).toBe(200);
    const verifyChangeEmailData = await verifyChangeEmailRes.json();
    expect(verifyChangeEmailData.user.email).toBe(newEmail);
    expect(verifyChangeEmailData.user.isVerified).toBe(true);

    // 11. Guest login endpoint must no longer exist
    const guestRes = await fetch(`${baseUrl}/api/auth/guest`, { method: "POST" });
    expect(guestRes.status).toBe(404);
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

    // Verify Sidebar conversations list includes readAt receipt on last message
    const convListAfterRead = await fetch(`${baseUrl}/api/conversations`, {
      headers: { Authorization: `Bearer ${user1Token}` }
    });
    expect(convListAfterRead.status).toBe(200);
    const convListData = await convListAfterRead.json();
    const targetConv = convListData.conversations.find((c: any) => c.id === directConvId);
    expect(targetConv.messages[0].receipts.some((r: any) => r.userId === user2Id && Boolean(r.readAt))).toBe(true);

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

    // Any-to-any: English -> Spanish
    const res3 = await fetch(`${baseUrl}/api/translate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: "Good morning friend",
        targetLang: "es"
      })
    });
    expect(res3.status).toBe(200);
    const data3 = await res3.json();
    expect(data3.success).toBe(true);
    expect(data3.translatedText.length).toBeGreaterThan(0);
  });

  it("12. Avatar Update, Read-Only Profile, Lookup, Archive & View-Once", async () => {
    // Update avatar on user 1
    const avRes = await fetch(`${baseUrl}/api/users/me`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ avatarUrl: "avatar:astronaut" })
    });
    expect(avRes.status).toBe(200);
    const avData = await avRes.json();
    expect(avData.user.avatarUrl).toBe("avatar:astronaut");

    // Read-only lookup by username (QR scan) & profile by ID
    const lookupRes = await fetch(`${baseUrl}/api/users/lookup/testuser1`, {
      headers: { Authorization: `Bearer ${user2Token}` }
    });
    expect(lookupRes.status).toBe(200);
    const lookupData = await lookupRes.json();
    expect(lookupData.user.username).toBe("testuser1");
    expect(lookupData.user.avatarUrl).toBe("avatar:astronaut");

    const profRes = await fetch(`${baseUrl}/api/users/${user1Id}`, {
      headers: { Authorization: `Bearer ${user2Token}` }
    });
    expect(profRes.status).toBe(200);

    // Archive & unarchive conversation
    const archRes = await fetch(`${baseUrl}/api/conversations/${directConvId}/archive`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ archived: true })
    });
    expect(archRes.status).toBe(200);
    const archData = await archRes.json();
    expect(archData.archived).toBe(true);

    const unarchRes = await fetch(`${baseUrl}/api/conversations/${directConvId}/archive`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ archived: false })
    });
    expect(unarchRes.status).toBe(200);
    expect((await unarchRes.json()).archived).toBe(false);

    // View-Once Photo: User 1 sends, User 2 opens once, second attempt returns 410 Gone
    const voSend = await fetch(`${baseUrl}/api/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        conversationId: directConvId,
        body: "Photo",
        type: "IMAGE",
        isViewOnce: true,
        attachments: [{
          originalName: "secret.jpg",
          storagePath: "/uploads/secret.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 2048
        }]
      })
    });
    expect(voSend.status).toBe(201);
    const voMsgId = (await voSend.json()).message.id;

    const firstOpen = await fetch(`${baseUrl}/api/messages/${voMsgId}/view-once`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user2Token}` }
    });
    expect(firstOpen.status).toBe(200);
    const firstOpenData = await firstOpen.json();
    expect(firstOpenData.attachments[0].storagePath).toBe("/uploads/secret.jpg");

    const secondOpen = await fetch(`${baseUrl}/api/messages/${voMsgId}/view-once`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user2Token}` }
    });
    expect(secondOpen.status).toBe(410);

    // Screenshot / Screen-Record Security Alert REST endpoint
    const ssAlertRes = await fetch(`${baseUrl}/api/conversations/${directConvId}/security-alert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind: "screenshot" }),
    });
    expect(ssAlertRes.status).toBe(201);
    const ssAlertData = await ssAlertRes.json();
    expect(ssAlertData.message.type).toBe("SYSTEM");
    expect(ssAlertData.message.body).toContain("screenshot");
  });

  it("13. Nearby Radar - Consent, 100m Radius, Privacy, Invisible Mode & Connection Requests", async () => {
    // Reset test state for idempotent runs against shared DB
    await prisma.connectionRequest.deleteMany({
      where: {
        OR: [
          { senderId: user1Id, receiverId: user2Id },
          { senderId: user2Id, receiverId: user1Id }
        ]
      }
    });
    await fetch(`${baseUrl}/api/nearby/settings`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${user1Token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ discoveryEnabled: false, invisibleMode: false })
    });
    await fetch(`${baseUrl}/api/nearby/settings`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${user2Token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ discoveryEnabled: false, invisibleMode: false })
    });

    // 1. Scanning without consent must fail with 403
    const deniedScan = await fetch(`${baseUrl}/api/nearby/scan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1Token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ latitude: 28.6139, longitude: 77.2090 })
    });
    expect(deniedScan.status).toBe(403);

    // 2. Both users enable Nearby Discovery
    const s1 = await fetch(`${baseUrl}/api/nearby/settings`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${user1Token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ discoveryEnabled: true, invisibleMode: false })
    });
    expect(s1.status).toBe(200);

    const s2 = await fetch(`${baseUrl}/api/nearby/settings`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${user2Token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ discoveryEnabled: true, invisibleMode: false })
    });
    expect(s2.status).toBe(200);

    // 3. User 2 scans ~44m away from User 1
    const scan2 = await fetch(`${baseUrl}/api/nearby/scan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user2Token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: 28.6143, longitude: 77.2090 })
    });
    expect(scan2.status).toBe(200);

    // 4. User 1 scans -> discovers User 2 with approximate distance & ZERO private fields
    const scan1 = await fetch(`${baseUrl}/api/nearby/scan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user1Token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: 28.6139, longitude: 77.2090 })
    });
    expect(scan1.status).toBe(200);
    const scan1Data = await scan1.json();
    const foundU2 = scan1Data.nearbyUsers.find((u: any) => u.id === user2Id);
    expect(foundU2).toBeDefined();
    expect(foundU2.distanceMeters).toBeLessThanOrEqual(100);
    expect(foundU2.latitude).toBeUndefined();
    expect(foundU2.longitude).toBeUndefined();
    expect(foundU2.phone).toBeUndefined();
    expect(foundU2.email).toBeUndefined();
    expect(Array.isArray(foundU2.commonGroups)).toBe(true);

    // 5. User 2 moves > 150m away -> disappears from User 1's 100m radar
    await fetch(`${baseUrl}/api/nearby/scan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user2Token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: 28.6155, longitude: 77.2090 })
    });
    const scan1Far = await fetch(`${baseUrl}/api/nearby/scan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user1Token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: 28.6139, longitude: 77.2090 })
    });
    const scan1FarData = await scan1Far.json();
    expect(scan1FarData.nearbyUsers.some((u: any) => u.id === user2Id)).toBe(false);

    // 6. User 2 moves back within 100m then enables Invisible Mode -> immediately hidden
    await fetch(`${baseUrl}/api/nearby/scan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user2Token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: 28.6141, longitude: 77.2090 })
    });
    await fetch(`${baseUrl}/api/nearby/settings`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${user2Token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ invisibleMode: true })
    });
    const scan1Inv = await fetch(`${baseUrl}/api/nearby/scan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user1Token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: 28.6139, longitude: 77.2090 })
    });
    expect((await scan1Inv.json()).nearbyUsers.some((u: any) => u.id === user2Id)).toBe(false);

    // 7. Re-enable visibility & test connection request + duplicate prevention + accept
    await fetch(`${baseUrl}/api/nearby/settings`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${user2Token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ invisibleMode: false })
    });
    const reqRes = await fetch(`${baseUrl}/api/nearby/requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user1Token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId: user2Id, message: "Hi from nearby!" })
    });
    expect(reqRes.status).toBe(201);
    const reqData = await reqRes.json();
    const requestId = reqData.request.id;

    // Duplicate request blocked
    const dupRes = await fetch(`${baseUrl}/api/nearby/requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user1Token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId: user2Id })
    });
    expect(dupRes.status).toBe(409);

    // User 2 accepts request
    const accRes = await fetch(`${baseUrl}/api/nearby/requests/${requestId}/respond`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user2Token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ACCEPT" })
    });
    expect(accRes.status).toBe(200);
    const accData = await accRes.json();
    expect(accData.conversationId).toBeDefined();

    // Clean up ephemeral nearby presence
    await fetch(`${baseUrl}/api/nearby/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user1Token}` }
    });
    await fetch(`${baseUrl}/api/nearby/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user2Token}` }
    });
  });
});
