import { Request, Response } from "express";
import { ConversationType, MemberRole } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { HttpError } from "../../utils/http-error";

async function assertMember(conversationId: string, userId: string) {
  const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
  if (!member) throw new HttpError(403, "You are not a member of this conversation");
  return member;
}

export async function list(req: Request, res: Response) {
  const rows = await prisma.conversation.findMany({
    where: { members: { some: { userId: req.auth!.userId } } },
    include: { members: { include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" }
  });
  res.json({ success: true, conversations: rows });
}

export async function getById(req: Request, res: Response) {
  const conversationId = req.params.conversationId as string;
  await assertMember(conversationId, req.auth!.userId);
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      members: { include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  if (!conversation) throw new HttpError(404, "Conversation not found");
  res.json({ success: true, conversation });
}

export async function createDirect(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const otherId = req.body.userId as string;
  if (userId === otherId) throw new HttpError(400, "Cannot create a conversation with yourself");
  const other = await prisma.user.findUnique({ where: { id: otherId } });
  if (!other || !other.isActive) throw new HttpError(404, "User not found");
  const blocked = await prisma.userBlock.findFirst({ where: { OR: [{ blockerId: userId, blockedId: otherId }, { blockerId: otherId, blockedId: userId }] } });
  if (blocked) throw new HttpError(403, "Conversation cannot be created because a user has blocked the other");
  const existing = await prisma.conversation.findFirst({
    where: { type: ConversationType.DIRECT, AND: [{ members: { some: { userId } } }, { members: { some: { userId: otherId } } }] },
    include: { members: { include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } } }
  });
  if (existing) return res.json({ success: true, conversation: existing, existing: true });
  const conversation = await prisma.conversation.create({
    data: { type: ConversationType.DIRECT, members: { create: [{ userId, role: MemberRole.OWNER }, { userId: otherId }] } },
    include: { members: { include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } } }
  });
  res.status(201).json({ success: true, conversation });
}

export async function createGroup(req: Request, res: Response) {
  const ids = [...new Set([req.auth!.userId, ...(req.body.memberIds as string[])])];
  const found = await prisma.user.count({ where: { id: { in: ids }, isActive: true } });
  if (found !== ids.length) throw new HttpError(400, "One or more members do not exist or are inactive");
  const conversation = await prisma.conversation.create({
    data: { type: ConversationType.GROUP, title: req.body.title, members: { create: ids.map(id => ({ userId: id, role: id === req.auth!.userId ? MemberRole.OWNER : MemberRole.MEMBER })) } },
    include: { members: { include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } } }
  });
  res.status(201).json({ success: true, conversation });
}

export async function updateGroup(req: Request, res: Response) {
  const conversationId = req.params.conversationId as string;
  const currentMember = await assertMember(conversationId, req.auth!.userId);
  if (currentMember.role === MemberRole.MEMBER) throw new HttpError(403, "Only admins or owners can update group details");
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { title: req.body.title }
  });
  res.json({ success: true, conversation: updated });
}

export async function members(req: Request, res: Response) {
  const conversationId = req.params.conversationId as string;
  await assertMember(conversationId, req.auth!.userId);
  const members = await prisma.conversationMember.findMany({ where: { conversationId }, include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } });
  res.json({ success: true, members });
}

export async function addMember(req: Request, res: Response) {
  const conversationId = req.params.conversationId as string;
  const currentMember = await assertMember(conversationId, req.auth!.userId);
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || conversation.type !== ConversationType.GROUP) throw new HttpError(400, "Members can only be added to group conversations");
  if (currentMember.role === MemberRole.MEMBER) throw new HttpError(403, "Only admins or owners can add members");

  const targetUserId = req.body.userId as string;
  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser || !targetUser.isActive) throw new HttpError(404, "User not found or inactive");

  const alreadyMember = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId: targetUserId } } });
  if (alreadyMember) throw new HttpError(400, "User is already a member of this conversation");

  const newMember = await prisma.conversationMember.create({
    data: { conversationId, userId: targetUserId, role: MemberRole.MEMBER },
    include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } }
  });
  res.status(201).json({ success: true, member: newMember });
}

export async function removeMember(req: Request, res: Response) {
  const conversationId = req.params.conversationId as string;
  const targetUserId = req.params.userId as string;
  const currentMember = await assertMember(conversationId, req.auth!.userId);
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || conversation.type !== ConversationType.GROUP) throw new HttpError(400, "Members can only be removed from group conversations");

  // Allowing self-removal (leaving) or removal by OWNER/ADMIN
  if (targetUserId !== req.auth!.userId && currentMember.role === MemberRole.MEMBER) {
    throw new HttpError(403, "Only admins or owners can remove other members");
  }

  await prisma.conversationMember.delete({
    where: { conversationId_userId: { conversationId, userId: targetUserId } }
  });
  res.json({ success: true, message: "Member removed" });
}
