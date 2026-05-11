# Module: sku-seed

## Purpose
Implement the SKU-related API routes: the admin seed endpoint that pulls all Forage products from CartonCloud into the local DB, plus the SKU lookup and progress routes the frontend uses during capture. The seed is idempotent — safe to re-run, it upserts not inserts.

## In scope
- `backend/src/routes/skus.ts` — mounts at `/api/skus`
- `backend/src/routes/admin.ts` — mounts at `/api/admin`
- `POST /api/admin/seed` — paginate all CC products (`GET /products?warehouseAccountId=&page=&pageSize=100`), upsert into Sku table, mark `ccDimsCaptured = true` for any product that already has dims in CC
- `GET /api/skus` — return all SKUs with dim capture status: `{ total, captured, skus: [{ id, barcode, name, hasDims }] }`
- `GET /api/skus/:barcode` — lookup by barcode: local DB first, CC API fallback, 404 if not found in either
- `GET /api/progress` — `{ total, captured, syncedToCC, pendingSync, percentage }`
- Unit tests for each route (mocked DB + CC client)

## Out of scope
- Dim capture or sync logic — dim-api
- Frontend — modules 05–07
- Pagination UI — progress-review

## Dependencies
- `backend-core` — uses `prisma`, `AppError`, Express app
- `cc-client` — uses `ccClient.lookupByBarcode`, paginated product list (new method needed: `listProducts(warehouseId, page, pageSize)`)

## Public interface (what this module exports)

```typescript
// Express routes mounted on app — no direct TS exports
// GET /api/skus           → SkuListResponse
// GET /api/skus/:barcode  → SkuDetail | 404
// GET /api/progress       → ProgressResponse
// POST /api/admin/seed    → SeedReport
```

## Acceptance criteria
- [ ] `POST /api/admin/seed` paginates until all products fetched (handles multi-page CC response)
- [ ] Seed is idempotent — running twice does not duplicate SKUs
- [ ] Products with existing CC dims are marked `ccDimsCaptured = true`
- [ ] `GET /api/skus` returns correct `total` and `captured` counts
- [ ] `GET /api/skus/:barcode` returns SKU from local DB when present
- [ ] `GET /api/skus/:barcode` falls back to CC API and upserts the SKU locally on miss
- [ ] `GET /api/skus/:barcode` returns 404 when not in DB or CC
- [ ] `GET /api/progress` counts match DB state accurately
- [ ] Unit tests pass with mocked Prisma + CcClient

## Notes
`listProducts` may need to be added to `ccClient` from module 02 — if it's not already there, add it in this module's build and note the cc-client STATE.md is extended. Seed endpoint requires `CC_WAREHOUSE_ID` env var. Expected total: ~460 products for the Forage account.
