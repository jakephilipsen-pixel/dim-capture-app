# Module 10 — cc-resilience

## What this module does

Hardens the CartonCloud client against two real stress-test findings: an
infinite hang on a frozen CC peer (S4) and a shared rate-limit bucket that
starves seed vs sync and surfaces as 500 instead of 429 (M2).

All changes are in the backend only. No new routes, no DB schema changes,
no frontend changes.

## Scope

### S4 — No timeout on CartonCloud fetch calls

`ccClient.ts` made `fetch` calls with no timeout. The `/compile-stress` chaos
agent confirmed a frozen CC peer hung `POST /api/sync/cc` indefinitely (the
event loop was not starved; only the 90 s client timeout saved it).

**Fix:** every `fetch` call in `ccClient` (`lookupByBarcode`, `patchProductDims`,
`listProducts`) receives `signal: AbortSignal.timeout(this.timeoutMs)`.

- Default timeout: `CC_DEFAULT_TIMEOUT_MS = 12_000` ms, overridable via
  `CC_TIMEOUT_MS` env var.
- When the signal fires, `fetch` rejects with a `DOMException` (`name:
  "TimeoutError"` or `"AbortError"`). The `handleFetchError` private method
  catches any such DOMException and converts it to `CcTimeoutError` — a new
  typed error class that extends `CcApiError` with `statusCode: 504`.
- The raw `DOMException` never escapes to callers; they see only the typed CC
  error hierarchy.

`CcClientOptions` gains an optional `timeoutMs` field (default `CC_DEFAULT_TIMEOUT_MS`).

### M2a — Rate-limit rejection maps to 500 instead of 429

When the token bucket was empty, `CcRateLimitError` propagated uncaught through
`seedSkus()` → admin route → errorHandler → 500 (generic, after S1, but still
wrong status). `syncService` already caught it per-item (it never escaped the
sync loop), but the seed path was unprotected.

**Fix:** `skuService.seedSkus()` wraps the `ccClient.listProducts` loop in
try/catch:
- `CcRateLimitError` → `AppError("…", 429)` — our limiter rejected it, not CC.
- `CcTimeoutError` → `AppError("…", 504)` — upstream timed out.
- `CcApiError` → `AppError("…", 502)` — upstream error.

`skuService.getSkuByBarcode()` (the barcode fallback) gains an explicit
`CcTimeoutError` check before the generic `CcApiError` branch → `AppError("…", 504)`.
The existing `CcRateLimitError` → 503 and `CcApiError` → 502 mappings (from
module 09 S3a) are preserved unchanged.

**Reconciliation with module 09 (CcRateLimitError → 503 on barcode path):**

The two mappings are deliberately different:

| Path | Error | Status | Rationale |
|------|-------|--------|-----------|
| barcode fallback | CcRateLimitError | 503 | The *upstream* (CC's rate limit or our sync budget spilling over) is unavailable — "service unavailable" is accurate for a user-triggered read |
| seed | CcRateLimitError | 429 | The *caller* (admin operator) directly triggered the seed; our limiter rejected it — "too many requests" is the correct signal |

This distinction is documented in DECISIONS.md.

### M2b — Seed and sync share one bucket (starvation + no isolation)

One shared bucket meant a big seed pull (many `listProducts` calls) could
exhaust the 60-token budget, blocking `patchProductDims` on the sync path
until refill.

**Fix:** `CcClient` now maintains **two separate token buckets**:

- `syncBucket`: guards `lookupByBarcode` and `patchProductDims` (sync + lookup
  path). Default capacity: 40 tokens, refill 1/sec.
- `seedBucket`: guards `listProducts` (admin seed path). Default capacity: 20
  tokens, refill 1/sec.

**Combined cap: 40 + 20 = 60 tokens/min → does not exceed CC's 60 req/min
tenant ceiling.**

The split is deliberate: seed is an infrequent admin operation; sync + lookup
are the critical operational path and get the larger share.

`CcClientOptions` gains `syncCapacity`, `syncRefillPerSec`, `seedCapacity`,
`seedRefillPerSec`. The old `capacity` / `refillPerSec` fields are kept as
deprecated aliases for `syncCapacity` / `syncRefillPerSec` so all pre-module-10
tests pass without modification.

## Out of scope
- M7 (sync rate-limit failures not auto-retried) — by design; noted in STRESS_TEST_RESULTS.md.
- S3b (DoS amplifier on unauthenticated barcode endpoint) — module 12 `cc-write-authz`.
- Any queue-based or wait-for-token approach — the reject-not-queue design is
  deliberate (DECISIONS.md 2026-06-03).

## Acceptance criteria
1. Every `ccClient` fetch receives an `AbortSignal.timeout(...)`.
2. A fetch that rejects with `AbortError`/`TimeoutError` → `CcTimeoutError`; no DOMException leaks.
3. `CcTimeoutError` extends `CcApiError` with `statusCode: 504`.
4. `CC_TIMEOUT_MS` env var controls the timeout (default 12 000).
5. `seedSkus()` maps `CcRateLimitError` → 429, `CcTimeoutError` → 504, `CcApiError` → 502.
6. `listProducts` draining the seed bucket does NOT block `lookupByBarcode`/`patchProductDims`.
7. `lookupByBarcode`/`patchProductDims` draining the sync bucket does NOT block `listProducts`.
8. Default seed + sync capacity ≤ 60 (CC tenant ceiling).
9. `npx tsc --noEmit` clean; all tests green.
