import { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors";
import { logger } from "./logger";

const log = logger.child({ module: "errorHandler" });

/**
 * Return the HTTP status from a body-parser style error, or null if not
 * applicable. body-parser raises plain Errors carrying `err.status` (always)
 * and sometimes `err.statusCode` in addition. We only honour 4xx — 5xx falls
 * through to the generic 500 path so we never accidentally surface an
 * arbitrary non-AppError with a server-assigned 5xx status.
 */
function bodyParserStatus(err: unknown): number | null {
  if (err === null || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;
  const code = typeof e.status === "number" ? e.status
    : typeof e.statusCode === "number" ? e.statusCode
    : null;
  if (code !== null && code >= 400 && code < 500) return code;
  return null;
}

/** Human-readable message for a known body-parser 4xx status. */
function bodyParserMessage(status: number): string {
  if (status === 413) return "Payload too large";
  return "Invalid request body";
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // AppError: intentional, safe — echo the intended status and message.
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // S2 — body-parser (and similar middleware) raises plain Errors with a
  // numeric `status`/`statusCode`. Honour 4xx so malformed JSON → 400 and
  // oversized bodies → 413 instead of 500.
  const httpStatus = bodyParserStatus(err);
  if (httpStatus !== null) {
    res.status(httpStatus).json({ error: bodyParserMessage(httpStatus) });
    return;
  }

  // S1 — unknown errors: log the full detail server-side, return a generic
  // message so internal strings (Prisma DSN, CC error text, stack traces)
  // are never echoed to the client.
  log.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
}
