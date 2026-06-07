# Module 13 — write-concurrency

## What this module does

Closes two race-condition findings from the `/compile-stress` phase that were
recorded as planned hardening work in STRESS_TEST_RESULTS.md:

- **S8** — `prisma.dim.upsert` insert-path race in `saveDim`.
- **M1** — `getProgress` torn-read window.

All changes are backend-only. No new routes, no DB schema changes, no frontend
changes.

---

## S8 — `saveDim` insert-path race

### The problem

`dimService.saveDim()` previously:
1. Called `prisma.sku.findUnique` to confirm the SKU exists.
2. Called `prisma.dim.upsert` to write the dim row.

Both calls used the global `prisma` client with no transaction or locking.

For a **first-capture** (no dim row yet), 40 concurrent requests for the same
SKU would all pass step 1 and all attempt the upsert. Prisma's `upsert` emits
`INSERT ... ON CONFLICT (skuId) DO UPDATE`, so the DB-level result was always
one coherent row — but the autoincrement sequence was burned for every failed
insert attempt, and correctness rested on the driver's implicit ON-CONFLICT
retry rather than on an explicit serialisation strategy.

### The fix

`saveDim` now wraps both the `findUnique` and the `upsert` in a call to
`withAdvisoryLock(prisma, skuLockKey(skuId), cb)`.

- `withAdvisoryLock` is a new shared helper extracted into `src/lib/db.ts`.
  It issues `pg_try_advisory_xact_lock(<key>)` as the first statement of an
  interactive transaction; if the lock is acquired it runs `cb(tx)` and
  returns the result; if not it returns `null` without running the callback.
- The lock key is derived per-SKU via an FNV-1a 64-bit hash of the namespace
  prefix `"dim-capture:capture:"` concatenated with the `skuId` string,
  reduced to 63 bits (positive signed bigint for Postgres).  Different SKUs
  get different keys so concurrent captures of DISTINCT SKUs are never
  serialised against each other.
- Validation (`zod` parse) runs before `withAdvisoryLock` is called — an
  invalid body bails with a 422 before any DB or lock interaction.
- `saveDim` now returns `null` when the lock is contended.  This is the
  correct semantic: another capture of the same SKU is in flight; the caller
  (the route handler) should treat `null` as a no-op.

### Why advisory lock rather than raw ON-CONFLICT

The C1 sync fix (DECISIONS.md 2026-06-04) established the advisory-lock
pattern as the codebase standard.  Generalising it via a shared helper is
consistent and makes the mutual-exclusion intent explicit in code.  A pure
ON-CONFLICT approach is already present at the DB level and would eliminate
the sequence burn — but it doesn't protect the read-then-write pair
(`findUnique` → `upsert`) as a unit, and it doesn't document the concurrency
contract in code the way an advisory lock does.

### Shared `withAdvisoryLock` helper

Extracted to `src/lib/db.ts`.  Both `syncService` (C1) and `dimService` (S8)
use it.  `syncService` was updated to call the helper; its C1 behaviour is
identical — the lock key, the `{ timeout: 120_000, maxWait: 10_000 }` options,
and the `null`-result "already running" path are all preserved.

---

## M1 — `getProgress` torn-read window

### The problem

`skuService.getProgress()` previously ran three `count()` queries via
`Promise.all`:

```typescript
const [total, captured, syncedToCC] = await Promise.all([
  prisma.sku.count(),
  prisma.dim.count(),
  prisma.dim.count({ where: { syncedToCC: true } }),
]);
```

These are three independent DB round-trips.  A write between any two of them
produces an incoherent snapshot (e.g. `captured > total`, or
`syncedToCC > captured`).  The stress test confirmed no observable incoherence
in 200 samples under churn — but the window is real.

### The fix

All three counts are now issued inside a single `prisma.$transaction([...])`:

```typescript
const [total, captured, syncedToCC] = await prisma.$transaction([
  prisma.sku.count(),
  prisma.dim.count(),
  prisma.dim.count({ where: { syncedToCC: true } }),
]);
```

Prisma's batch `$transaction` (array form) wraps all queries in one DB
transaction, so they share a single consistent snapshot.

---

## Out of scope

- Write-back safety beyond what C1+S8 cover (e.g. distributed cluster lock
  across multiple Node processes) — single-NUC deployment, one process.
- Retrying the lock-contended path at the service level — the caller (frontend
  sync loop) drives retries on a 30 s cadence; a one-shot no-op is fine.

## Acceptance criteria

1. `saveDim` runs the SKU-check + upsert inside `withAdvisoryLock`, keyed by skuId.
2. A contended `saveDim` returns `null` without touching the DB.
3. `getProgress` issues its three counts inside one `prisma.$transaction([...])`.
4. The `withAdvisoryLock` helper is in `lib/db.ts` and is used by BOTH
   `syncService` (C1) and `dimService` (S8).
5. All existing syncService C1 tests still pass unchanged in behaviour.
6. `npx tsc --noEmit` clean; all tests green.
