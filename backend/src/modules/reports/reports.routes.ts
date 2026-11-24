import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { asyncHandler } from "../../utils/async-handler";
import { prisma } from "../../config/prisma";

const router = Router();
router.get("/mine", requireAuth, asyncHandler(async (req, res) => {
  const reports = await prisma.userReport.findMany({ where: { reporterId: req.auth!.userId }, orderBy: { createdAt: "desc" } });
  res.json({ success: true, reports });
}));
export default router;
