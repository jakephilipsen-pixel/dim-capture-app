# Module: dim-api

## Purpose
Implement the dimension capture and sync API. Pickers POST dims against a SKU; those dims can be corrected via PUT. A sync endpoint batches unsynced dims to CartonCloud in groups of 10 with retry on failure. This is the core data-writing module of the backend.

## In scope
- `backend/src/routes/dims.ts` — mounts at `/api/dims`
- `backend/src/routes/sync.ts` — mounts at `/api/sync`
- `backend/src/services/dimService.ts` — capture validation logic
- `backend/src/services/syncService.ts` — batch sync to CC with retry
- `POST /api/dims` — save a capture. Body: `{ skuId, lengthMm, widthMm, heightMm, weightKg, measuredBy, notes? }`. Validates: all dims > 0, weight > 0, skuId exists. Returns saved Dim.
- `GET /api/dims` — list all dims (most recent first), with joined SKU name
- `PUT /api/dims/:id` — correct a dim entry. Resets `syncedToCC = false`, `syncedAt = null` (needs re-sync). Returns updated Dim.
- `POST /api/sync/cc` — triggers sync. Queries all `syncedToCC = false`, batches into 10, PATCHes CC, marks successes. Returns `{ synced, failed, pending }`.
- Zod schemas for all request bodies
- Unit tests for dimService and syncService (mocked DB + CC client)

## Out of scope
- Frontend — modules 05–07
- SKU lookups — sku-seed
- Docker — module 08

## Dependencies
- `backend-core` — uses `prisma`, `AppError`
- `cc-client` — uses `ccClient.patchProductDims`
- `sku-seed` — relies on Sku records existing in DB (no direct code import; runtime dependency)

## Public interface (what this module exports)

```typescript
// Express routes — no direct TS exports
// POST /api/dims          → Dim
// GET  /api/dims          → DimWithSku[]
// PUT  /api/dims/:id      → Dim
// POST /api/sync/cc       → SyncReport

// src/services/syncService.ts
export interface SyncReport {
  synced: number
  failed: number
  pending: number
}
```

## Acceptance criteria
- [ ] `POST /api/dims` saves correctly and returns the created record
- [ ] `POST /api/dims` rejects dims ≤ 0 or weight ≤ 0 with 422
- [ ] `POST /api/dims` rejects unknown `skuId` with 404
- [ ] `PUT /api/dims/:id` updates and resets `syncedToCC = false`
- [ ] `POST /api/sync/cc` processes in batches of 10
- [ ] Sync continues to next batch even if one PATCH fails (no crash on single failure)
- [ ] Successfully synced dims have `syncedToCC = true` and `syncedAt` set
- [ ] Failed dims remain `syncedToCC = false` and are retried on next sync call
- [ ] Unit tests cover: save, validation errors, sync success, sync partial failure

## Notes
Zod is the validation library (add to backend package.json). syncService must not throw on individual CC API errors — log the error, mark it failed, continue. The sync runs synchronously (no queue/background worker at this stage) — it's triggered by the frontend's manual or auto-sync call and completes before responding.
