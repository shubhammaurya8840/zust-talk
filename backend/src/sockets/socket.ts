import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { Server as HttpServer } from "node:http";
import { env } from "../config/env";
import { prisma } from "../config/prisma";

export let io: Server;

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

  io.on("connection", socket => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);
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

    // --- WebRTC Audio & Video Calling Signaling ---
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

    socket.on("call:signal", (data: { toUserId: string; signal: any }) => {
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
  });

  return io;
}
