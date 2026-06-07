# State: backend-error-hardening

> This file is the handoff record between conversations. Keep it accurate. Other modules will load THIS FILE (not source) to understand what this module exports.

## Status
✅ Built — 2026-06-08

## Branch
`feature/hardening` (branched from `main` after docker-deploy/#8 merged)

## Last touched
2026-06-08 — module built (S1, S2, S3a, M5, M6). tsc clean; **87/87** tests (was 72; +15 new tests).

## What changed

### `backend/src/middleware/errorHandler.ts`
- Added pino logger (`log.error({ err }, "Unhandled error")`) — real error detail
  is logged server-side and never echoed to HTTP clients (S1).
- Added `bodyParserStatus()` helper: reads `err.status`/`err.statusCode` from
  plain `Error`-like objects; only trusts 4xx (not 5xx), so a non-AppError with
  status 500 still collapses to the generic message (S2).
- Added `bodyParserMessage(status)`: 413 → `"Payload too large"`, anything else
  → `"Invalid request body"` (S2).
- Unknown errors path now always returns `{ error: "Internal server error" }` — the
  previous branch that echoed `err.message` is gone (S1).

### `backend/src/services/skuService.ts`
- Imports `CcApiError`, `CcRateLimitError` from `ccClient`.
- `getSkuByBarcode`: the `ccClient.lookupByBarcode` call is now wrapped in
  try/catch; `CcRateLimitError` → `AppError("Product lookup unavailable — upstream rate limit", 503)`;
  `CcApiError` → `AppError("Product lookup failed — upstream error", 502)`.
  Any other thrown error re-throws (still reaches errorHandler, still 500 generic — S1 handles it).

### `backend/src/services/dimService.ts`
- Added `DIM_MM_MAX = 100_000` and `WEIGHT_KG_MAX = 1_000` constants with rationale
  comments.
- Added `dimMmField(name)` factory and `weightKgField` validator. Both use the
  zod v4 `error` callback to produce `"<name> must be a finite number"` for
  `Infinity`/`-Infinity` (the only way to override zod v4's opaque
  `"invalid_type"` message for non-finite inputs — `.finite()` is a no-op in v4's
  classic API). Then chain `.positive()` and `.max()`.
- `captureSchema` and `correctionSchema` (the latter derived via `.omit`) now
  use these bounded fields instead of bare `.positive()` chains (M5 + M6).

## Public interface (no changes)
All existing HTTP routes, response shapes, and service signatures are unchanged.
The only observable difference is in error responses and new 422 rejections for
previously-accepted out-of-bound/non-finite inputs.

```
errorHandler behaviour (updated):
  AppError → unchanged (status + message)
  body-parser 400 → { status: 400, error: "Invalid request body" }
  body-parser 413 → { status: 413, error: "Payload too large" }
  unknown Error → { status: 500, error: "Internal server error" }  ← was leaking err.message
  non-Error throw → { status: 500, error: "Internal server error" }

GET /api/skus/:barcode (updated CC-fallback):
  CcRateLimitError → 503 { error: "Product lookup unavailable — upstream rate limit" }
  CcApiError → 502 { error: "Product lookup failed — upstream error" }

POST /api/dims + PUT /api/dims/:id (updated dim validation):
  > 100,000 mm for L/W/H → 422
  > 1,000 kg for weight → 422
  Infinity / -Infinity in any dim field → 422 "must be a finite number"
```

## Test status
- [x] Unit tests written: +15 new tests (6 errorHandler, 2 skuService S3a, 7 dimService M5/M6)
- [x] All tests passing: `npm test` → **87/87** (was 72/72)
- [x] Typecheck clean: `npx tsc --noEmit` exit 0

## Quirks / gotchas

- **Zod v4 `.finite()` is a no-op.** In the zod v4 classic API the `.finite()` method
  returns `this` unchanged. The finite check happens at the type-parse level and
  produces `code: "invalid_type", received: "Infinity"` with the hardcoded message
  "Invalid input: expected number, received number". The only override point is the
  `error` callback on `z.number(...)`. We detect `!Number.isFinite(input) && typeof input === "number"`
  inside that callback. This is the approach; it is not a workaround that will
  silently break on a zod upgrade — it uses the documented v4 error API.
- **bodyParserStatus only trusts 4xx.** A non-AppError with status 500 (which
  theoretically shouldn't come from body-parser but could from other middleware) is
  treated as an unknown error and returns the generic 500 message. This is intentional —
  we don't want to inadvertently surface a middleware-assigned 5xx as a client-visible
  status code.
- **S3a only covers the barcode-lookup fallback.** The `seedSkus` path also calls
  `ccClient.listProducts`; `CcApiError` there still propagates as an unknown error
  → 500 generic (after S1, the message is safe). If seed errors need a specific status,
  that's a future improvement; the stress test only called out the barcode endpoint.

## In-flight work
None — module complete.

## New dependencies added
None.

## Decisions made during this module's build (also in DECISIONS.md)
- 2026-06-08 | Dim upper bounds: 100,000 mm (L/W/H) and 1,000 kg (weight) | 100 m covers any
  carton in a cold-store 3PL; 1,000 kg is the Australian B-double pallet legal max | backend-error-hardening build
- 2026-06-08 | Zod v4 finite override via `error` callback (not `.finite()`) | `.finite()` is a
  no-op in zod v4 classic; `error` callback is the v4-documented override point for type-level errors | backend-error-hardening build
- 2026-06-08 | S3a maps `CcApiError` → 502, `CcRateLimitError` → 503 in `skuService` (not in errorHandler) | Keeps CC error knowledge in the service layer where ccClient is imported; errorHandler stays CC-agnostic; follows existing pattern of catching in the service and throwing AppError | backend-error-hardening build
