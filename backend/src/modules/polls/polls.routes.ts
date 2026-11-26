import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";
import * as controller from "./polls.controller";

const router = Router();
router.use(requireAuth);

router.post(
  "/",
  validateBody(
    z.object({
      conversationId: z.string().uuid(),
      question: z.string().min(1).max(300),
      options: z.array(z.string().min(1).max(120)).min(2).max(10),
      allowMultiple: z.boolean().optional().default(false),
    })
  ),
  asyncHandler(controller.create)
);

router.post(
  "/:pollId/vote",
  validateBody(z.object({ optionId: z.string().uuid() })),
  asyncHandler(controller.vote)
);

export default router;
