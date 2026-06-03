# Modules

This file is the source of truth for module breakdown and status. Update on every module completion.

## Status legend
- 🔲 **Planned** — defined but not started
- 🟨 **In progress** — branch exists, work underway
- ✅ **Built** — merged to main, STATE.md current
- 🔧 **Needs revision** — built but flagged for rework

## Module list

| # | Name | Status | Branch | Depends on | Notes |
|---|------|--------|--------|-----------|-------|
| 01 | `backend-core` | ✅ | feature/backend-core | — | Express + TS, Prisma schema (Sku + Dim), migration, DB connection, `/api/health`, AppError + error middleware, pino logging, 501 route stubs. Smoke green (2026-06-03); typecheck/lint clean; 7/7 unit tests. STATE.md current. |
| 02 | `cc-client` | ✅ | feature/cc-client | 01 | CartonCloud API client — token-bucket limiter (60/min, rejects when empty), `lookupByBarcode`, `patchProductDims`, typed errors. Bearer+`X-Tenant-Id` per spec. Route-less service. 13 unit tests (mocked fetch), smoke green (2026-06-03) via in-container mock CC. STATE.md current. |
| 03 | `sku-seed` | ✅ | feature/sku-seed | 01, 02 | POST /api/admin/seed (paginated CC pull, idempotent upsert), GET /api/skus, GET /api/skus/:barcode (DB-first → CC fallback upsert), GET /api/progress (top-level per spec). Extended cc-client with `listProducts`; added zod. Smoke green (2026-06-03); tsc/lint clean; 46/46 tests. STATE.md current. |
| 04 | `dim-api` | ✅ | feature/dim-api | 01, 02 | POST/GET/PUT /api/dims (Zod validation in dimService) + syncService.ts batch-of-10 sync + POST /api/sync/cc. Per-item error isolation; one-dim-per-SKU upsert. Smoke green (2026-06-03); tsc/lint clean; 23 new tests (69/69 total). STATE.md current. |
| 05 | `frontend-scaffold` | ✅ | feature/frontend-scaffold | 01 | Vite 5 + React 19 + TS strict + Tailwind v4 + shadcn/ui (new-york) PWA shell. `vite-plugin-pwa` generateSW + static `public/manifest.json` (standalone). React Router v6 (/, /progress, /review, *). Layout (title + live `X/460` badge + nav + mobile Sheet), `ProgressBar`, `SyncStatus` fed by a single `ProgressProvider` poll. Typed `lib/api.ts` (6 endpoints, ApiError) + `lib/units.ts`. Dev on 5175; degrades to `—/460` offline. tsc/lint clean; 21/21 tests; smoke green (2026-06-03, frontend-only nginx on 5176). STATE.md current. |
| 06 | `capture-page` | 🔲 | — | 05, 03, 04 | BarcodeScanner.tsx (ZXing + torch), DimForm.tsx (unit toggle mm/cm/in), SkuCard.tsx, RecentCaptures.tsx, full Capture page (/) mobile UX, IndexedDB offline queue, useBarcode + useSku + useSync hooks |
| 07 | `progress-review` | 🔲 | — | 05, 06 | Progress page (/progress): filter All/Captured/Missing + search + tap-to-edit. Review page (/review): last 10 captures + edit + pending sync count |
| 08 | `docker-deploy` | 🔲 | — | 01–07 | docker-compose.yml + docker-compose.local.yml + .env.example + Caddy config for dims.gocold.local on NUC + smoke scripts |

## Build order
01 → 02 → 03 → 04 (all backend) → 05 → 06 → 07 (all frontend) → 08 (deploy)

Modules 02–04 are pure backend and can be built before any frontend work. After 08, run `/compile-stress` then `/deploy-local` then `/deploy-nuc`.

## Per-module files
Each module lives at `modules/<name>/` and contains:
- `brief.md` — what this module does, scope, out-of-scope
- `prompt.md` — the Claude Code prompt to build it (the "fat but bounded" instruction)
- `smoke.md` — smoke test spec (boots, health check, happy path)
- `STATE.md` — current state, exports, interface contract, quirks (updated as work progresses)
- `smoke/` — `healthcheck.sh` + `happy-path.sh` (executable smoke scripts)

## Completion criteria
A module is not ✅ Built until:
1. All acceptance criteria in `brief.md` met
2. Unit tests passing
3. Smoke tests written and `./scripts/smoke-module.sh <name>` passes
4. STATE.md fully populated (interface contract, exports, quirks)
5. PR merged to main

## Sizing rule
If any module's build conversation exceeds 180K tokens before completion, that module was scoped too big. Split it and update this registry.

## Spec
Full product spec lives at `dim-capture-app-spec.md` in the project root. If any module brief contradicts the spec, the spec wins — surface the conflict before building.
