import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { requireAuth } from "../../middleware/auth";
import { env } from "../../config/env";
import { HttpError } from "../../utils/http-error";

const router = Router();
const uploadRoot = path.resolve(process.cwd(), "uploads");
const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "application/pdf", "text/plain", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/webm"]);
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(uploadRoot, { recursive: true });
    cb(null, uploadRoot);
  },
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
});
const uploader = multer({
  storage,
  limits: { fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => allowed.has(file.mimetype) ? cb(null, true) : cb(new HttpError(415, "File type is not allowed"))
});

router.post("/", requireAuth, uploader.single("file"), (req, res) => {
  if (!req.file) throw new HttpError(400, "file field is required");
  res.status(201).json({
    success: true,
    file: {
      originalName: req.file.originalname,
      filename: req.file.filename,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      url: `/uploads/${req.file.filename}`
    }
  });
});

export default router;
