/**
 * requireSyncKey — module 12 (S6)
 *
 * Express middleware that gates CC-write routes behind a shared-secret header.
 * Mount it on POST /api/sync/cc and POST /api/admin/seed only.
 *
 * Behaviour:
 *   - SYNC_SECRET unset/empty → 503 (fail-closed). Never allow a write when
 *     the secret is not configured. Logs a server-side warning.
 *   - X-Sync-Key absent, empty, or wrong → 401.
 *   - Correct key → next() — the route handler runs.
 *
 * Messages are intentionally generic. The real secret is never echoed; no
 * internal detail leaks to the client.
 *
 * Timing-safe: `crypto.timingSafeEqual` is used for the comparison. Length
 * differences are handled by padding the comparison to the longer length, so
 * the function never throws regardless of key lengths.
 */

import { timingSafeEqual } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { logger } from "./logger";

const log = logger.child({ module: "requireSyncKey" });

/**
 * Constant-time string comparison that never throws on length mismatch.
 * Returns true only when both strings are identical.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  // Encode both to UTF-8 byte buffers.
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");

  // If lengths differ we can't pass mismatched buffers directly to
  // timingSafeEqual — it throws. Compare against a padded version of the
  // shorter one instead, then also check lengths so we never return true
  // when the strings differ only by length.
  const maxLen = Math.max(aBuf.length, bBuf.length);
  const aPadded = Buffer.alloc(maxLen);
  const bPadded = Buffer.alloc(maxLen);
  aBuf.copy(aPadded);
  bBuf.copy(bPadded);

  // timingSafeEqual always runs in constant time for equal-length buffers.
  return timingSafeEqual(aPadded, bPadded) && aBuf.length === bBuf.length;
}

export function requireSyncKey(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.SYNC_SECRET;

  // Fail-closed: if the secret is not configured, refuse the request entirely.
  // Logging a warning so an operator can spot a misconfigured deployment.
  if (!secret) {
    log.warn(
      { path: req.path, method: req.method },
      "SYNC_SECRET is not configured — CC-write request refused (fail-closed)",
    );
    res.status(503).json({ error: "Sync authorisation not configured" });
    return;
  }

  const provided = req.headers["x-sync-key"];

  // Header absent, multi-value (array), or empty string → 401.
  if (!provided || Array.isArray(provided) || provided === "") {
    res.status(401).json({ error: "Invalid or missing sync key" });
    return;
  }

  if (!timingSafeStringEqual(provided, secret)) {
    res.status(401).json({ error: "Invalid or missing sync key" });
    return;
  }

  next();
}
