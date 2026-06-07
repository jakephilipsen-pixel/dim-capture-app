# State: cc-resilience

> This file is the handoff record between conversations. Keep it accurate. Other modules will load THIS FILE (not source) to understand what this module exports.

## Status
✅ Built — 2026-06-08

## Branch
`feature/hardening` (shared with modules 09, 11)

## Last touched
2026-06-08 — module built (S4 timeouts, M2a 429 mapping, M2b split buckets). tsc clean; **106/106** tests (was 88; +18 new tests across ccClientResilience.test.ts and skuService.test.ts).

## What changed

### `backend/src/services/ccClient.ts`
- Added `CC_DEFAULT_TIMEOUT_MS = 12_000` (export).
- Added `CC_DEFAULT_SYNC_CAPACITY = 40`, `CC_DEFAULT_SEED_CAPACITY = 20` (exports).
- Added `CcTimeoutError extends CcApiError` (export): `statusCode: 504`, `name: "CcTimeoutError"`.
- `CcClientOptions` gains: `syncCapacity`, `syncRefillPerSec`, `seedCapacity`, `seedRefillPerSec`, `timeoutMs`. Old `capacity` / `refillPerSec` kept as deprecated aliases → `syncCapacity` / `syncRefillPerSec` so pre-module-10 tests pass unchanged.
- `CcClient` constructor now creates two `TokenBucket` instances: `syncBucket` (lookup + patch) and `seedBucket` (list).
- `guard(path: "sync" | "seed")` selects the appropriate bucket.
- `handleFetchError(err)` private method converts `DOMException` with `name === "AbortError" | "TimeoutError"` to `CcTimeoutError`. All other errors are re-thrown unchanged.
- `lookupByBarcode`, `patchProductDims`, `listProducts`: each fetch call now includes `signal: AbortSignal.timeout(this.timeoutMs)`; each has a try/catch calling `handleFetchError`.

### `backend/src/services/skuService.ts`
- Imports `CcTimeoutError` from `ccClient`.
- `seedSkus()`: listProducts call wrapped in try/catch. `CcRateLimitError` → `AppError("…", 429)`; `CcTimeoutError` → `AppError("…", 504)`; `CcApiError` → `AppError("…", 502)`.
- `getSkuByBarcode()`: explicit `CcTimeoutError` check added before the generic `CcApiError` branch in the existing try/catch → `AppError("…", 504)`. Existing `CcRateLimitError` → 503 and `CcApiError` → 502 mappings preserved.

### `backend/src/__tests__/ccClientResilience.test.ts` (new file)
- 14 tests covering: S4 AbortError/TimeoutError conversion, signal presence on every fetch, non-abort errors not converted; M2a rate-limit rejection from each bucket; M2b seed/sync isolation and default capacity ceiling.

### `backend/src/__tests__/skuService.test.ts` (updated)
- Mock factory updated to include `CcTimeoutError` (function factory with proper prototype chain).
- Imports `CcTimeoutError`.
- 4 new tests: `CcRateLimitError` → 429 (seed), `CcTimeoutError` → 504 (seed), `CcApiError` → 502 (seed), `CcTimeoutError` → 504 (barcode fallback).

## Public interface (new additions)

```typescript
// backend/src/services/ccClient.ts

// New constants (all exported):
export const CC_DEFAULT_TIMEOUT_MS: number;    // 12_000
export const CC_DEFAULT_SYNC_CAPACITY: number; // 40
export const CC_DEFAULT_SEED_CAPACITY: number; // 20

// New error class:
export class CcTimeoutError extends CcApiError {
  constructor(message?: string);
  // statusCode: 504 — always
  // name: "CcTimeoutError"
}

// Updated CcClientOptions (new fields; old fields still accepted):
export interface CcClientOptions {
  // ... existing fields unchanged ...
  syncCapacity?: number;    // default CC_DEFAULT_SYNC_CAPACITY (40)
  syncRefillPerSec?: number; // default CC_DEFAULT_SYNC_REFILL_PER_SEC (40/60 ≈ 0.6667/sec → 40/min)
  seedCapacity?: number;    // default CC_DEFAULT_SEED_CAPACITY (20)
  seedRefillPerSec?: number; // default CC_DEFAULT_SEED_REFILL_PER_SEC (20/60 ≈ 0.3333/sec → 20/min)
  timeoutMs?: number;       // default CC_DEFAULT_TIMEOUT_MS (12_000)
  // deprecated aliases (backwards compat only):
  capacity?: number;        // treated as syncCapacity when syncCapacity absent
  refillPerSec?: number;    // treated as syncRefillPerSec when syncRefillPerSec absent
}
```

All existing exports (`CcProduct`, `CcDimPayload`, `CcRateLimitError`, `CcApiError`,
`CcNotFoundError`, `CcClient`, `ccClient`, `CC_DEFAULT_BASE_URL`) are unchanged.

## Rate-limit status mapping (canonical reference)

| Caller context | Error thrown | HTTP status | Rationale |
|---|---|---|---|
| `GET /api/skus/:barcode` (barcode fallback) | `CcRateLimitError` | 503 | Upstream resource unavailable for user-triggered read |
| `POST /api/admin/seed` | `CcRateLimitError` | 429 | Admin operator triggered seed; our limiter rejected it |
| `POST /api/sync/cc` | `CcRateLimitError` | per-item `failed` (never escapes loop) | Already handled per-item inside syncService |
| any path | `CcTimeoutError` | 504 | CC peer did not respond in time |

## Bucket design

```
CC tenant ceiling: 60 req/min

syncBucket (lookupByBarcode + patchProductDims):
  burst capacity = 40 tokens
  sustained refill = 40/60 ≈ 0.6667 tokens/sec → 40/min sustained

seedBucket (listProducts):
  burst capacity = 20 tokens
  sustained refill = 20/60 ≈ 0.3333 tokens/sec → 20/min sustained

Combined burst:     40 + 20 = 60 ≤ CC ceiling ✓
Combined sustained: (40+20)/60 = 1/sec = 60/min ≤ CC ceiling ✓
```

Seed gets 20/min — ample for a ~460-SKU paginated pull at pageSize=100 (5 pages = 5 tokens).
Sync + lookup gets 40/min — the critical operational path.

> **Bug fix note (2026-06-08):** The original module-10 implementation set both
> `refillPerSec` defaults to 1/sec, giving a combined sustained rate of 2/sec =
> 120/min — double CC's ceiling. Fixed: refill defaults are now 40/60 and 20/60
> respectively so combined sustained = 60/min. Burst capacity is unchanged.

## Env vars added

| Var | Default | Notes |
|-----|---------|-------|
| `CC_TIMEOUT_MS` | `12000` | Per-fetch AbortSignal timeout in ms. Applies to all CC calls. Read at `CcClient` construction via `fromEnv()` or constructor `opts.timeoutMs`. |

## Test status
- [x] Unit tests written: +14 (ccClientResilience.test.ts) + 4 (skuService.test.ts) = 18 new tests
- [x] **Bug fix 2026-06-08:** +1 sustained-rate test (ccClientResilience.test.ts) — advances clock 60 s and asserts combined permitted calls ≤ 60 (not ~120). This is the regression test that would have caught the original 1/sec-per-bucket default error.
- [x] All tests passing: `npm test` → **107/107** (was 106/106; +1 sustained-rate test)
- [x] Typecheck clean: `npx tsc --noEmit` exit 0

## Quirks / gotchas

- **`AbortSignal.timeout()` is available in Node 18.17+ / Node 20+.** Node 22 (our target) ships it natively. No polyfill needed.
- **DOMException name varies by platform.** `AbortSignal.timeout()` rejects with `name: "TimeoutError"` in Node 22; some older browsers/environments use `"AbortError"`. The `handleFetchError` method catches both.
- **`capacity` / `refillPerSec` still work** (backwards compat) and are mapped to `syncCapacity` / `syncRefillPerSec`. Tests that set `capacity: N` see that as the sync budget; the seed budget is always separate at its default. This preserves all 88 pre-module-10 tests without modification.
- **The combined default burst (40+20=60) AND combined sustained (60/min) are both exactly CC's ceiling.** Burst: both buckets fill on cold start; combined burst = 60 ≤ ceiling. Sustained: sync refills at 40/60/sec, seed at 20/60/sec; combined = 1/sec = 60/min ≤ ceiling. If CC's real limit turns out to be lower, both values can be tuned via `fromEnv` overrides. Separate env vars for bucket sizes are not yet added (only `timeoutMs` is env-driven) since the split is an internal concern.
- **S4 quirk note from stress test:** The stress agent observed the event loop was NOT starved by the hung fetch (it was held by a Node internal thread). Only the 90 s HTTP client timeout saved it. `AbortSignal.timeout` cuts this to 12 s without relying on the client.

## In-flight work
None — module complete.

## New dependencies added
None.

## Decisions made during this module's build (also in DECISIONS.md)
See DECISIONS.md rows dated 2026-06-08 for:
- CC_TIMEOUT_MS default (12 000 ms)
- CcRateLimitError status reconciliation (429 seed vs 503 barcode)
- Split-bucket design and CC ceiling safety
