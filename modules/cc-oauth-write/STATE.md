# State: cc-oauth-write

> This file is the handoff record between conversations. Keep it accurate. Other modules will load THIS FILE (not source) to understand what this module exports.

## Status
🟨 In progress

## Branch
feature/cc-oauth-write

## Last touched
2026-06-24 — registered + scaffolded from the approved spec; build starting.

## Public interface (the contract other modules see)

```typescript
// Filled in as work progresses.
```

## Exports
*(list of exported names with one-line purpose — TBD as built)*

## Internal structure
- `backend/src/services/ccClient.ts` — rewritten CC layer (OAuth2 token mgr, v8 warehouse-products
  read/search, v8 JSON-Patch dims write, name-poison guard, read-back verify). Reuses the existing
  rate limiter / timeouts / typed errors / `mmToMetres`.
- `backend/src/services/syncService.ts` — write path swapped in; adds the `blocked` terminal state.
- `backend/src/services/skuService.ts` + seed — re-pointed to warehouse-products.
- Prisma schema — `Sku.id`=whpId, `Sku.code` added, `barcode` nullable; `Dim.syncBlockedReason`.
- `backend/src/smoke/mockCc.ts` — extended to the v8 OAuth2/warehouse-products/json-patch contract.

## Quirks / gotchas
- CC unit is **metres** (mm→m ÷1000 via `mmToMetres`). NOT cm/mm.
- JSON-Patch `{uom}` path segment = the UoM **key** (e.g. "EA"), not the UUID.
- Name-poison: any sibling UoM name <3 or >64 chars 422s the whole-product PATCH → skip the SKU.
- Recipe is authority (gotcha #6 / spec); do not re-derive endpoint/version/op.
- First NUC deploy is a fresh DB — the Sku id/code change is a re-seed.

## Test status
- [ ] Unit tests written
- [ ] Unit tests passing
- [ ] Integration with dependencies verified

## In-flight work
Build not yet started in code. Next concrete step: read dependency STATE.md (02/03/04/12) +
DECISIONS.md, then TDD the OAuth2 token manager first.

## Decisions made during this module's build
*(duplicated from DECISIONS.md as they're made)*
