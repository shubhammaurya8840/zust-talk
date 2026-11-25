import { Request, Response } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { HttpError } from "../../utils/http-error";
import { sendOtpEmail } from "../../utils/mailer";

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const isEmail = (value: string) => value.includes("@");

function makeTokens(userId: string, sessionId: string) {
  const accessToken = jwt.sign({ sid: sessionId }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"],
  });
  const refreshToken = jwt.sign({ sid: sessionId, type: "refresh" }, env.JWT_REFRESH_SECRET, {
    subject: userId,
    expiresIn: `${env.REFRESH_TOKEN_DAYS}d`,
  });
  return { accessToken, refreshToken };
}

function makeEmailVerificationToken(email: string, purpose: "REGISTER" | "RESET_PASSWORD") {
  return jwt.sign({ type: "email_otp", email, purpose }, env.JWT_ACCESS_SECRET, {
    expiresIn: "15m",
  });
}

function verifyEmailToken(token: string, expectedEmail: string, expectedPurpose: "REGISTER" | "RESET_PASSWORD") {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    if (
      payload.type !== "email_otp" ||
      payload.email !== expectedEmail ||
      payload.purpose !== expectedPurpose
    ) {
      throw new HttpError(400, "Invalid email verification token");
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Email verification expired. Please request a new OTP.");
  }
}

export async function checkUsername(req: Request, res: Response) {
  const username = String(req.query.username || "").trim().toLowerCase();
  if (!username || username.length < 3) throw new HttpError(400, "Username must be at least 3 characters");
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    throw new HttpError(400, "Username can only contain letters, numbers, and underscores");
  }
  const existing = await prisma.user.findUnique({ where: { username } });
  res.json({ success: true, available: !existing });
}

export async function sendEmailOtp(req: Request, res: Response) {
  const cleanEmail = String(req.body.email).trim().toLowerCase();
  const purpose = (req.body.purpose as "REGISTER" | "RESET_PASSWORD") || "REGISTER";

  const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (purpose === "REGISTER" && existing) {
    throw new HttpError(409, "An account with this email already exists. Please sign in.");
  }
  if (purpose === "RESET_PASSWORD" && !existing) {
    throw new HttpError(404, "No account found with this email address.");
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const destination = `${purpose}:${cleanEmail}`;

  await prisma.otpChallenge.create({
    data: {
      destination,
      codeHash: hash(code),
      expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000),
    },
  });

  const delivery = await sendOtpEmail({ to: cleanEmail, code, purpose });

  const response: Record<string, unknown> = {
    success: true,
    message:
      delivery.mode === "smtp"
        ? `OTP sent to ${cleanEmail}. Check your inbox or spam folder.`
        : `OTP generated for ${cleanEmail}. Configure SMTP env vars for direct inbox delivery.`,
    deliveryMode: delivery.mode,
  };

  if (delivery.mode !== "smtp") {
    response.devOtp = code;
    if (delivery.previewUrl) response.previewUrl = delivery.previewUrl;
  }

  res.status(200).json(response);
}

export async function verifyEmailOtp(req: Request, res: Response) {
  const cleanEmail = String(req.body.email).trim().toLowerCase();
  const code = String(req.body.code).trim();
  const purpose = (req.body.purpose as "REGISTER" | "RESET_PASSWORD") || "REGISTER";
  const destination = `${purpose}:${cleanEmail}`;

  const challenge = await prisma.otpChallenge.findFirst({
    where: { destination, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge || challenge.codeHash !== hash(code)) {
    throw new HttpError(400, "Invalid or expired verification OTP");
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  const verificationToken = makeEmailVerificationToken(cleanEmail, purpose);
  res.json({ success: true, verificationToken, email: cleanEmail });
}

export async function register(req: Request, res: Response) {
  const { username, displayName, password, verificationToken, primaryLanguage } = req.body;
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

  if (!email) {
    throw new HttpError(400, "Email address is required to create an account");
  }

  if (!verificationToken) {
    throw new HttpError(400, "Please verify your email with OTP before creating your account");
  }
  verifyEmailToken(String(verificationToken), email, "REGISTER");

  const existingUser = await prisma.user.findUnique({ where: { username: cleanUsername } });
  if (existingUser) {
    throw new HttpError(409, "Username already exists. Please choose another username.");
  }

  const existingEmail = await prisma.user.findUnique({ where: { email } });
  if (existingEmail) {
    throw new HttpError(409, "An account with this email already exists.");
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
      email,
      phone: phone || null,
      primaryLanguage: primaryLanguage ? String(primaryLanguage).trim() : "en",
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
      bio: user.bio,
      primaryLanguage: user.primaryLanguage,
      socialLinks: user.socialLinks,
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
        { email: identifier.toLowerCase() },
        { username: identifier.toLowerCase() },
        { phone: identifier },
      ],
    },
  });

  if (!user) {
    throw new HttpError(401, "Invalid Email/Username or Password");
  }
  if (!user.isActive) {
    throw new HttpError(403, "Account is disabled");
  }
  if (!user.passwordHash) {
    throw new HttpError(400, "No password set for this account. Use Forgot Password to set one.");
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    throw new HttpError(401, "Invalid Email/Username or Password");
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
      bio: user.bio,
      primaryLanguage: user.primaryLanguage,
      socialLinks: user.socialLinks,
    },
    ...tokens,
  });
}

export async function resetPasswordWithOtp(req: Request, res: Response) {
  const cleanEmail = String(req.body.email).trim().toLowerCase();
  const newPassword = String(req.body.newPassword);
  const verificationToken = req.body.verificationToken ? String(req.body.verificationToken) : undefined;
  const code = req.body.code ? String(req.body.code).trim() : undefined;

  const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (!user || !user.isActive) {
    throw new HttpError(404, "No active account found for this email");
  }

  if (verificationToken) {
    verifyEmailToken(verificationToken, cleanEmail, "RESET_PASSWORD");
  } else if (code) {
    const destination = `RESET_PASSWORD:${cleanEmail}`;
    const challenge = await prisma.otpChallenge.findFirst({
      where: { destination, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!challenge || challenge.codeHash !== hash(code)) {
      throw new HttpError(400, "Invalid or expired OTP code");
    }
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
  } else {
    throw new HttpError(400, "Verification OTP or token is required");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  res.json({ success: true, message: "Password reset successfully. Please sign in with your new password." });
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
  if (!user) throw new HttpError(404, "User not found");

  if (user.passwordHash) {
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new HttpError(401, "Current password is incorrect");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  res.json({ success: true, message: "Password updated successfully" });
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
      primaryLanguage: user.primaryLanguage,
      socialLinks: user.socialLinks,
    },
    ...tokens,
  });
}

export async function requestOtp(req: Request, res: Response) {
  const destination = String(req.body.destination).trim().toLowerCase();
  const code = String(crypto.randomInt(100000, 1000000));
  await prisma.otpChallenge.create({
    data: {
      destination,
      codeHash: hash(code),
      expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000),
    },
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
    orderBy: { createdAt: "desc" },
  });
  if (!challenge || challenge.codeHash !== hash(String(req.body.code))) {
    throw new HttpError(400, "Invalid or expired OTP");
  }

  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
  const email = isEmail(destination) ? destination : null;
  const phone = email ? null : destination;

  let user = await prisma.user.findFirst({ where: email ? { email } : { phone } });
  if (user && !user.isActive) throw new HttpError(403, "Account is disabled");

  if (!user) {
    const username = req.body.username ? String(req.body.username).trim().toLowerCase() : undefined;
    const displayName = req.body.displayName ? String(req.body.displayName).trim() : undefined;

    if (!username || !displayName) {
      throw new HttpError(404, "User does not exist. Please register with a display name and username.");
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
    data: {
      userId: user.id,
      refreshTokenHash: "pending",
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400_000),
    },
  });
  const tokens = makeTokens(user.id, session.id);
  await prisma.session.update({ where: { id: session.id }, data: { refreshTokenHash: hash(tokens.refreshToken) } });

  res.status(200).json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      primaryLanguage: user.primaryLanguage,
      socialLinks: user.socialLinks,
    },
    ...tokens,
  });
}

export async function refresh(req: Request, res: Response) {
  const token = req.body?.refreshToken;
  if (typeof token !== "string") throw new HttpError(400, "refreshToken is required");
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
  } catch {
    throw new HttpError(401, "Invalid or expired refresh token");
  }
  if (typeof payload.sub !== "string" || typeof payload.sid !== "string" || payload.type !== "refresh") {
    throw new HttpError(401, "Invalid refresh token");
  }
  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: { user: { select: { isActive: true } } },
  });
  if (
    !session ||
    session.userId !== payload.sub ||
    session.revokedAt ||
    session.expiresAt < new Date() ||
    session.refreshTokenHash !== hash(token)
  ) {
    throw new HttpError(401, "Session expired or revoked");
  }
  if (!session.user || !session.user.isActive) throw new HttpError(403, "Account is disabled");
  const tokens = makeTokens(payload.sub, session.id);
  await prisma.session.update({
    where: { id: session.id },
    data: { refreshTokenHash: hash(tokens.refreshToken), expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400_000) },
  });
  res.json({ success: true, ...tokens });
}

export async function logout(req: Request, res: Response) {
  if (req.auth?.sessionId) {
    await prisma.session.updateMany({
      where: { id: req.auth.sessionId, userId: req.auth.userId },
      data: { revokedAt: new Date() },
    });
  }
  if (req.auth?.userId) {
    await prisma.nearbyPresence.deleteMany({ where: { userId: req.auth.userId } }).catch(() => {});
  }
  res.json({ success: true, message: "Logged out" });
}

export async function me(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.userId },
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      phone: true,
      avatarUrl: true,
      bio: true,
      primaryLanguage: true,
      socialLinks: true,
      createdAt: true,
    },
  });
  if (!user) throw new HttpError(404, "User not found");
  res.json({ success: true, user });
}
