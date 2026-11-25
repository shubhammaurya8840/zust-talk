import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";
import * as controller from "./conversations.controller";

const router = Router();
router.use(requireAuth);
router.get("/", asyncHandler(controller.list));
router.get("/:conversationId", asyncHandler(controller.getById));
router.patch("/:conversationId", validateBody(z.object({ title: z.string().min(1).max(80) })), asyncHandler(controller.updateGroup));
router.post("/:conversationId/archive", validateBody(z.object({ archived: z.boolean().default(true) })), asyncHandler(controller.toggleArchive));
router.post("/direct", validateBody(z.object({ userId: z.string().uuid() })), asyncHandler(controller.createDirect));
router.post("/group", validateBody(z.object({ title: z.string().min(1).max(80), memberIds: z.array(z.string().uuid()).min(1).max(100) })), asyncHandler(controller.createGroup));
router.get("/:conversationId/members", asyncHandler(controller.members));
router.post("/:conversationId/members", validateBody(z.object({ userId: z.string().uuid() })), asyncHandler(controller.addMember));
router.delete("/:conversationId/members/:userId", asyncHandler(controller.removeMember));
export default router;
