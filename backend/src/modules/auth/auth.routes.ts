import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../../middleware/validate";
import { requireAuth } from "../../middleware/auth";
import { asyncHandler } from "../../utils/async-handler";
import * as controller from "./auth.controller";

const router = Router();
const requestOtpSchema = z.object({ destination: z.string().min(5).max(254) });
const verifyOtpSchema = z.object({
  destination: z.string().min(5).max(254),
  code: z.string().length(6),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).optional(),
  displayName: z.string().min(1).max(60).optional(),
});

const sendEmailOtpSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  purpose: z.enum(["REGISTER", "RESET_PASSWORD"]).default("REGISTER"),
});

const verifyEmailOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, "OTP must be 6 digits"),
  purpose: z.enum(["REGISTER", "RESET_PASSWORD"]).default("REGISTER"),
});

const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  displayName: z.string().min(1).max(60),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
  email: z.string().email("Valid email address is required").optional(),
  verificationToken: z.string().min(10).optional(),
  primaryLanguage: z.string().min(2).max(12).default("en"),
  identifier: z.string().min(3).max(254).optional(),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  identifier: z.string().min(3).max(254),
  password: z.string().min(1).max(100),
});

const forgotResetSchema = z.object({
  email: z.string().email(),
  newPassword: z.string().min(6, "Password must be at least 6 characters").max(100),
  code: z.string().length(6).optional(),
  verificationToken: z.string().min(10).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(100),
  newPassword: z.string().min(6, "Password must be at least 6 characters").max(100),
});

// Email OTP Verification & Password Reset
router.post("/email/send-otp", validateBody(sendEmailOtpSchema), asyncHandler(controller.sendEmailOtp));
router.post("/email/verify-otp", validateBody(verifyEmailOtpSchema), asyncHandler(controller.verifyEmailOtp));
router.post("/forgot-password/reset", validateBody(forgotResetSchema), asyncHandler(controller.resetPasswordWithOtp));
router.post("/change-password", requireAuth, validateBody(changePasswordSchema), asyncHandler(controller.changePassword));

// Password-based authentication
router.post("/register", validateBody(registerSchema), asyncHandler(controller.register));
router.post("/login", validateBody(loginSchema), asyncHandler(controller.login));
router.post("/guest", asyncHandler(controller.guestLogin));

// Legacy OTP-based authentication
router.post("/otp/request", validateBody(requestOtpSchema), asyncHandler(controller.requestOtp));
router.post("/otp/verify", validateBody(verifyOtpSchema), asyncHandler(controller.verifyOtp));

// User profile & sessions
router.get("/check-username", asyncHandler(controller.checkUsername));
router.post("/refresh", asyncHandler(controller.refresh));
router.post("/logout", requireAuth, asyncHandler(controller.logout));
router.get("/me", requireAuth, asyncHandler(controller.me));

export default router;
