import { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  const message =
    err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
}
