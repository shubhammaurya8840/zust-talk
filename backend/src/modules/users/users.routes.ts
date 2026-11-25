import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";
import * as controller from "./users.controller";

const socialLinksSchema = z
  .object({
    instagram: z.string().max(250).optional().or(z.literal("")),
    twitter: z.string().max(250).optional().or(z.literal("")),
    linkedin: z.string().max(250).optional().or(z.literal("")),
    youtube: z.string().max(250).optional().or(z.literal("")),
    github: z.string().max(250).optional().or(z.literal("")),
    website: z.string().max(250).optional().or(z.literal("")),
  })
  .nullable()
  .optional();

const router = Router();
router.use(requireAuth);
router.get("/search", asyncHandler(controller.search));
router.get("/lookup/:username", asyncHandler(controller.lookupByUsername));
router.get("/:userId", asyncHandler(controller.getProfile));
router.patch(
  "/me",
  validateBody(
    z
      .object({
        username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).optional(),
        displayName: z.string().min(1).max(60).optional(),
        bio: z.string().max(160).nullable().optional(),
        avatarUrl: z.string().max(15000).nullable().optional(),
        primaryLanguage: z.string().min(2).max(12).optional(),
        socialLinks: socialLinksSchema,
      })
      .refine((v) => Object.keys(v).length > 0)
  ),
  asyncHandler(controller.updateMe)
);
router.post("/:userId/block", asyncHandler(controller.block));
router.delete("/:userId/block", asyncHandler(controller.unblock));
router.post(
  "/:userId/report",
  validateBody(z.object({ reason: z.string().min(2).max(100), details: z.string().max(1000).optional() })),
  asyncHandler(controller.report)
);
export default router;
