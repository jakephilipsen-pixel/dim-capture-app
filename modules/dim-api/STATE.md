# State: dim-api

> This file is the handoff record between conversations. Keep it accurate. Other modules will load THIS FILE (not source) to understand what this module exports.

## Status
✅ Built — smoke passing (2026-06-03)

## Branch
`feature/dim-api` (branched from `main` after sku-seed/#3 merged)

## Last touched
2026-06-04 — C1 concurrency fix (branch `fix/sync-concurrency`).
`syncUnsyncedDims()` now runs inside a single interactive `prisma.$transaction`
guarded by a TRANSACTION-scoped Postgres advisory lock
(`pg_try_advisory_xact_lock(SYNC_LOCK_KEY)`, key `7213544982017336001n`). Only
one `POST /api/sync/cc` run executes at a time; a concurrent caller fails the
non-blocking `try`-lock and returns early `{synced:0, failed:0, pending:<live
count>}` WITHOUT reading the unsynced set or PATCHing — so two overlapping
calls (Review "Sync Now" racing the 30 s auto-sync) can no longer double-PATCH
the real CC or burn its 60/min token bucket. All DB ops inside the callback use
the `tx` client (one pooled connection); `ccClient` stays external HTTP. Chose a
txn-scoped lock (auto-releases on commit/rollback) over a session
`pg_advisory_lock`+`pg_advisory_unlock` pair, which can land on different pooled
connections and leak the lock forever. Explicit `{ timeout: 120_000, maxWait:
10_000 }` because the 5 s interactive-tx default is too short for batched CC HTTP
held inside the transaction (module 10 `cc-resilience`'s fetch timeout will
bound per-call duration). tsc + lint clean, **72/72** tests (was 69; +3
syncService concurrency tests; the 5 existing syncService tests updated to mock
`$transaction`/`tx.$queryRaw`). Cross-process exactly-once proof needs real
Postgres — orchestrator's job via the live container stack.

2026-06-03 — built from scratch on merged backend-core + cc-client + sku-seed.
Dim capture/correct/list routes + batch sync to CC, zod validation in the
service layer, 23 new unit tests, containerised smoke (Postgres + mock CC with
a new PATCH endpoint). tsc + lint clean, 69/69 tests, smoke green.

## Public interface (the contract other modules see)

HTTP routes — the frontend (modules 05–07) calls these:

```
POST /api/dims
  body { skuId, lengthMm, widthMm, heightMm, weightKg, measuredBy, notes? }
  → 200 Dim                 (saved/overwritten — one dim per SKU, upsert)
  → 422 if any dim ≤ 0, weight ≤ 0, or skuId/measuredBy blank
  → 404 if skuId is unknown to the local DB

GET  /api/dims
  → 200 DimWithSku[]        (most-recent first; each row includes
                             sku:{ name, barcode })

PUT  /api/dims/:id
  body { lengthMm, widthMm, heightMm, weightKg, measuredBy, notes? }
  → 200 Dim                 (correction — overwrites + resets sync state)
  → 400 if :id is not a positive integer
  → 404 if no dim with that id
  → 422 on the same body rules as POST

POST /api/sync/cc
  → 200 SyncReport { synced, failed, pending }
  (pushes every syncedToCC=false dim to CC in batches of 10; one CC failure
   never aborts the run — it's logged, left unsynced, retried next call)
```

```typescript
// src/services/syncService.ts
export interface SyncReport {
  synced: number;   // PATCHed to CC successfully this run
  failed: number;   // errored this run (left unsynced)
  pending: number;  // live DB count of syncedToCC=false after the run
}

// src/services/dimService.ts
export interface DimWithSku { /* Dim fields + sku:{ name, barcode } */ }
export const captureSchema;     // zod — POST body
export const correctionSchema;  // zod — PUT body (captureSchema without skuId)
export type CaptureInput; export type CorrectionInput;
```

## Exports
- `src/services/dimService.ts`:
  - `saveDim(raw)` → `Dim` (validates 422, 404 on unknown SKU, upserts by skuId)
  - `listDims()` → `DimWithSku[]` (newest first, SKU name+barcode joined)
  - `updateDim(id, raw)` → `Dim` (404 if absent, resets sync state)
  - `captureSchema`, `correctionSchema`, `CaptureInput`, `CorrectionInput`, `DimWithSku`
- `src/services/syncService.ts`:
  - `syncUnsyncedDims()` → `SyncReport` (batch sync to CC, per-item error isolation)
  - `SyncReport` interface
- `src/routes/dims.ts`, `src/routes/sync.ts` — thin Express routers (mounted by
  backend-core's `app.ts` at `/api/dims` and `/api/sync`; route-files only —
  no `app.ts` edit was needed, the mounts already existed as 501 stubs)

## Internal structure
```
backend/src/
  services/dimService.ts        capture/list/correct logic + zod schemas (the unit)
  services/syncService.ts       batch CC sync + SyncReport (the unit)
  routes/dims.ts                POST/GET/PUT /api/dims (filled the 501 stubs)
  routes/sync.ts                POST /api/sync/cc       (filled the 501 stub)
  smoke/mockCc.ts               +PATCH /products/{id} (extended for this smoke)
  __tests__/dimService.test.ts        10 tests (mocked prisma)
  __tests__/syncService.test.ts        5 tests (mocked prisma + ccClient)
  __tests__/dimRoutes.test.ts          8 tests (supertest vs real app, mocked services)
modules/dim-api/
  docker-compose.smoke.yml      postgres + mock-cc + backend (host port 3010)
  smoke/healthcheck.sh          polls /api/health for db:connected
  smoke/happy-path.sh           seed → capture → 422/404 → join → sync → PUT reset
```

## Quirks / gotchas
- **One dim per SKU.** `Dim.skuId @unique`, so `POST /api/dims` is an UPSERT keyed
  on `skuId`, never a bare insert. Re-capturing a SKU overwrites its dim and
  resets `syncedToCC=false`/`syncedAt=null` + re-stamps `measuredAt`. There is no
  way to hold two dim rows for one SKU. (DECISIONS.md 2026-06-03.)
- **CC product id == `Dim.skuId`.** `Sku.id` is the CartonCloud product UUID, so
  sync calls `ccClient.patchProductDims(dim.skuId, …)` directly — no barcode
  lookup before PATCH.
- **Sync never throws on a single CC failure.** Each PATCH is in its own
  try/catch; a failure is logged via pino, the dim stays `syncedToCC=false`, and
  the loop continues to the next dim and next batch. The endpoint only 500s if the
  *initial* `findMany`/final `count` query itself throws.
- **Sync runs are serialised by a transaction-scoped advisory lock (C1 fix,
  2026-06-04).** The entire run is one `prisma.$transaction`; its first statement
  is `pg_try_advisory_xact_lock(SYNC_LOCK_KEY)` (`7213544982017336001n`). A run
  that loses the lock returns early `{0,0,<pending>}` and PATCHes nothing — so
  concurrent `POST /api/sync/cc` calls can't double-PATCH. The lock is *not* a
  session-level lock+unlock pair (those leak across Prisma's connection pool); the
  txn-scoped lock auto-releases on commit/rollback. The transaction holds open
  across the CC HTTP calls, so `{ timeout: 120_000, maxWait: 10_000 }` is set
  (5 s default too short); module 10 `cc-resilience` will bound per-call time.
  DB ops inside use `tx`, never the global `prisma`.
- **`pending` is the live DB count after the run**, not `failed` inferred — so a
  partial sync of 3 with 1 failure reports `{synced:2, failed:1, pending:1}`.
- **Validation lives in the service** (`dimService` zod schemas), not the route.
  Routes forward `req.body` to the service and only validate the `:id` param.
  zod is invoked via `safeParse`; the first issue maps to `AppError(422)` — the
  shared `errorHandler` does NOT auto-map raw `ZodError` (→ 500), so never let one
  escape the service.
- **Units are mm / kg, stored verbatim** and passed to CC unchanged (cc-client
  does no conversion). The capture UI (module 06) owns any cm/in→mm conversion.
- **Smoke needs a Sku row first.** `POST /api/dims` 404s on an unknown skuId, so
  the smoke seeds via `POST /api/admin/seed` (sku-seed, now on main) against the
  mock CC before capturing. The mock CC gained a `PATCH /products/{id}` handler
  (200 known id / 404 unknown) for the sync step — additive, GET behaviour intact.
- **Smoke host port 3010** (3005 dev / 3007 cc-client / 3009 sku-seed avoided).
- **Test isolation:** `beforeEach(vi.resetAllMocks())` — same as sku-seed; drains
  any `mockResolvedValueOnce` queue (the partial-failure sync test relies on it).

## Test status
- [x] Unit tests written — 23 (dim-api build) + 3 (C1 fix, 2026-06-04) = 26 in
      this module's slice (13 dimService/syncService: 10 dimService + 8 syncService
      now [was 5] + 8 dimRoutes)
- [x] Unit tests passing (`npm test` → 72/72 as of 2026-06-04; was 69/69 at
      dim-api build incl. backend-core 7 + cc-client 13 + sku-seed 26; +3 from the
      C1 syncService concurrency tests)
- [x] Typecheck clean (`npx tsc --noEmit` exit 0), lint clean (`npm run lint` exit 0)
- [x] Smoke written + passing (`./scripts/smoke-module.sh dim-api` exit 0): health
      db:connected; empty→seed→capture→422 (zero dim)→404 (unknown SKU)→list with
      joined SKU name→progress→sync (CC PATCH)→synced→PUT correction resets sync.
      Clean teardown, no orphans.
- [x] Integration with dependencies verified (real Prisma migrate on fresh
      Postgres + live ccClient PATCH against in-container mock CC, in the smoke container)

## In-flight work
None — module complete.

## New dependencies added
None. `zod` (prod) and `supertest`/`@types/supertest` (dev) were already present
from sku-seed; this module reuses them.

## Decisions made during this module's build (also in DECISIONS.md)
- 2026-06-03 | `POST /api/dims` upserts the SKU's single dim; re-capture resets
  sync state | one-dim-per-SKU schema; overwrite is a fresh measurement | confirmed with Jake
- 2026-06-03 | `SyncReport.pending` = live DB count of `syncedToCC=false` after the
  run; spec's 12/0/34 example treated as illustrative, not a per-call cap | confirmed with Jake
- 2026-06-03 | Validation lives in `dimService` (shared zod schemas), routes stay
  thin | brief wants dimService validation tests; single source of truth
- 2026-06-03 | Extended `smoke/mockCc.ts` with `PATCH /products/{id}` | sync smoke
  needs a CC PATCH target; additive, GET behaviour untouched
