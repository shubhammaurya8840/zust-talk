import { Request, Response } from "express";
import { prisma } from "../../config/prisma";
import { HttpError } from "../../utils/http-error";
import { io, isUserOnline } from "../../sockets/socket";

const userSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  primaryLanguage: true,
  socialLinks: true,
  phone: true,
  email: true,
  lastSeenAt: true,
  createdAt: true,
};

export async function search(req: Request, res: Response) {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) throw new HttpError(400, "Search query must contain at least 2 characters");
  const cleanDigits = q.replace(/[\s-]/g, "");

  const searchConditions: any[] = [
    { username: { contains: q, mode: "insensitive" } },
    { displayName: { contains: q, mode: "insensitive" } },
    { phone: { contains: q, mode: "insensitive" } },
    { email: { contains: q, mode: "insensitive" } },
  ];

  if (cleanDigits.length >= 2 && cleanDigits !== q) {
    searchConditions.push({ phone: { contains: cleanDigits, mode: "insensitive" } });
  }

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      id: { not: req.auth!.userId },
      OR: searchConditions,
    },
    select: userSelect,
    take: 20,
  });

  res.json({
    success: true,
    users: users.map((u) => ({ ...u, isOnline: isUserOnline(u.id) })),
  });
}

export async function lookupByUsername(req: Request, res: Response) {
  const raw = String(req.params.username || "").trim().replace(/^@/, "").toLowerCase();
  if (!raw) throw new HttpError(400, "Username is required");
  const user = await prisma.user.findUnique({
    where: { username: raw },
    select: { ...userSelect, isActive: true },
  });
  if (!user || !user.isActive) throw new HttpError(404, "User not found");
  const { isActive: _isActive, ...safeUser } = user;
  res.json({
    success: true,
    user: { ...safeUser, isOnline: isUserOnline(user.id) },
  });
}

export async function getProfile(req: Request, res: Response) {
  const userId = String(req.params.userId || "").trim();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...userSelect, isActive: true },
  });
  if (!user || !user.isActive) throw new HttpError(404, "User not found");
  const { isActive: _isActive, ...safeUser } = user;
  res.json({
    success: true,
    user: { ...safeUser, isOnline: isUserOnline(user.id) },
  });
}

export async function updateMe(req: Request, res: Response) {
  const user = await prisma.user.update({
    where: { id: req.auth!.userId },
    data: req.body,
    select: userSelect,
  });
  if (io) {
    io.emit("user:updated", user);
  }
  res.json({ success: true, user: { ...user, isOnline: isUserOnline(user.id) } });
}

export async function block(req: Request, res: Response) {
  const blockedId = req.params.userId as string;
  if (blockedId === req.auth!.userId) throw new HttpError(400, "You cannot block yourself");
  await prisma.userBlock.create({ data: { blockerId: req.auth!.userId, blockedId } });
  res.status(201).json({ success: true, message: "User blocked" });
}

export async function unblock(req: Request, res: Response) {
  const blockedId = req.params.userId as string;
  await prisma.userBlock.deleteMany({ where: { blockerId: req.auth!.userId, blockedId } });
  res.json({ success: true, message: "User unblocked" });
}

export async function report(req: Request, res: Response) {
  const reportedId = req.params.userId as string;
  if (reportedId === req.auth!.userId) throw new HttpError(400, "You cannot report yourself");
  const report = await prisma.userReport.create({
    data: {
      reporterId: req.auth!.userId,
      reportedId,
      reason: req.body.reason,
      details: req.body.details,
    },
  });
  res.status(201).json({ success: true, reportId: report.id });
}
