import { Request, Response } from "express";
import { prisma } from "../../config/prisma";
import { HttpError } from "../../utils/http-error";
import { io } from "../../sockets/socket";

async function ensureMember(conversationId: string, userId: string) {
  const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
  if (!member) throw new HttpError(403, "You are not a member of this conversation");
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
    include: { sender: { select: { id: true, username: true, displayName: true } }, receipts: true, attachments: true }
  });
  const hasMore = messages.length === limit;
  const nextCursor = hasMore ? messages[messages.length - 1].id : null;
  const sorted = [...messages].reverse();
  res.json({ success: true, messages: sorted, nextCursor });
}

export async function send(req: Request, res: Response) {
  const { conversationId, body, ciphertext, type, replyToId, attachments } = req.body;
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
    include: { sender: { select: { id: true, username: true, displayName: true } }, receipts: true, attachments: true }
  });

  if (io) {
    io.to(`conversation:${conversationId}`).emit("message:new", message);
    for (const m of conversation.members) {
      if (m.userId !== req.auth!.userId) {
        io.to(`user:${m.userId}`).emit("conversation:updated", { conversationId, lastMessage: message });
      }
    }
  }

  await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  res.status(201).json({ success: true, message });
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
  await prisma.messageReceipt.updateMany({ where: { messageId: message.id, userId: req.auth!.userId }, data: { deliveredAt: new Date(), readAt: new Date() } });
  await prisma.conversationMember.updateMany({ where: { conversationId: message.conversationId, userId: req.auth!.userId }, data: { lastReadAt: new Date() } });
  if (io) io.to(`conversation:${message.conversationId}`).emit("message:receipt", { messageId: message.id, userId: req.auth!.userId, readAt: new Date() });
  res.json({ success: true });
}

export async function markConversationRead(req: Request, res: Response) {
  const conversationId = req.params.conversationId as string;
  await ensureMember(conversationId, req.auth!.userId);
  const now = new Date();

  await prisma.messageReceipt.updateMany({
    where: {
      message: { conversationId },
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
    io.to(`conversation:${conversationId}`).emit("conversation:read", {
      conversationId,
      userId: req.auth!.userId,
      readAt: now
    });
  }

  res.json({ success: true });
}
