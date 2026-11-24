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
  displayName: z.string().min(1).max(60).optional()
});

const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  displayName: z.string().min(1).max(60),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
  identifier: z.string().min(3).max(254).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

const loginSchema = z.object({
  identifier: z.string().min(3).max(254),
  password: z.string().min(1).max(100),
});

// Password-based authentication
router.post("/register", validateBody(registerSchema), asyncHandler(controller.register));
router.post("/login", validateBody(loginSchema), asyncHandler(controller.login));
router.post("/guest", asyncHandler(controller.guestLogin));

// Legacy OTP-based authentication (for future SMS/Email gateway)
router.post("/otp/request", validateBody(requestOtpSchema), asyncHandler(controller.requestOtp));
router.post("/otp/verify", validateBody(verifyOtpSchema), asyncHandler(controller.verifyOtp));

// User profile & sessions
router.get("/check-username", asyncHandler(controller.checkUsername));
router.post("/refresh", asyncHandler(controller.refresh));
router.post("/logout", requireAuth, asyncHandler(controller.logout));
router.get("/me", requireAuth, asyncHandler(controller.me));

export default router;
