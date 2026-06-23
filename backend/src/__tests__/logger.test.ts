import { describe, it, expect } from "vitest";
import pino from "pino";
import { redactOptions } from "../middleware/logger";

/**
 * Verifies the logger's redaction paths actually censor the CC-write secret
 * (`X-Sync-Key`) and `Authorization` in the request log shape pino-http emits
 * (headers nested under `req.headers`). A wrong path string would silently fail
 * to redact, leaking the secret to logs (CWE-532) — this guards against that.
 */
describe("logger redaction", () => {
  function captureLogger() {
    const lines: string[] = [];
    const dest = { write: (s: string) => lines.push(s) };
    const log = pino({ level: "info", redact: redactOptions }, dest as unknown as NodeJS.WritableStream);
    return { log, lines };
  }

  it("censors x-sync-key and authorization, preserving other headers", () => {
    const { log, lines } = captureLogger();

    log.info(
      {
        req: {
          method: "POST",
          url: "/api/sync/cc",
          headers: {
            "x-sync-key": "supersecret-sync-key",
            authorization: "Bearer tok-abc-123",
            "content-type": "application/json",
          },
        },
      },
      "request completed",
    );

    const out = lines.join("\n");
    expect(out).not.toContain("supersecret-sync-key");
    expect(out).not.toContain("tok-abc-123");
    expect(out).toContain("[REDACTED]");
    // Non-secret headers must survive redaction.
    expect(out).toContain("application/json");
  });
});
