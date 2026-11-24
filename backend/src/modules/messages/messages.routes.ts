import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";
import * as controller from "./messages.controller";

const router = Router();
router.use(requireAuth);
router.get("/conversation/:conversationId", asyncHandler(controller.history));
router.post("/", validateBody(z.object({
  conversationId: z.string().uuid(),
  body: z.string().max(10000).optional(),
  ciphertext: z.string().max(20000).optional(),
  type: z.enum(["TEXT", "IMAGE", "VIDEO", "DOCUMENT", "VOICE"]).default("TEXT"),
  replyToId: z.string().uuid().optional(),
  attachments: z.array(z.object({
    originalName: z.string().min(1),
    storagePath: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().positive()
  })).optional()
}).refine(v => Boolean(v.body || v.ciphertext || (v.attachments && v.attachments.length > 0)) || v.type !== "TEXT", "Message content is required")), asyncHandler(controller.send));
router.patch("/:messageId", validateBody(z.object({ body: z.string().min(1).max(10000) })), asyncHandler(controller.edit));
router.delete("/:messageId", asyncHandler(controller.remove));
router.post("/:messageId/read", asyncHandler(controller.markRead));
router.post("/conversation/:conversationId/read", asyncHandler(controller.markConversationRead));
export default router;
