import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";
import { smartTranslateServer } from "../../utils/translator";

const router = Router();
router.use(requireAuth);

const translateSchema = z.object({
  text: z.string().min(1).max(5000),
  targetLang: z.string().min(2).max(12).default("en"),
  sourceLang: z.string().min(2).max(12).default("auto"),
});

router.post(
  "/",
  validateBody(translateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { text, targetLang, sourceLang } = req.body as {
      text: string;
      targetLang: string;
      sourceLang: string;
    };
    const result = await smartTranslateServer(text, targetLang, sourceLang);
    return res.json({ success: true, ...result });
  })
);

export default router;
