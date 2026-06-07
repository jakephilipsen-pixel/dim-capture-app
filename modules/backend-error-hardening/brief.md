# Module 09 — backend-error-hardening

## What this module does

Closes five security/quality findings surfaced by the `/compile-stress` run
(2026-06-04). All changes are in the backend only (no frontend, no DB schema,
no new routes).

## Scope

### S1 — errorHandler leaks internal detail
`errorHandler.ts` echoed `err.message` verbatim for every non-`AppError`,
exposing Prisma/Postgres stack traces, the `postgres:5432` DSN, and CC error
strings to HTTP clients.

**Fix:** unknown (non-`AppError`) errors → `{ error: "Internal server error" }`
(status 500); full detail logged server-side via pino (`log.error({ err }, …)`).
`AppError` instances keep their intended status + message.

### S2 — Malformed/oversized bodies → 500 instead of 400/413
Express body-parser raises plain `Error` objects carrying `err.status`/
`err.statusCode` (400 for bad JSON, 413 for payload too large). The old
`errorHandler` ignored them and returned 500.

**Fix:** in `errorHandler`, if a non-`AppError` carries a numeric 4xx
`err.status`/`err.statusCode`, honour it. 400 → `"Invalid request body"`;
413 → `"Payload too large"`. Non-4xx still collapses to generic 500.

### S3a — `GET /api/skus/:barcode` CC-fallback leaks CC errors (500)
On the DB-miss CC-fallback path, `CcApiError` and `CcRateLimitError` propagated
as non-`AppError` → errorHandler echoed their CC-internal message and returned 500.

**Fix:** `getSkuByBarcode` in `skuService.ts` wraps the `ccClient.lookupByBarcode`
call in a try/catch; `CcRateLimitError` → `AppError("…", 503)`;
`CcApiError` → `AppError("…", 502)`. Generic safe messages, CC strings never leave the process.

### M5 — Upper dim sanity bound
Dim validation only enforced `> 0`, accepting absurd values like `1e308`.

**Fix:** `captureSchema`/`correctionSchema` in `dimService.ts` gain upper bounds
via `.max()`:
- L/W/H: `<= 100,000 mm` (100 m — no carton in this cold-store can exceed it)
- weight: `<= 1,000 kg` (Australian B-double pallet legal max)
Out-of-range → 422.

### M6 — Confusing zod message for JSON `Infinity`
Zod v4's `.finite()` is a no-op in the classic API; `Infinity`/`-Infinity`
produced "expected number, received number".

**Fix:** Use zod v4's `error` callback on each numeric field to detect
non-finite inputs and return `"<field> must be a finite number"`.

## Out of scope
- S3b (rate-limit DoS amplifier on the unauthenticated endpoint) — see module 10 `cc-resilience` + module 12 `cc-write-authz`
- S4, S5, S6, S7, S8 — dedicated hardening modules 10–13

## Acceptance criteria
1. `errorHandler` returns `{ error: "Internal server error" }` (not the raw `err.message`) for every non-`AppError` non-4xx throw.
2. body-parser 400/413 → matching HTTP status + safe message.
3. `CcApiError` on barcode fallback → 502; `CcRateLimitError` → 503. CC strings absent from response.
4. Dim values > 100,000 mm or > 1,000 kg → 422 with clear message.
5. `Infinity`/`-Infinity` in dim fields → 422 with "finite" in the message.
6. `npx tsc --noEmit` clean; all tests green.
