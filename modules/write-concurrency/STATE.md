# State: write-concurrency

> This file is the handoff record between conversations. Keep it accurate.
> Other modules will load THIS FILE (not source) to understand what this module exports.

## Status
✅ Built — 2026-06-08

## Branch
`feature/hardening` (shared with modules 09, 10, 11)

## Last touched
2026-06-08 — module built (S8 advisory lock on saveDim, M1 progress txn,
`withAdvisoryLock` helper extracted). tsc clean; **115/115** tests (+8 new in
`writeConcurrency.test.ts`).

2026-06-08 — module 13 hardening: blocking advisory lock for capture. tsc
clean; **116/116** tests (+1 net; writeConcurrency rewritten to 9 tests).

## What changed

### `backend/src/lib/db.ts` (extended)

Added `withAdvisoryLock<T>(prismaClient, lockKey, fn, opts?)`:
- `opts.blocking` selects the Postgres lock function:
  - `blocking: false` (default) — `pg_try_advisory_xact_lock(<key>)`:
    non-blocking; acquire-or-return-null.  Used by syncService (C1) — a
    contended sync run is skipped so CC is never double-PATCHed.
  - `blocking: true` — `pg_advisory_xact_lock(<key>)`: BLOCKING; waits
    inside the transaction until the lock is available, then always
    acquires and runs the callback.  Never returns null on contention.
    Used by dimService.saveDim (S8 hardening).
- `pg_advisory_xact_lock` returns void — no "did we get it?" check in
  blocking mode.
- `opts.timeout` / `opts.maxWait` forwarded to `$transaction`; defaults
  match Prisma's interactive-tx defaults (5 s / 2 s).

Added `AdvisoryLockOptions.blocking?: boolean` field (exported).

### `backend/src/services/dimService.ts` (updated — S8 + module 13 hardening)

`saveDim(raw)`:
- Validation (zod) runs first, before any DB interaction (unchanged).
- The `findUnique` (SKU check) + `dim.upsert` are now wrapped in
  `withAdvisoryLock(prisma, skuLockKey(skuId), cb, { blocking: true })`.
- `blocking: true` means concurrent same-SKU captures serialise: the loser
  waits for the winner's transaction to commit, then runs its own upsert
  (DO UPDATE path) and returns a real row.  Never returns null on contention.
- Return type is now `Promise<Dim>` — the null branch is eliminated.
  Callers/routes can rely on a real row or a thrown AppError.
- Added `skuLockKey(skuId)`: FNV-1a 64-bit hash of
  `"dim-capture:capture:" + skuId`, reduced to 63-bit positive bigint.

Added internal helpers `DIM_CAPTURE_LOCK_NAMESPACE` and `skuLockKey` (not
exported — internal to dimService).

### `backend/src/services/syncService.ts` (updated — C1 refactor)

`syncUnsyncedDims()` now calls `withAdvisoryLock(prisma, SYNC_LOCK_KEY, cb, opts)`
instead of the previous inline `prisma.$transaction(cb, opts)` + manual
`pg_try_advisory_xact_lock` check. The C1 behaviour is **identical**:
- Same lock key (`7_213_544_982_017_336_001n`).
- Same `{ timeout: 120_000, maxWait: 10_000 }` options.
- Same `null`-result "already running" path: reads the live pending count from
  global `prisma.dim.count` and returns `{ synced:0, failed:0, pending }`.

### `backend/src/services/skuService.ts` (updated — M1)

`getProgress()` wraps its three counts in `prisma.$transaction([...])` (batch
array form) instead of `Promise.all`. The three count queries share one DB
snapshot, closing the torn-read window.

### `backend/src/__tests__/writeConcurrency.test.ts` (new + updated — module 13)

9 tests total:
- **S8** (7): `withAdvisoryLock` called with `blocking: true`; saveDim returns
  the upserted Dim (never null); invalid body → 422 before lock; upsert payload
  correct; 404 propagates from inside the lock; lock key is a bigint and stable
  across same-skuId calls; sync opts do NOT pass `blocking: true` (C1 unchanged).
  Removed: the old "lock contended → returns null" test (blocking mode
  eliminates that path — null from saveDim is now a compile-time + test error).
- **M1** (2): `$transaction` called once with array of 3 promises; zero-SKU
  case produces percentage 0.

### `backend/src/__tests__/dimService.test.ts` (updated)

Mock factory updated to export `withAdvisoryLock` alongside `prisma`.
`beforeEach` re-establishes the `withAdvisoryLock` mock implementation after
`vi.resetAllMocks()`.

### `backend/src/__tests__/syncService.test.ts` (updated)

Mock factory updated to export `withAdvisoryLock` (which the service now
imports) alongside `prisma`. All C1 lock behaviour is preserved; the test
stubs now mock `withAdvisoryLock` directly (passing the tx stub through the
callback) rather than mocking `prisma.$transaction` + `tx.$queryRaw` inline.
`lockAcquired()` / `lockContended()` helpers updated accordingly.

### `backend/src/__tests__/skuService.test.ts` (updated)

Mock factory updated to include `prisma.$transaction` (array form) so the
M1 `getProgress` fix works through the mock. `beforeEach` re-establishes the
`$transaction` implementation after `vi.resetAllMocks()`.

## Public interface additions

```typescript
// backend/src/lib/db.ts

export interface AdvisoryLockOptions {
  timeout?: number;  // default: 5_000 (Prisma interactive-tx default)
  maxWait?: number;  // default: 2_000 (Prisma interactive-tx default)
  blocking?: boolean; // default: false (pg_try_advisory_xact_lock);
                      // true → pg_advisory_xact_lock (waits; never null)
}

/**
 * Run fn(tx) inside a Postgres transaction gated on a transaction-scoped
 * advisory lock keyed by lockKey.
 *
 * Non-blocking (default): returns null if the lock is contended.
 * Blocking (opts.blocking: true): waits; always acquires; never returns null.
 */
export async function withAdvisoryLock<T>(
  prismaClient: PrismaClient,
  lockKey: bigint,
  fn: (tx: TxClient) => Promise<T>,
  opts?: AdvisoryLockOptions,
): Promise<T | null>;
```

`saveDim` return type is now `Promise<Dim>` — the null-on-contention case is
eliminated by the blocking lock.  Callers receive a real row or a thrown
AppError (422 validation / 404 unknown SKU).

## Advisory lock key registry

| Key | Source | Value / derivation | Holder |
|-----|--------|--------------------|--------|
| `SYNC_LOCK_KEY` | `syncService.ts` | `7_213_544_982_017_336_001n` (fixed, arbitrary) | All `POST /api/sync/cc` runs |
| `skuLockKey(skuId)` | `dimService.ts` | FNV-1a 64-bit of `"dim-capture:capture:" + skuId`, masked to 63 bits | Per-SKU `POST /api/dims` captures |

Namespace prefixes prevent key collisions between the sync lock and any
per-SKU lock, regardless of what the skuId hash produces.

## Test status
- [x] Unit tests written: +8 (writeConcurrency.test.ts) new; dimService (+0 new,
      updated mocking); syncService (+0 new, updated mocking); skuService (+0 new,
      updated mocking to add $transaction).
- [x] All tests passing: `npm test` → **115/115** (was 107; +8 new).
- [x] Typecheck clean: `npx tsc --noEmit` exit 0.
- [x] Module 13 hardening: writeConcurrency rewritten (9 tests, +1 net);
      `npm test` → **116/116**; `npx tsc --noEmit` exit 0.

## Quirks / gotchas

- **`saveDim` no longer returns `null`.**  Fixed by module 13 hardening:
  `withAdvisoryLock` is now called with `{ blocking: true }`, which uses
  `pg_advisory_xact_lock` (the BLOCKING variant).  Concurrent captures serialise
  — the loser waits rather than bailing — so every valid capture returns a real
  Dim row.  The old 200-null data-loss path (try-lock → null → route sends null
  → frontend shows "Saved!" and drops the queue entry) is eliminated.
- **Sync uses the NON-BLOCKING try-lock, by design.**  `syncService` must NOT
  double-PATCH CC, so a contended sync run still returns null → returns the
  "already running" report.  The `blocking` option defaults to `false`, so
  sync is unaffected by the dimService change.
- **syncService's `null`-path reads from global `prisma`**, not `tx`.  This is
  intentional: after a contended lock the transaction has already committed/
  rolled back, so there is no `tx` to use.  The pending count is a live
  best-effort read, consistent with the existing C1 behaviour.
- **FNV-1a hash collision probability** is negligible for ~460 stable CC product
  UUIDs.  If the SKU set grows to millions, revisit (use a stronger hash or a
  lock table).
- **`withAdvisoryLock` timeout defaults**: dimService uses the Prisma defaults
  (5 s / 2 s) because captures are expected to be fast (two DB ops, no external
  HTTP). `syncService` overrides to 120 s / 10 s to accommodate batched CC HTTP
  calls held inside the transaction.

## In-flight work
None — module complete.

## New dependencies added
None.

## Decisions made during this module's build (also in DECISIONS.md)
See DECISIONS.md rows dated 2026-06-08 for:
- S8 approach: advisory lock via shared `withAdvisoryLock` helper (not raw ON CONFLICT)
- `withAdvisoryLock` helper extracted to `lib/db.ts`; shared by syncService + dimService
- M1 fix: `prisma.$transaction([...])` array form for consistent read
- Per-SKU lock key: FNV-1a 64-bit hash of namespace + skuId, masked to 63 bits
