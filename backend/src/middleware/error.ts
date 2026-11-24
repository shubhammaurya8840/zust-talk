import { ErrorRequestHandler, Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { HttpError } from "../utils/http-error";

export const notFound = (_req: Request, _res: Response, next: NextFunction) =>
  next(new HttpError(404, "Route not found"));

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({ success: false, message: "A record with this value already exists" });
    return;
  }
  const status = err instanceof HttpError ? err.statusCode : 500;
  const message = err instanceof Error ? err.message : "Internal server error";
  if (status >= 500) console.error(err);
  res.status(status).json({ success: false, message: status >= 500 && process.env.NODE_ENV === "production" ? "Internal server error" : message });
};
