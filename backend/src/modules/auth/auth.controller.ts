import { Request, Response } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { HttpError } from "../../utils/http-error";

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const isEmail = (value: string) => value.includes("@");

function makeTokens(userId: string, sessionId: string) {
  const accessToken = jwt.sign({ sid: sessionId }, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"] });
  const refreshToken = jwt.sign({ sid: sessionId, type: "refresh" }, env.JWT_REFRESH_SECRET, { subject: userId, expiresIn: `${env.REFRESH_TOKEN_DAYS}d` });
  return { accessToken, refreshToken };
}

export async function checkUsername(req: Request, res: Response) {
  const username = String(req.query.username || "").trim().toLowerCase();
  if (!username || username.length < 3) throw new HttpError(400, "Username must be at least 3 characters");
  if (!/^[a-zA-Z0-9_]+$/.test(username)) throw new HttpError(400, "Username can only contain letters, numbers, and underscores");
  const existing = await prisma.user.findUnique({ where: { username } });
  res.json({ success: true, available: !existing });
}

export async function register(req: Request, res: Response) {
  const { username, displayName, password } = req.body;
  const cleanUsername = String(username).trim().toLowerCase();
  const cleanDisplayName = String(displayName).trim();
  const rawIdentifier = req.body.identifier ? String(req.body.identifier).trim() : undefined;

  let email = req.body.email ? String(req.body.email).trim().toLowerCase() : undefined;
  let phone = req.body.phone ? String(req.body.phone).trim() : undefined;

  if (rawIdentifier) {
    if (rawIdentifier.includes("@")) {
      email = rawIdentifier.toLowerCase();
    } else {
      phone = rawIdentifier;
    }
  }

  // Check unique username
  const existingUser = await prisma.user.findUnique({ where: { username: cleanUsername } });
  if (existingUser) {
    throw new HttpError(409, "Username already exists. Please choose another username.");
  }

  if (email) {
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      throw new HttpError(409, "An account with this email already exists.");
    }
  }

  if (phone) {
    const existingPhone = await prisma.user.findUnique({ where: { phone } });
    if (existingPhone) {
      throw new HttpError(409, "An account with this phone number already exists.");
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      username: cleanUsername,
      displayName: cleanDisplayName,
      email: email || null,
      phone: phone || null,
      passwordHash,
      isVerified: true,
      isActive: true,
    },
  });

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: "pending",
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400_000),
    },
  });
  const tokens = makeTokens(user.id, session.id);
  await prisma.session.update({
    where: { id: session.id },
    data: { refreshTokenHash: hash(tokens.refreshToken) },
  });

  res.status(201).json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
    },
    ...tokens,
  });
}

export async function login(req: Request, res: Response) {
  const identifier = String(req.body.identifier).trim();
  const password = String(req.body.password);

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: identifier.toLowerCase() },
        { email: identifier.toLowerCase() },
        { phone: identifier },
      ],
    },
  });

  if (!user) {
    throw new HttpError(401, "Invalid User ID/Username or Password");
  }

  if (!user.isActive) {
    throw new HttpError(403, "Account is disabled");
  }

  if (!user.passwordHash) {
    throw new HttpError(400, "No password configured for this account. Please register with a password.");
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    throw new HttpError(401, "Invalid User ID/Username or Password");
  }

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: "pending",
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400_000),
    },
  });
  const tokens = makeTokens(user.id, session.id);
  await prisma.session.update({
    where: { id: session.id },
    data: { refreshTokenHash: hash(tokens.refreshToken) },
  });

  res.status(200).json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
    },
    ...tokens,
  });
}

export async function guestLogin(_req: Request, res: Response) {
  const randomSuffix = crypto.randomBytes(3).toString("hex");
  const username = `guest_${randomSuffix}`;
  const displayName = `Guest ${randomSuffix.toUpperCase()}`;
  const dummyPassword = crypto.randomBytes(16).toString("hex");
  const passwordHash = await bcrypt.hash(dummyPassword, 8);

  const user = await prisma.user.create({
    data: {
      username,
      displayName,
      passwordHash,
      isVerified: false,
      isActive: true,
    },
  });

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: "pending",
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400_000),
    },
  });
  const tokens = makeTokens(user.id, session.id);
  await prisma.session.update({
    where: { id: session.id },
    data: { refreshTokenHash: hash(tokens.refreshToken) },
  });

  res.status(201).json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    },
    ...tokens,
  });
}

export async function requestOtp(req: Request, res: Response) {
  const destination = String(req.body.destination).trim().toLowerCase();
  const code = String(crypto.randomInt(100000, 1000000));
  await prisma.otpChallenge.create({
    data: { destination, codeHash: hash(code), expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000) }
  });

  const email = isEmail(destination) ? destination : null;
  const phone = email ? null : destination;
  const existingUser = await prisma.user.findFirst({ where: email ? { email } : { phone } });

  const response: Record<string, unknown> = {
    success: true,
    message: "OTP generated for development. No SMS/email was sent.",
    userExists: Boolean(existingUser),
    isNewUser: !existingUser,
  };
  if (existingUser) {
    response.username = existingUser.username;
    response.displayName = existingUser.displayName;
  }
  if (env.NODE_ENV !== "production" && env.DEV_RETURN_OTP === "true") response.devOtp = code;
  res.status(200).json(response);
}

export async function verifyOtp(req: Request, res: Response) {
  const destination = String(req.body.destination).trim().toLowerCase();
  const challenge = await prisma.otpChallenge.findFirst({
    where: { destination, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" }
  });
  if (!challenge || challenge.codeHash !== hash(String(req.body.code))) throw new HttpError(400, "Invalid or expired OTP");

  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
  const email = isEmail(destination) ? destination : null;
  const phone = email ? null : destination;

  let user = await prisma.user.findFirst({ where: email ? { email } : { phone } });
  if (user && !user.isActive) throw new HttpError(403, "Account is disabled");

  if (!user) {
    const username = req.body.username ? String(req.body.username).trim().toLowerCase() : undefined;
    const displayName = req.body.displayName ? String(req.body.displayName).trim() : undefined;

    if (!username || !displayName) {
      throw new HttpError(404, "User does not exist for this number. Please register with a display name and username.");
    }

    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      throw new HttpError(400, "Username must be 3-30 characters (letters, numbers, underscores only).");
    }

    const taken = await prisma.user.findUnique({ where: { username } });
    if (taken) {
      throw new HttpError(409, "Username already exists. Please choose a different username.");
    }

    user = await prisma.user.create({ data: { email, phone, username, displayName, isVerified: true } });
  }

  const session = await prisma.session.create({
    data: { userId: user.id, refreshTokenHash: "pending", expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400_000) }
  });
  const tokens = makeTokens(user.id, session.id);
  await prisma.session.update({ where: { id: session.id }, data: { refreshTokenHash: hash(tokens.refreshToken) } });

  res.status(200).json({ success: true, user: { id: user.id, username: user.username, displayName: user.displayName }, ...tokens });
}

export async function refresh(req: Request, res: Response) {
  const token = req.body?.refreshToken;
  if (typeof token !== "string") throw new HttpError(400, "refreshToken is required");
  let payload: jwt.JwtPayload;
  try { payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload; }
  catch { throw new HttpError(401, "Invalid or expired refresh token"); }
  if (typeof payload.sub !== "string" || typeof payload.sid !== "string" || payload.type !== "refresh") throw new HttpError(401, "Invalid refresh token");
  const session = await prisma.session.findUnique({ where: { id: payload.sid }, include: { user: { select: { isActive: true } } } });
  if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt < new Date() || session.refreshTokenHash !== hash(token)) {
    throw new HttpError(401, "Session expired or revoked");
  }
  if (!session.user || !session.user.isActive) throw new HttpError(403, "Account is disabled");
  const tokens = makeTokens(payload.sub, session.id);
  await prisma.session.update({ where: { id: session.id }, data: { refreshTokenHash: hash(tokens.refreshToken), expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400_000) } });
  res.json({ success: true, ...tokens });
}

export async function logout(req: Request, res: Response) {
  if (req.auth?.sessionId) await prisma.session.updateMany({ where: { id: req.auth.sessionId, userId: req.auth.userId }, data: { revokedAt: new Date() } });
  res.json({ success: true, message: "Logged out" });
}

export async function me(req: Request, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { id: true, username: true, displayName: true, email: true, phone: true, avatarUrl: true, bio: true, createdAt: true } });
  if (!user) throw new HttpError(404, "User not found");
  res.json({ success: true, user });
}
