import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";
import * as controller from "./nearby.controller";

const router = Router();
router.use(requireAuth);

router.get("/settings", asyncHandler(controller.getSettings));
router.patch(
  "/settings",
  validateBody(
    z
      .object({
        discoveryEnabled: z.boolean().optional(),
        invisibleMode: z.boolean().optional(),
      })
      .refine((v) => Object.keys(v).length > 0, "At least one setting is required")
  ),
  asyncHandler(controller.updateSettings)
);

router.post(
  "/scan",
  validateBody(
    z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy: z.number().min(0).max(50000).optional(),
    })
  ),
  asyncHandler(controller.scan)
);

router.post("/stop", asyncHandler(controller.stopScanning));

router.get("/requests", asyncHandler(controller.listRequests));
router.post(
  "/requests",
  validateBody(
    z.object({
      toUserId: z.string().uuid(),
      message: z.string().max(200).optional(),
    })
  ),
  asyncHandler(controller.sendRequest)
);
router.post(
  "/requests/:requestId/respond",
  validateBody(z.object({ action: z.enum(["ACCEPT", "REJECT"]) })),
  asyncHandler(controller.respondToRequest)
);
router.delete("/requests/:requestId", asyncHandler(controller.cancelRequest));

export default router;
