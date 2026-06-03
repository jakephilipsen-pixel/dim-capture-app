# dim-capture-app — Data-Integrity / Concurrency Stress Test

Date: 2026-06-04
Targets: backend `http://localhost:3012`, frontend+nginx proxy `http://localhost:5179`
CC: in-container mock (`dimcap-cs-mock-cc-1`, `dist/smoke/mockCc.js`, port 9099) — no real CC touched.
DB verification: read-only `psql -U gocold -d dimcapture` on `dimcap-cs-postgres-1`.

## OVERALL: FAIL

One **Critical** defect: `POST /api/sync/cc` is not idempotent under concurrency — concurrent
sync runs double-PATCH every pending dim to CartonCloud and each over-reports `synced`. This is a
realistic floor scenario (offline-queue drain overlapping the 30s background sync). Everything
else (unique constraint, upsert coherence, POST/PUT race, seed idempotency, sync-state reset,
counter coherence) PASSED.

Severity tally: Critical 1, Significant 1, Minor 2.

---

## FINDING 1 — Concurrent `POST /api/sync/cc` double-PATCHes CC and over-counts `synced`  [CRITICAL]

**Title:** Sync has no claim/lock between "read unsynced" and "mark synced" → N concurrent runs each
PATCH every pending dim N times and each report the full count as `synced`.

**Root cause (code):** `syncService.syncUnsyncedDims()` does
`prisma.dim.findMany({where:{syncedToCC:false}})` → loop `ccClient.patchProductDims()` then
`prisma.dim.update({syncedToCC:true})`, with **no row claim, no transaction, no advisory lock,
no in-process mutex**. Concurrent runs all read the same unsynced set before any has marked a row,
so all of them PATCH all of those dims and all increment `synced`.

**Evidence:**
- Setup: re-captured all 4 SKUs (cc-1, cc-2, cc-3, cc-9) → 4 dims `syncedToCC=false`.
- Fired 5 concurrent `POST /api/sync/cc`.
- Observed: every run returned `{"synced":4,"failed":0,"pending":0}` → **20 "synced" reported for 4 dims.**
- Ground truth via backend log `"patched product dims in CartonCloud"`: delta **20** PATCHes
  (baseline 71 → 91). Per-product tally: `5 × cc-1, 5 × cc-2, 5 × cc-3, 5 × cc-9` — i.e. **every
  product PATCHed to CC 5 times** in one burst.
- Final DB state is itself correct (all 4 `syncedToCC=t`, `pending=0`) — the corruption is the
  redundant outbound CC writes + the misleading `synced` totals, not the local row state.

**Why it matters here (not theoretical):**
- The real CC client has a token-bucket limiter (60 tokens, refill 1/sec, **rejects** when empty).
  A 5×-amplified burst burns 5× the budget and will throw `CcRateLimitError` once the bucket drains,
  leaving some real dims unsynced and the operator's sync report inflated.
- The frontend runs a 30s background auto-sync AND an offline-queue drain; these legitimately overlap,
  so two+ `POST /api/sync/cc` in flight is a normal floor condition, not a contrived one.
- It is timing-dependent: re-tested via the nginx proxy with only **1** pending dim and 3 concurrent
  runs — that time the runs serialised (delta = 1 PATCH), so the window can be missed. With 4 pending
  dims fired together (above) it hit 100%. A wider pending set = wider window = reliably triggered.

**Repro:**
```
for s in cc-1 cc-2 cc-3 cc-9; do curl -s -X POST :3012/api/dims \
  -d '{"skuId":"'$s'","lengthMm":111,"widthMm":80,"heightMm":60,"weightKg":1,"measuredBy":"x"}' \
  -H 'Content-Type: application/json'; done
for i in 1 2 3 4 5; do curl -s -X POST :3012/api/sync/cc & done; wait
# each prints {"synced":4,...}; backend logs show 20 PATCHes (5 per product)
```

**Fix direction:** claim rows before PATCHing (e.g. `UPDATE ... SET syncedToCC=true WHERE id IN(...)
AND syncedToCC=false RETURNING id` as the claim, then PATCH the claimed set and only roll the row
back to `false` on PATCH failure), OR a single-flight guard / advisory lock around the run so only
one sync executes at a time. `synced` must reflect rows this run actually claimed, not the whole
unsynced set.

---

## FINDING 2 — `prisma.dim.upsert` insert-path race: heavy internal retry / sequence burn  [SIGNIFICANT]

**Title:** Concurrent first-capture of the same skuId converges to one correct row, but only because
Prisma's upsert retries the unique-violation as an update; there is no transaction/serialization and
the insert race burns the autoincrement sequence hard.

**Root cause (code):** `dimService.saveDim()` does a bare `prisma.dim.upsert({where:{skuId}})` with no
transaction. `Dim.skuId @unique` + `id @default(autoincrement())`. When the row doesn't yet exist,
concurrent upserts all take the create path, collide on the unique skuId, and retry.

**Evidence:**
- 40 concurrent `POST /api/dims` for a **dim-less** SKU (cc-9, created via barcode fallback).
- Result: **all 40 → 200**, exactly **1** row for cc-9, coherent single write
  (`lengthMm=227 / measuredBy=ins27 / notes=i27` — all from the same request, no torn mix),
  **no P2002 leaked**, total dim count correct.
- BUT the surviving row got **id 688** and `Dim_id_seq.last_value` jumped to **777**, for what was
  4 real rows total — ~680+ sequence values consumed by ~80 racing first-captures (this run + the
  40-on-cc-1 run). That is a thundering-herd of failed INSERTs retried under the hood.
- Control: 40 concurrent upserts on a SKU that **already had a row** (cc-1) took the clean update
  path — all 200, 1 coherent row (`134/race34/n34`), no sequence churn.

**Why Significant not Critical:** final state is always correct and no 500 leaks, so no data loss or
operator-visible breakage. But correctness rests entirely on Prisma's retry masking the race; there
is no explicit transaction/locking. Sequence gaps are cosmetic. Under a different driver/version the
same pattern is exactly what produces a leaked P2002. Worth a `@@transaction`/serializable upsert or
documenting the reliance.

**Repro:** `for i in $(seq 1 40); do curl -s -X POST :3012/api/dims -d '{"skuId":"<dimless-sku>",...}' & done; wait`
then `SELECT count(*), max(id) FROM "Dim" WHERE "skuId"=...;` and `SELECT last_value FROM "Dim_id_seq";`

---

## FINDING 3 — `getProgress` reads three counts outside a transaction  [MINOR]

**Title:** `/api/progress` computes total/captured/syncedToCC via `Promise.all` of three independent
`count()` calls and derives `pendingSync = captured - syncedToCC`; the three counts are not a
consistent snapshot.

**Evidence:** Hammered `/api/progress` 200× while concurrently churning capture + sync on cc-2/cc-3.
All **200 samples were coherent** (`captured<=total`, `syncedToCC<=captured`, `pendingSync>=0`,
`pendingSync==captured-syncedToCC`). Final reconcile exact: progress `{4,4,4,0}` == DB `{4,4,4,0}` ==
`/api/dims` (4 rows, 4 synced).

**Why Minor:** the invariant held under adversarial churn; no operator-visible drift was produced.
`pendingSync` is derived from two of the counts so it can never independently disagree, and
`syncedToCC<=captured` is preserved because a dim is always counted in `captured` before it can be
counted in `syncedToCC`. Still a latent torn-read; wrapping the three counts in a transaction or a
single grouped query removes the theoretical window.

---

## FINDING 4 — mock-cc PATCH endpoint is silent (no count/no log)  [MINOR]

**Title:** The in-container CC mock (`smoke/mockCc.ts`) does not log or count PATCHes, so double-PATCH
is only observable from the backend's own `"patched product dims in CartonCloud"` log line, not from CC.

**Why Minor:** test-tooling/observability only — not a product defect. Noted because it made Finding 1
harder to confirm from the CC side; ground truth had to come from the backend log. A real CC (or a
counting mock) would have surfaced the 20-PATCH burst directly.

---

## PASS summary (scenarios that held up)

- **S1 same-skuId upsert race (existing row):** 40 concurrent POSTs on cc-1 → all 200, 1 coherent row,
  no P2002, total stable. PASS.
- **S1b insert-path race (dim-less row):** 40 concurrent POSTs on cc-9 → 1 coherent row, no 500
  (sequence burn noted as Finding 2). Constraint never violated with a leaked 500. PASS (with caveat).
- **S2 POST vs PUT on same dim:** 20 POST + 20 PUT concurrent on dim 688 → all 200, exactly 1 row,
  coherent single writer, no crash, no P2002. PASS.
- **S3 seed idempotency:** 10 concurrent `POST /api/admin/seed` → all 200, SKU count stable at 4,
  no dup-id 500, dims untouched. PASS.
- **S4 sync idempotency (serial):** empty sync → `{0,0,0}`, 0 PATCHes; single sync of 1 pending →
  exactly 1 PATCH. Serial sync is clean. (Concurrent sync = Finding 1.)
- **S5 sync-state reset:** POST overwrite of a synced dim → `syncedToCC=false, syncedAt=null`; re-sync
  flips it true; PUT correction resets it false again; next sync re-syncs (`synced:1`). PASS.
- **S6/S7 counter coherence / transaction boundary:** 200 progress samples under churn, 0 incoherent;
  final progress == DB == /api/dims exactly. PASS (latent torn-read = Finding 3).
