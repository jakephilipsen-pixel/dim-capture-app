# State: sku-seed

> This file is the handoff record between conversations. Keep it accurate. Other modules will load THIS FILE (not source) to understand what this module exports.

## Status
✅ Built — smoke passing (2026-06-03)

## Branch
`feature/sku-seed`

## Last touched
2026-06-03 — built from scratch on merged backend-core + cc-client. SKU routes + service, `ccClient.listProducts` extension, zod validation, 21 new unit tests, containerised smoke (Postgres + mock CC). tsc + lint clean, 46/46 tests, smoke green.

## Public interface (the contract other modules see)

HTTP routes only — no TS exports consumed by other modules. The frontend
(modules 05–07) calls these:

```
GET  /api/skus
  → 200 SkuListResponse  { total, captured, skus: [{ id, barcode, name, hasDims }] }

GET  /api/skus/:barcode
  → 200 SkuDetail        { id, barcode, name, hasDims, ccDimsCaptured, source: "db"|"cc" }
  → 400 if barcode is blank/whitespace
  → 404 if unknown to both the DB and CC
  (DB-first; on miss falls back to CC lookup and upserts the result locally)

POST /api/admin/seed
  → 200 SeedReport       { pages, fetched, upserted, ccDimsPresent }
  (paginates all CC products, upserts by id — idempotent; sets ccDimsCaptured
   = true when CC already has L/W/H for a product)

GET  /api/progress
  → 200 ProgressResponse { total, captured, syncedToCC, pendingSync, percentage }
```

The response interfaces are exported from `src/services/skuService.ts`
(`SkuListResponse`, `SkuDetail`, `ProgressResponse`, `SeedReport`,
`SkuSummary`) if a later module wants the types.

## Exports
- `src/services/skuService.ts`:
  - `seedSkus()` → `SeedReport` — paginated, idempotent CC product pull
  - `listSkus()` → `SkuListResponse`
  - `getSkuByBarcode(barcode)` → `SkuDetail` (throws `AppError(404)` on total miss)
  - `getProgress()` → `ProgressResponse`
  - + the response interfaces listed above
- `src/routes/skus.ts`, `src/routes/admin.ts`, `src/routes/progress.ts` — thin Express routers
- **Extends cc-client:** `ccClient.listProducts(warehouseId, page, pageSize)` → `CcProduct[]`
  (added in this module — see cc-client/STATE.md, now updated)

## Internal structure
```
backend/src/
  services/skuService.ts        all business logic (the testable unit)
  routes/skus.ts                GET /api/skus, GET /api/skus/:barcode
  routes/admin.ts               POST /api/admin/seed
  routes/progress.ts            GET /api/progress   (NEW router)
  services/ccClient.ts          +listProducts() method (cc-client, extended here)
  app.ts                        +mounts /api/progress (backend-core, edited here)
  smoke/mockCc.ts               DEV/SMOKE-ONLY mock CartonCloud (never in prod CMD)
  __tests__/skuService.test.ts        15 tests (mocked prisma + ccClient)
  __tests__/skuRoutes.test.ts         7 tests (supertest vs real app, mocked service)
  __tests__/ccClientListProducts.test.ts  4 tests (listProducts, mocked fetch)
modules/sku-seed/
  docker-compose.smoke.yml      postgres + mock-cc + backend (host port 3009)
  smoke/healthcheck.sh          polls /api/health for db:connected
  smoke/happy-path.sh           seed → idempotent → db-first → cc-fallback → 404 → progress
```

## Quirks / gotchas
- **`/api/progress` is top-level, NOT `/api/admin/progress`.** backend-core stubbed
  it under admin; the spec (line 135) + brief say `/api/progress`, and the spec wins.
  Resolved by adding `routes/progress.ts` and mounting it in `app.ts` (the admin
  `/progress` stub was removed). See DECISIONS.md 2026-06-03.
- **`CC_WAREHOUSE_ID` env var is required** for `POST /api/admin/seed` and the
  CC-fallback branch of `GET /api/skus/:barcode`. Unset → `AppError(500)` BEFORE any
  CC call. Already in `.env.example`.
- **Seed idempotency = `prisma.sku.upsert` keyed on CC product id** (never a bare
  insert). The CC-fallback in `getSkuByBarcode` also upserts by id (not create) so a
  barcode miss whose product id already exists can't trip the unique-id constraint.
- **`hasDims`/`captured` mean a LOCAL `Dim` row exists** — distinct from
  `ccDimsCaptured` (dims already in CC before we started). A freshly seeded SKU has
  `hasDims=false` even if `ccDimsCaptured=true`. Dim rows are created by dim-api (04).
- **`SeedReport.fetched` counts rows CC returned; `upserted` counts rows written.**
  They differ only when CC returns a malformed row (missing id or barcode) — those are
  skipped with a warning, not stored.
- **Pagination stops on a short page** (`< pageSize=100`) or an empty page; a 404 on the
  list endpoint is treated as end-of-results (empty), not an error.
- **Test isolation:** `skuService.test.ts` uses `vi.resetAllMocks()` (not
  `clearAllMocks`) in `beforeEach` — `clearAllMocks` does NOT drain the
  `mockResolvedValueOnce` queue, so queued pages leak between tests. Reuse this for any
  time/queue-based mocks in 04.
- **Smoke uses `dist/smoke/mockCc.js`** (same dev-only-entry pattern as cc-client) booted
  in the real backend image as a second service; the prod CMD never runs it. Backend on
  host port **3009** (3005/3007/3008 taken elsewhere); Postgres + mock-cc are
  internal-only (no host ports → no clash with the dev DB on 5434).

## Test status
- [x] Unit tests written — 26 new (15 service + 7 route + 4 listProducts)
- [x] Unit tests passing (`npm test` → 46/46 incl. backend-core 7 + cc-client 13)
- [x] Typecheck clean (`npx tsc --noEmit` exit 0), lint clean (`npm run lint` exit 0)
- [x] Smoke written + passing (`./scripts/smoke-module.sh sku-seed` exit 0): health
      db:connected, seed (3 products, 1 with CC dims), idempotent re-seed, DB-first
      lookup, CC-fallback upsert (table grows 3→4), unknown-barcode 404, top-level
      `/api/progress`. Clean teardown, no orphans.
- [x] Integration with dependencies verified (real Prisma migrate on fresh Postgres +
      live ccClient against in-container mock CC, in the smoke container)

## In-flight work
None — module complete.

## New dependencies added
- `zod` (prod) — request validation on route handlers
- `supertest` + `@types/supertest` (dev) — route-level tests against the real app

## Decisions made during this module's build (also in DECISIONS.md)
- 2026-06-03 | `GET /api/progress` mounted top-level (new `routes/progress.ts` + `app.ts`
  mount), not under `/api/admin` where backend-core stubbed it | spec line 135 + brief
  say `/api/progress`; spec wins | confirmed with Jake before building
- 2026-06-03 | `ccClient.listProducts(warehouseId, page, pageSize)` added to the
  cc-client service in this module | brief anticipated it; cc-client STATE.md extended
- 2026-06-03 | Route logic extracted into `skuService.ts`; routers stay thin | keeps
  business logic unit-testable with mocked prisma/ccClient (no supertest needed for
  logic depth; supertest used only for routing/validation/error-mapping coverage)
