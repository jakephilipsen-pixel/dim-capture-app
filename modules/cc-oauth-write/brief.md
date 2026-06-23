# Module: cc-oauth-write

## Purpose
Replace the app's never-validated CartonCloud (CC) write path with the recipe proven live in
the parent `gocold-wms-flow` repo, so the app can actually push captured carton dims to CC.
Today `ccClient` uses Bearer auth on `app.cartoncloud.com.au/api/v1` (placeholder creds) and
`PATCH /products/{id}` v1 with a flat body — a contract that 404s and silently drops L/W/H.
This module rewrites the CC layer to **OAuth2 client_credentials** on `api.cartoncloud.com`,
re-points seed/lookup to **`/warehouse-products` v8**, and writes dims via **JSON-Patch `op:add`
on `/unitOfMeasures/{uom}/{field}` under `Accept-Version: 8`** targeting the product's
`defaultUnitOfMeasure` (the Each), with a **name-poison guard**, **idempotent diff**, and
**read-back verify** as the live safety net. Units are **metres** (mm→m ÷1000, already landed
in `mmToMetres`). Full design: `docs/superpowers/specs/2026-06-24-combine-pipeline-design.md`.

## In scope
- OAuth2 token manager in `ccClient`: `POST /uaa/oauth/token`, Basic `base64(id:secret)`,
  `grant_type=client_credentials`, cache + refresh 60s before expiry. Base
  `https://api.cartoncloud.com`, tenant-scoped paths `/tenants/{tenant}/…`. Keep `CC_BASE_URL`
  override + the existing timeout + token-bucket limiter + typed errors.
- Re-point reads to warehouse-products v8: `listProducts`/seed via
  `POST /warehouse-products/search` (customer-scoped to Forage), `lookupByBarcode` resolves the
  warehouse-product id from the seeded DB. Barcode is sourced from the UoM
  (`unitOfMeasures.{uom}.barcode`); SKU code from `references.code`.
- Rewrite `patchProductDims`: GET product v8 → customer guard → name-poison guard → resolve
  `defaultUnitOfMeasure` → mm→m → idempotent diff → JSON-Patch `op:add` PATCH v8 → read-back
  verify (mismatch throws).
- Wire the new write path into `syncService` (batch-of-10, advisory lock, `X-Sync-Key` all
  unchanged); add a terminal **blocked** state for name-poisoned SKUs (distinct from retryable
  failure).
- Seed/Sku model: `Sku.id` = warehouse-product id; add `Sku.code`; `barcode` from the UoM
  (nullable). Persist a small `syncBlockedReason` on `Dim` for the UI (see DECISIONS).
- Rewrite the `ccClient` unit tests (they assert the dead v1 contract) + extend the in-container
  CC mock to the v8 warehouse-products + json-patch shapes.

## Out of scope
- Operator UI for blocked SKUs → **module 17 `blocked-sku-feedback`** (this module only persists
  the blocked state + reason; the UI consumes it).
- Re-correcting the parent repo's 132 live 5d writes / 4 EA 5b writes (wrong magnitude) — a
  separate deliberately-armed Python-engine run Jake owns.
- Writing to the **CT carton UoM** (CLOSED — name-validation 422 + no-edit-on-master).
- Changing the staff **input** unit toggle (cm/mm/in) — entry only, unaffected.
- Module 15 `floor-camera-flow` closeout (its missing dir/STATE/smoke) — separate housekeeping.

## Dependencies
- 02 `cc-client` — the module being rewritten (auth, lookup, patch, rate limiter, typed errors).
- 03 `sku-seed` — `POST /api/admin/seed`, `GET /api/skus/:barcode`, `listProducts` (re-pointed).
- 04 `dim-api` — `syncService` (batch-of-10, advisory lock) the write path plugs into.
- 12 `cc-write-authz` — `X-Sync-Key` gate on `/api/sync/cc` + `/api/admin/seed` (unchanged).

## Public interface (what this module exports)
*(filled in during/after build)*

```typescript
// exports go here
```

## Acceptance criteria
- [ ] `ccClient` authenticates via OAuth2 client_credentials (token cached + refreshed) against
      `api.cartoncloud.com`, tenant-scoped paths.
- [ ] Seed pulls Forage warehouse-products (v8 search), upserts `Sku{id=whpId, code, barcode-from-UoM, name, dims}`.
- [ ] `lookupByBarcode` resolves a scanned barcode → warehouse-product id (DB-first).
- [ ] `patchProductDims` writes via v8 JSON-Patch `op:add` on `/unitOfMeasures/{defaultUoM}/{field}`,
      values in **metres**, only changed fields, correct headers.
- [ ] Name-poison guard skips SKUs whose UoM set has an invalid name (CC 3–64 rule); records a
      structured blocked reason; fires **no** PATCH.
- [ ] Idempotent: a SKU whose dims already match no-ops (no PATCH).
- [ ] Read-back verify: a post-PATCH GET mismatch throws (surfaces as a failed sync).
- [ ] Customer guard: refuses to write to a non-Forage product.
- [ ] `syncService` marks each dim synced / failed (retryable) / blocked (not retryable).
- [ ] All exports have types.
- [ ] Unit tests cover happy path + error cases (token refresh, poison skip, no-op, read-back mismatch, customer refusal).
- [ ] Integrates cleanly with declared dependencies.

## Notes
- **Live probe (2026-06-24)** confirmed the shape: barcode on `unitOfMeasures.{uom}.barcode`,
  code on `references.code`, `defaultUnitOfMeasure` = the Each key (e.g. "EA"), `unitOfMeasures`
  keyed by UoM code; L/W/H absent until set (so `op:add`, not `replace`). Name-poison is live
  (e.g. `AE-BLA`'s CT UoM `name:"CT"`).
- The JSON-Patch `{uom}` segment is the **UoM key** (e.g. "EA"), not the UoM UUID.
- First NUC deploy is a **fresh DB** (`prod_deployed:false`) — the `Sku.id`/`Sku.code` change is a
  re-seed, no production migration.
- Recipe authority (do not re-derive): PATCH `/warehouse-products/{id}`, JSON-Patch `op:add`,
  `Accept-Version: 8`, `Content-Type: application/json-patch+json`; read back under v8.
