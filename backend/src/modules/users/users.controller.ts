import { Request, Response } from "express";
import crypto from "node:crypto";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { HttpError } from "../../utils/http-error";
import { io, isUserOnline } from "../../sockets/socket";
import { sendOtpEmail } from "../../utils/mailer";

const hashOtp = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

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
  isVerified: true,
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

export async function sendEmailVerificationOtp(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const cleanEmail = String(req.body.email).trim().toLowerCase();

  const conflict = await prisma.user.findFirst({
    where: {
      email: cleanEmail,
      id: { not: userId },
    },
    select: { id: true },
  });
  if (conflict) {
    throw new HttpError(409, "This email is already linked to another account.");
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const destination = `USER_EMAIL:${userId}:${cleanEmail}`;

  await prisma.otpChallenge.create({
    data: {
      destination,
      codeHash: hashOtp(code),
      expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000),
    },
  });

  const delivery = await sendOtpEmail({ to: cleanEmail, code, purpose: "VERIFY_EMAIL" });
  const isRealDelivery =
    delivery.mode === "webhook" ||
    delivery.mode === "brevo" ||
    delivery.mode === "resend" ||
    delivery.mode === "smtp";

  if (delivery.mode === "failed" && env.DEV_RETURN_OTP !== "true") {
    throw new HttpError(502, delivery.error || "Unable to send verification OTP right now.");
  }

  const response: Record<string, unknown> = {
    success: true,
    message: isRealDelivery
      ? `Verification OTP sent to ${cleanEmail}. Check your inbox or spam.`
      : delivery.mode === "failed"
        ? `${delivery.error || "Email server unavailable."} Use Test OTP below.`
        : `Verification OTP generated for ${cleanEmail}.`,
    deliveryMode: delivery.mode,
  };

  if (!isRealDelivery) {
    response.devOtp = code;
    if (delivery.previewUrl) response.previewUrl = delivery.previewUrl;
  }

  res.status(200).json(response);
}

export async function verifyAndUpdateEmail(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const cleanEmail = String(req.body.email).trim().toLowerCase();
  const code = String(req.body.code).trim();
  const destination = `USER_EMAIL:${userId}:${cleanEmail}`;

  const challenge = await prisma.otpChallenge.findFirst({
    where: { destination, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge || challenge.codeHash !== hashOtp(code)) {
    throw new HttpError(400, "Invalid or expired verification OTP");
  }

  const conflict = await prisma.user.findFirst({
    where: { email: cleanEmail, id: { not: userId } },
    select: { id: true },
  });
  if (conflict) {
    throw new HttpError(409, "This email is already linked to another account.");
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { email: cleanEmail, isVerified: true },
    select: userSelect,
  });

  if (io) {
    io.emit("user:updated", updated);
  }

  res.json({
    success: true,
    message: "Gmail verified & saved successfully!",
    user: { ...updated, isOnline: isUserOnline(updated.id) },
  });
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
