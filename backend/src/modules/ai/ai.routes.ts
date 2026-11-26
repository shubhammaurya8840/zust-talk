import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";
import * as controller from "./ai.controller";

const router = Router();
router.use(requireAuth);

router.get("/state", asyncHandler(controller.getState));
router.delete("/history", asyncHandler(controller.clearHistory));

router.post(
  "/command",
  validateBody(
    z.object({
      text: z.string().min(1).max(2000),
      tzOffsetMinutes: z.number().min(-840).max(840).optional(),
    })
  ),
  asyncHandler(controller.handleCommand)
);

router.post(
  "/confirm",
  validateBody(
    z.object({
      messageId: z.string().uuid(),
      overrides: z.record(z.string(), z.unknown()).optional(),
    })
  ),
  asyncHandler(controller.confirmAction)
);

router.post(
  "/cancel",
  validateBody(z.object({ messageId: z.string().uuid() })),
  asyncHandler(controller.cancelAction)
);

router.patch(
  "/scheduled/:id",
  validateBody(
    z.object({
      scheduledFor: z.string().optional(),
      text: z.string().max(1000).optional(),
    })
  ),
  asyncHandler(controller.updateScheduled)
);
router.delete("/scheduled/:id", asyncHandler(controller.deleteScheduled));

router.post(
  "/tasks",
  validateBody(
    z.object({
      title: z.string().min(1).max(200),
      dueAt: z.string().optional(),
    })
  ),
  asyncHandler(controller.createTask)
);
router.patch(
  "/tasks/:id",
  validateBody(
    z.object({
      title: z.string().min(1).max(200).optional(),
      status: z.enum(["PENDING", "COMPLETED"]).optional(),
    })
  ),
  asyncHandler(controller.updateTask)
);
router.delete("/tasks/:id", asyncHandler(controller.deleteTask));

export default router;
