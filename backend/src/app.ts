import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import authRoutes from "./modules/auth/auth.routes";
import userRoutes from "./modules/users/users.routes";
import conversationRoutes from "./modules/conversations/conversations.routes";
import messageRoutes from "./modules/messages/messages.routes";
import uploadRoutes from "./modules/uploads/uploads.routes";
import reportRoutes from "./modules/reports/reports.routes";
import translateRoutes from "./modules/translate/translate.routes";
import nearbyRoutes from "./modules/nearby/nearby.routes";
import { notFound, errorHandler } from "./middleware/error";
import { env } from "./config/env";

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: env.CLIENT_ORIGIN === "*" ? true : env.CLIENT_ORIGIN.split(",").map(s => s.trim()), credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads"), { dotfiles: "deny", index: false }));
app.use("/api", rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please slow down a moment." },
}));

app.get("/api/health", (_req, res) => res.json({ success: true, service: "india-chat-backend", status: "healthy" }));
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/translate", translateRoutes);
app.use("/api/nearby", nearbyRoutes);

app.use(notFound);
app.use(errorHandler);
export default app;
