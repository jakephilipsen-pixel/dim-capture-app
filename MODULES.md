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
| 01 | `backend-core` | 🔲 | feature/backend-core (scaffold only) | — | Scaffold only — all routes return 501, no migrations run, no `.env`, tests not passing; build not started (see `modules/backend-core/STATE.md`). Target: Express + TS, Prisma schema (Sku + Dim), migrations, DB connection, health endpoint, error middleware |
| 02 | `cc-client` | 🔲 | — | 01 | CartonCloud API client — token-bucket rate limiter (60 req/min), product lookup by barcode, PATCH product dims |
| 03 | `sku-seed` | 🔲 | — | 01, 02 | POST /api/admin/seed (paginated CC pull, idempotent), GET /api/skus, GET /api/skus/:barcode (DB-first → CC fallback), GET /api/progress |
| 04 | `dim-api` | 🔲 | — | 01, 02 | POST/GET/PUT /api/dims (Zod validation) + syncService.ts + POST /api/sync/cc (batch of 10, retry on failure) |
| 05 | `frontend-scaffold` | 🔲 | — | 01 | Vite + React 19 + TS + Tailwind + shadcn/ui + PWA manifest + service worker, React Router (3 routes), layout shell, lib/api.ts, lib/units.ts, SyncStatus, ProgressBar |
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
