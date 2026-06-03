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
| 04 | `dim-api` | 🔧 | feature/dim-api → fix/sync-concurrency | 01, 02 | POST/GET/PUT /api/dims (Zod validation in dimService) + syncService.ts batch-of-10 sync + POST /api/sync/cc. Per-item error isolation; one-dim-per-SKU upsert. Smoke green (2026-06-03); tsc/lint clean; 23 new tests (69/69 total). **🔧 compile-stress C1 (Critical): concurrent `POST /api/sync/cc` double-PATCHes real CC — no lock between read-unsynced and mark-synced. Fix in progress on `fix/sync-concurrency` (advisory lock).** STATE.md current. |
| 05 | `frontend-scaffold` | ✅ | feature/frontend-scaffold | 01 | Vite 5 + React 19 + TS strict + Tailwind v4 + shadcn/ui (new-york) PWA shell. `vite-plugin-pwa` generateSW + static `public/manifest.json` (standalone). React Router v6 (/, /progress, /review, *). Layout (title + live `X/460` badge + nav + mobile Sheet), `ProgressBar`, `SyncStatus` fed by a single `ProgressProvider` poll. Typed `lib/api.ts` (6 endpoints, ApiError) + `lib/units.ts`. Dev on 5175; degrades to `—/460` offline. tsc/lint clean; 21/21 tests; smoke green (2026-06-03, frontend-only nginx on 5176). STATE.md current. |
| 06 | `capture-page` | ✅ | feature/capture-page | 05, 03, 04 | Full Capture flow at `/`: lazy ZXing `BarcodeScanner` (+torch), debounced `useSku` lookup, `SkuCard`, `DimForm` (mm/cm/in toggle, localStorage `measuredBy`), success flash + 880 Hz beep + vibrate, `RecentCaptures` (GET /api/dims). IndexedDB offline queue (`idb`) + `useSync`/`SyncManager` (drain queue → POST /api/dims → POST /api/sync/cc on mount/online/30 s). Extended `api.ts` (+getDims) + `SyncStatus` (backend+local count). tsc/lint clean; 34/34 tests; smoke green (2026-06-03, full stack). STATE.md current. |
| 07 | `progress-review` | ✅ | feature/progress-review | 05, 06 | Progress (`/progress`): full SKU list (getSkus⨝getDims), All/Captured/Missing segmented filter, client-side search, tap-row → bottom-Sheet DimForm (PUT if captured, POST if missing). Review (`/review`): last-10 from getDims, sync icons, inline edit (PUT), pending count + Sync Now. Extended DimForm (edit/PUT mode) + Sheet (bottom side). 460-row perf via content-visibility. tsc/lint clean; 41/41 tests; smoke green (2026-06-03, full stack). STATE.md current. |
| 08 | `docker-deploy` | ✅ | feature/docker-deploy | 01–07 | Production `docker-compose.yml` (pg + backend + frontend). **Single-origin**: frontend built relative (`VITE_API_URL=""` build-arg), nginx `/api` proxies → backend (variable upstream so it boots without a backend); overrides the spec's broken `VITE_API_URL=http://backend:3005`. Root `.env.example` (7 vars), `caddy/dims.gocold.local.caddy` (host → frontend:5175, `caddy validate` clean), populated `.health-endpoints`, NUC_DEPLOY.md → `dims.gocold.local` + DNS note. Smoke green (2026-06-04, full stack 3012/5179, incl. via-proxy checks); production compose verified end to end on 5175/3005/5434. STATE.md current. |

## Hardening modules (from `/compile-stress` 2026-06-04 — Significant findings)

These were surfaced by the stress phase (full detail + finding IDs in `STRESS_TEST_RESULTS.md`).
🚧 = **gates "production candidate"** per Jake's sign-off call (security must land before prod).
Each still needs `/add-module` to scaffold `brief.md`/`prompt.md`/`smoke.md` before `/build-module`.

| # | Name | Status | Branch | Depends on | Notes |
|---|------|--------|--------|-----------|-------|
| 09 | `backend-error-hardening` | 🔲🚧 | — | 01, 03, 04 | **Security (info leakage).** S1: `errorHandler` echoes raw `err.message` + maps all non-`AppError`→500, leaking Prisma/Postgres stack traces + the `postgres:5432` DSN and CC error strings → return a generic message for unknown errors, log detail server-side. S2: honour body-parser `err.status`/`err.statusCode` so malformed/oversized JSON → 400/413 not 500. S3a: map `CcApiError`/`CcRateLimitError` on the `/api/skus/:barcode` CC-fallback to proper 4xx (not 500). +M5 (upper dim sanity bound), +M6 (non-finite zod message). |
| 10 | `cc-resilience` | 🔲 | — | 02 | **Resilience.** S4: add `AbortSignal.timeout(10–15 s)` to every `ccClient` fetch — today a frozen CC peer hangs `POST /api/sync/cc` indefinitely. M2: return **429** (not 500) when the token bucket is empty, and give seed vs sync **separate buckets** so they don't starve each other. Recommended before prod. |
| 11 | `deploy-hardening` | 🔲🚧 | — | 08 | **Security.** S5: stop publishing the backend to the LAN (`docker-compose.yml` maps `0.0.0.0:3005`, bypassing the single-origin proxy) — bind `127.0.0.1` or drop the host mapping. S7: add security headers in `frontend/nginx.conf` (`X-Frame-Options`, CSP, `X-Content-Type-Options`). +M3 (`server_tokens off;` / `x-powered-by` off), +M4 (frontend healthcheck uses IPv6 `::1` but nginx is IPv4-only → false `unhealthy`). |
| 12 | `cc-write-authz` | 🔲🚧 | — | 03, 04, 08 | **Security — the CC-write gate.** S6: `POST /api/sync/cc` and `POST /api/admin/seed` are unauthenticated with no confirmation; in prod `sync/cc` writes to the **real** CartonCloud. Directly conflicts with CLAUDE.md "never push to CC automatically … human approval gate." Needs an auth-model decision (shared secret / nginx basic-auth / explicit confirm step) — write it to DECISIONS.md before building. |
| 13 | `write-concurrency` | 🔲 | — | 04 | **Robustness.** S8: `prisma.dim.upsert` insert-path race relies on Prisma's P2002 retry (no transaction/locking; autoincrement burned) — generalise the C1 advisory-lock/claim pattern to capture. M1: wrap `getProgress`'s 3 counts in one `$transaction` to close the torn-read window. Recoverable today; lower priority. |

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
