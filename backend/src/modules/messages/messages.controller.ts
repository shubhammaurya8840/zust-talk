import { Request, Response } from "express";
import { prisma } from "../../config/prisma";
import { HttpError } from "../../utils/http-error";
import { io } from "../../sockets/socket";
import { pollInclude } from "../polls/polls.controller";

async function ensureMember(conversationId: string, userId: string) {
  const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
  if (!member) throw new HttpError(403, "You are not a member of this conversation");
}

function sanitizeViewOnceForUser(m: any, viewerId: string) {
  if (!m.isViewOnce) return m;
  if (m.senderId === viewerId) return m;
  // Hide attachment URLs from history/socket until explicitly opened via /view-once, and lock after viewedAt
  return {
    ...m,
    attachments: (m.attachments || []).map((a: any) => ({
      ...a,
      storagePath: "",
    })),
  };
}

export async function history(req: Request, res: Response) {
  const conversationId = req.params.conversationId as string;
  await ensureMember(conversationId, req.auth!.userId);
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const messages = await prisma.message.findMany({
    where: { conversationId },
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { createdAt: "desc" },
    include: { sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } }, receipts: true, attachments: true, poll: { include: pollInclude } }
  });
  const hasMore = messages.length === limit;
  const nextCursor = hasMore ? messages[messages.length - 1].id : null;
  const sorted = [...messages].reverse().map((m) => sanitizeViewOnceForUser(m, req.auth!.userId));
  res.json({ success: true, messages: sorted, nextCursor });
}

export async function send(req: Request, res: Response) {
  const { conversationId, body, ciphertext, type, replyToId, attachments, isViewOnce } = req.body;
  await ensureMember(conversationId, req.auth!.userId);

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { members: { select: { userId: true } } }
  });
  if (!conversation) throw new HttpError(404, "Conversation not found");

  if (conversation.type === "DIRECT") {
    const otherMember = conversation.members.find(m => m.userId !== req.auth!.userId);
    if (otherMember) {
      const blocked = await prisma.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: req.auth!.userId, blockedId: otherMember.userId },
            { blockerId: otherMember.userId, blockedId: req.auth!.userId }
          ]
        }
      });
      if (blocked) throw new HttpError(403, "Cannot send messages to this user");
    }
  }

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: req.auth!.userId,
      body: ciphertext ? null : body,
      ciphertext,
      type,
      isViewOnce: Boolean(isViewOnce),
      replyToId,
      attachments: attachments?.length ? {
        create: attachments.map((a: { originalName: string; storagePath: string; mimeType: string; sizeBytes: number }) => ({
          originalName: a.originalName,
          storagePath: a.storagePath,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes
        }))
      } : undefined,
      receipts: {
        create: conversation.members
          .filter(m => m.userId !== req.auth!.userId)
          .map(m => ({ userId: m.userId }))
      }
    },
    include: { sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } }, receipts: true, attachments: true, poll: { include: pollInclude } }
  });

  if (io) {
    for (const m of conversation.members) {
      const sanitized = sanitizeViewOnceForUser(message, m.userId);
      io.to(`user:${m.userId}`).emit("message:new", sanitized);
      if (m.userId !== req.auth!.userId) {
        io.to(`user:${m.userId}`).emit("conversation:updated", { conversationId, lastMessage: sanitized });
      }
    }
  }

  await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  res.status(201).json({ success: true, message });
}

export async function openViewOnce(req: Request, res: Response) {
  const messageId = req.params.messageId as string;
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { attachments: true, sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } } }
  });
  if (!message) throw new HttpError(404, "Message not found");
  await ensureMember(message.conversationId, req.auth!.userId);
  if (!message.isViewOnce) throw new HttpError(400, "Not a view-once message");
  if (message.senderId === req.auth!.userId) {
    return res.json({ success: true, attachments: message.attachments, viewedAt: message.viewedAt, alreadyOpened: Boolean(message.viewedAt) });
  }
  if (message.viewedAt) {
    throw new HttpError(410, "This view-once photo has already been opened");
  }

  const now = new Date();
  const updatedCount = await prisma.message.updateMany({
    where: { id: messageId, viewedAt: null },
    data: { viewedAt: now },
  });
  if (updatedCount.count === 0) {
    throw new HttpError(410, "This view-once photo has already been opened");
  }

  const updated = await prisma.message.findUnique({
    where: { id: messageId },
    include: { sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } }, receipts: true, attachments: true, poll: { include: pollInclude } }
  });

  if (io && updated) {
    io.to(`conversation:${message.conversationId}`).emit("message:updated", {
      ...updated,
      attachments: (updated.attachments || []).map((a) => ({ ...a, storagePath: "" })),
    });
  }

  res.json({ success: true, attachments: message.attachments, viewedAt: now.toISOString() });
}

export async function edit(req: Request, res: Response) {
  const messageId = req.params.messageId as string;
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw new HttpError(404, "Message not found");
  if (message.senderId !== req.auth!.userId) throw new HttpError(403, "You can only edit your own messages");
  if (message.deletedAt) throw new HttpError(400, "Deleted messages cannot be edited");
  const updated = await prisma.message.update({ where: { id: message.id }, data: { body: req.body.body, editedAt: new Date() } });
  if (io) io.to(`conversation:${message.conversationId}`).emit("message:updated", updated);
  res.json({ success: true, message: updated });
}

export async function remove(req: Request, res: Response) {
  const messageId = req.params.messageId as string;
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw new HttpError(404, "Message not found");
  if (message.senderId !== req.auth!.userId) throw new HttpError(403, "You can only delete your own messages");
  const updated = await prisma.message.update({ where: { id: message.id }, data: { body: null, ciphertext: null, deletedAt: new Date() } });
  if (io) io.to(`conversation:${message.conversationId}`).emit("message:deleted", { id: message.id, conversationId: message.conversationId });
  res.json({ success: true, message: updated });
}

export async function markRead(req: Request, res: Response) {
  const messageId = req.params.messageId as string;
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw new HttpError(404, "Message not found");
  await ensureMember(message.conversationId, req.auth!.userId);
  const now = new Date();
  if (message.senderId !== req.auth!.userId) {
    await prisma.messageReceipt.updateMany({ where: { messageId: message.id, userId: req.auth!.userId }, data: { deliveredAt: now, readAt: now } });
  }
  await prisma.conversationMember.updateMany({ where: { conversationId: message.conversationId, userId: req.auth!.userId }, data: { lastReadAt: now } });
  if (io) {
    const payload = { conversationId: message.conversationId, messageId: message.id, userId: req.auth!.userId, readAt: now };
    io.to(`conversation:${message.conversationId}`).emit("message:receipt", payload);
    const members = await prisma.conversationMember.findMany({ where: { conversationId: message.conversationId }, select: { userId: true } });
    for (const m of members) {
      io.to(`user:${m.userId}`).emit("message:receipt", payload);
    }
  }
  res.json({ success: true });
}

export async function markConversationRead(req: Request, res: Response) {
  const conversationId = req.params.conversationId as string;
  await ensureMember(conversationId, req.auth!.userId);
  const now = new Date();

  await prisma.messageReceipt.updateMany({
    where: {
      message: { conversationId, senderId: { not: req.auth!.userId } },
      userId: req.auth!.userId,
      readAt: null
    },
    data: { deliveredAt: now, readAt: now }
  });

  await prisma.conversationMember.updateMany({
    where: { conversationId, userId: req.auth!.userId },
    data: { lastReadAt: now }
  });

  if (io) {
    const payload = {
      conversationId,
      userId: req.auth!.userId,
      readAt: now
    };
    io.to(`conversation:${conversationId}`).emit("conversation:read", payload);
    const members = await prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true }
    });
    for (const m of members) {
      io.to(`user:${m.userId}`).emit("conversation:read", payload);
    }
  }

  res.json({ success: true });
}
