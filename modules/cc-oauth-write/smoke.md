# Smoke test: cc-oauth-write

Quick local validation that the rewritten CC layer boots and the dims write round-trips against
an in-container CC mock (NO live CartonCloud calls).

## Pre-flight
- Module marked complete in STATE.md
- All unit tests passing
- On Pop!_OS laptop with Docker daemon running

## Run
```bash
# From project root
./scripts/smoke-module.sh cc-oauth-write
```

The script:
1. Builds the backend container
2. Boots a minimal stack (backend + Postgres + the in-container CC mock standing in for CC)
3. Runs the health check + the smoke tests in `modules/cc-oauth-write/smoke/`
4. Tears down

## Smoke test scope
Proves, against the **mock** CC (the mock speaks the v8 OAuth2/warehouse-products/json-patch
contract):
- The backend boots and `/api/health` is 200.
- OAuth2 token flow works against the mock token endpoint (no Bearer-key path remains).
- Seed pulls warehouse-products from the mock and upserts Skus (id=whpId, code, barcode-from-UoM).
- `GET /api/skus/:barcode` resolves a seeded barcode to a warehouse-product.
- A capture → `POST /api/sync/cc` (with `X-Sync-Key`) issues the v8 JSON-Patch and the read-back
  verify passes; the dim is marked synced.
- A name-poisoned mock SKU is marked **blocked** (no PATCH fired), not failed.

NOT in scope here: live CC, exhaustive cases (unit tests), performance, cross-module integration
(that's `/compile-stress`).

## Acceptance
- Container boots within 30s
- Health check returns 200 on first attempt after boot
- Happy-path smoke (seed → lookup → sync → read-back verified) passes
- Name-poison SKU lands in `blocked`, not `failed`
- Clean shutdown (no zombie processes, no orphaned volumes)

## On failure
1. Do NOT mark module ✅ in MODULES.md
2. Diagnose — usually: missing CC_* env var, mock contract drift, Prisma migration not applied,
   or the json-patch path/UoM-key shape
3. Fix on the same `feature/cc-oauth-write` branch
4. Re-run smoke
5. Only when green: commit, push, mark ✅, open PR

## Smoke test files location
`modules/cc-oauth-write/smoke/`:
- `smoke/healthcheck.sh` — curls `/api/health`
- `smoke/happy-path.sh` — seed → lookup → capture → sync → assert synced + read-back; assert a
  poisoned SKU is blocked
- Both must exit 0 to pass
