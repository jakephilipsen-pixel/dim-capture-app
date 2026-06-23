import pino from "pino";
import pinoHttp from "pino-http";

const level = process.env.NODE_ENV === "test" ? "silent" : "info";

/**
 * Secrets that must never reach the logs (CWE-532). pino-http serialises the
 * request under `req` with headers at `req.headers`, so these paths censor the
 * CC-write-authorising `X-Sync-Key` and any `Authorization` header on every
 * request log line. Exported so the redaction is unit-testable.
 */
export const redactOptions = {
  paths: ['req.headers["x-sync-key"]', "req.headers.authorization"],
  censor: "[REDACTED]",
};

// Base application logger — use this instead of console.* in committed code.
export const logger = pino({ level, redact: redactOptions });

export const requestLogger = pinoHttp({ logger });
