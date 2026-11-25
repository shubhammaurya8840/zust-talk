import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { Server as HttpServer } from "node:http";
import { env } from "../config/env";
import { prisma } from "../config/prisma";

export let io: Server;

// Track active socket IDs per userId for real-time online/last-seen presence
const onlineUsers = new Map<string, Set<string>>();

// Track active group calls: conversationId -> Map<userId, { displayName, avatarUrl }>
const activeGroupCalls = new Map<string, Map<string, { displayName: string; avatarUrl?: string | null }>>();

export function isUserOnline(userId: string): boolean {
  const set = onlineUsers.get(userId);
  return Boolean(set && set.size > 0);
}

export function getOnlineUserIds(): string[] {
  return Array.from(onlineUsers.keys());
}

export function initializeSocket(server: HttpServer) {
  io = new Server(server, {
    cors: { origin: env.CLIENT_ORIGIN === "*" ? true : env.CLIENT_ORIGIN.split(",").map(s => s.trim()), credentials: true }
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error("Authentication required"));
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
      if (typeof payload.sub !== "string") return next(new Error("Invalid token"));
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error("Invalid or expired access token"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);

    // Mark user online
    let userSockets = onlineUsers.get(userId);
    const wasOffline = !userSockets || userSockets.size === 0;
    if (!userSockets) {
      userSockets = new Set();
      onlineUsers.set(userId, userSockets);
    }
    userSockets.add(socket.id);

    const now = new Date();
    prisma.user.update({ where: { id: userId }, data: { lastSeenAt: now } }).catch(() => {});

    if (wasOffline) {
      io.emit("presence:update", { userId, isOnline: true, lastSeenAt: now.toISOString() });
    }

    socket.on("presence:sync", async (userIds: string[], ack?: (res: unknown) => void) => {
      if (!Array.isArray(userIds)) return ack?.({});
      const cleanIds = userIds.filter((id): id is string => typeof id === "string").slice(0, 100);
      const users = await prisma.user.findMany({
        where: { id: { in: cleanIds } },
        select: { id: true, lastSeenAt: true }
      });
      const map: Record<string, { isOnline: boolean; lastSeenAt: string | null }> = {};
      for (const u of users) {
        map[u.id] = {
          isOnline: isUserOnline(u.id),
          lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null
        };
      }
      ack?.(map);
    });

    socket.on("conversation:join", async (conversationId: string, ack?: (result: unknown) => void) => {
      if (typeof conversationId !== "string") return ack?.({ success: false, message: "Invalid conversation ID" });
      const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
      if (!member) return ack?.({ success: false, message: "Not a conversation member" });
      socket.join(`conversation:${conversationId}`);
      ack?.({ success: true });
    });

    socket.on("conversation:leave", (conversationId: string, ack?: (result: unknown) => void) => {
      if (typeof conversationId === "string") {
        socket.leave(`conversation:${conversationId}`);
        ack?.({ success: true });
      }
    });

    // Nearby Radar watcher room for instant real-time radar updates
    socket.on("nearby:join", () => {
      socket.join("nearby:watchers");
    });

    socket.on("nearby:leave", () => {
      socket.leave("nearby:watchers");
    });

    socket.on("typing:start", async (conversationId: string) => {
      const members = await prisma.conversationMember.findMany({
        where: { conversationId },
        include: { user: { select: { displayName: true, username: true } } }
      });
      const sender = members.find(m => m.userId === userId);
      if (sender) {
        const payload = {
          conversationId,
          userId,
          displayName: sender.user.displayName || sender.user.username,
          username: sender.user.username
        };
        socket.to(`conversation:${conversationId}`).emit("typing:start", payload);
        for (const m of members) {
          if (m.userId !== userId) {
            socket.to(`user:${m.userId}`).emit("typing:start", payload);
          }
        }
      }
    });

    socket.on("typing:stop", async (conversationId: string) => {
      const members = await prisma.conversationMember.findMany({
        where: { conversationId },
        select: { userId: true }
      });
      const payload = { conversationId, userId };
      socket.to(`conversation:${conversationId}`).emit("typing:stop", payload);
      for (const m of members) {
        if (m.userId !== userId) {
          socket.to(`user:${m.userId}`).emit("typing:stop", payload);
        }
      }
    });

    // --- Screenshot / Screen Recording Detection Alert ---
    socket.on("chat:security_alert", async (data: { conversationId: string; kind: "screenshot" | "screen_record" }) => {
      if (!data?.conversationId) return;
      try {
        const member = await prisma.conversationMember.findUnique({
          where: { conversationId_userId: { conversationId: data.conversationId, userId } },
          include: { user: { select: { displayName: true, username: true } } }
        });
        if (!member) return;

        const actorName = member.user.displayName || member.user.username;
        const alertBody =
          data.kind === "screen_record"
            ? `🚨 ${actorName} started screen recording this chat`
            : `📸 ${actorName} took a screenshot of this chat`;

        const systemMsg = await prisma.message.create({
          data: {
            conversationId: data.conversationId,
            senderId: userId,
            body: alertBody,
            type: "SYSTEM",
          },
          include: {
            sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
            receipts: true,
            attachments: true
          }
        });

        io.to(`conversation:${data.conversationId}`).emit("message:new", systemMsg);
      } catch (err) {
        console.error("Failed to create security alert:", err);
      }
    });

    // --- 1-on-1 WebRTC Audio & Video Calling Signaling ---
    socket.on("call:initiate", (data: { toUserId: string; callerName: string; callerAvatar?: string; isVideo: boolean; conversationId: string }) => {
      if (!data?.toUserId) return;
      socket.to(`user:${data.toUserId}`).emit("call:incoming", {
        fromUserId: userId,
        callerName: data.callerName,
        callerAvatar: data.callerAvatar,
        isVideo: data.isVideo,
        conversationId: data.conversationId
      });
    });

    socket.on("call:signal", (data: { toUserId: string; signal: unknown }) => {
      if (!data?.toUserId) return;
      socket.to(`user:${data.toUserId}`).emit("call:signal", {
        fromUserId: userId,
        signal: data.signal
      });
    });

    socket.on("call:accept", (data: { toUserId: string }) => {
      if (!data?.toUserId) return;
      socket.to(`user:${data.toUserId}`).emit("call:accepted", {
        fromUserId: userId
      });
    });

    socket.on("call:reject", (data: { toUserId: string; reason?: string }) => {
      if (!data?.toUserId) return;
      socket.to(`user:${data.toUserId}`).emit("call:rejected", {
        fromUserId: userId,
        reason: data.reason || "declined"
      });
    });

    socket.on("call:end", (data: { toUserId: string }) => {
      if (!data?.toUserId) return;
      socket.to(`user:${data.toUserId}`).emit("call:ended", {
        fromUserId: userId
      });
    });

    // --- Group WebRTC Mesh Calling Signaling ---
    socket.on("group-call:start", async (data: { conversationId: string; conversationTitle?: string; callerName: string; callerAvatar?: string | null; isVideo: boolean }) => {
      if (!data?.conversationId) return;
      const members = await prisma.conversationMember.findMany({
        where: { conversationId: data.conversationId },
        select: { userId: true }
      });
      if (!members.some(m => m.userId === userId)) return;

      for (const m of members) {
        if (m.userId !== userId) {
          socket.to(`user:${m.userId}`).emit("group-call:incoming", {
            conversationId: data.conversationId,
            conversationTitle: data.conversationTitle || "Group Call",
            fromUserId: userId,
            callerName: data.callerName,
            callerAvatar: data.callerAvatar,
            isVideo: data.isVideo
          });
        }
      }
    });

    socket.on("group-call:join", async (data: { conversationId: string; displayName: string; avatarUrl?: string | null }, ack?: (res: unknown) => void) => {
      if (!data?.conversationId) return;
      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: data.conversationId, userId } }
      });
      if (!member) return ack?.({ success: false, participants: [] });

      let roomMap = activeGroupCalls.get(data.conversationId);
      if (!roomMap) {
        roomMap = new Map();
        activeGroupCalls.set(data.conversationId, roomMap);
      }

      const existingParticipants = Array.from(roomMap.entries())
        .filter(([uid]) => uid !== userId)
        .map(([uid, info]) => ({ userId: uid, ...info }));

      roomMap.set(userId, { displayName: data.displayName, avatarUrl: data.avatarUrl });
      socket.join(`group-call:${data.conversationId}`);

      socket.to(`group-call:${data.conversationId}`).emit("group-call:user-joined", {
        conversationId: data.conversationId,
        userId,
        displayName: data.displayName,
        avatarUrl: data.avatarUrl
      });

      ack?.({ success: true, participants: existingParticipants });
    });

    socket.on("group-call:signal", (data: { conversationId: string; toUserId: string; signal: unknown }) => {
      if (!data?.toUserId || !data?.conversationId) return;
      socket.to(`user:${data.toUserId}`).emit("group-call:signal", {
        conversationId: data.conversationId,
        fromUserId: userId,
        signal: data.signal
      });
    });

    socket.on("group-call:leave", (data: { conversationId: string }) => {
      if (!data?.conversationId) return;
      const roomMap = activeGroupCalls.get(data.conversationId);
      if (roomMap) {
        roomMap.delete(userId);
        if (roomMap.size === 0) activeGroupCalls.delete(data.conversationId);
      }
      socket.leave(`group-call:${data.conversationId}`);
      socket.to(`group-call:${data.conversationId}`).emit("group-call:user-left", {
        conversationId: data.conversationId,
        userId
      });
    });

    socket.on("disconnect", () => {
      const set = onlineUsers.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          onlineUsers.delete(userId);
          const lastSeen = new Date();
          prisma.user.update({ where: { id: userId }, data: { lastSeenAt: lastSeen } }).catch(() => {});
          io.emit("presence:update", { userId, isOnline: false, lastSeenAt: lastSeen.toISOString() });

          // Immediately expire ephemeral nearby presence when user disconnects
          prisma.nearbyPresence.deleteMany({ where: { userId } })
            .then((del) => {
              if (del.count > 0) {
                io.to("nearby:watchers").emit("nearby:users-removed", { userIds: [userId] });
              }
            })
            .catch(() => {});
        }
      }

      // Remove user from any active group calls
      for (const [convId, roomMap] of activeGroupCalls.entries()) {
        if (roomMap.has(userId)) {
          roomMap.delete(userId);
          if (roomMap.size === 0) activeGroupCalls.delete(convId);
          io.to(`group-call:${convId}`).emit("group-call:user-left", {
            conversationId: convId,
            userId
          });
        }
      }
    });
  });

  return io;
}
