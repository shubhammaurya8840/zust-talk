import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
import { HttpError } from "../utils/http-error";

export const validateBody = (schema: ZodSchema) => (req: Request, _res: Response, next: NextFunction) => {
  const result = schema.safeParse(req.body);
  if (!result.success) return next(new HttpError(400, result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ")));
  req.body = result.data;
  next();
};
