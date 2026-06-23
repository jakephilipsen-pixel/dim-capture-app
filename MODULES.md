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
| 04 | `dim-api` | ✅ | feature/dim-api (+ fix/sync-concurrency, merged) | 01, 02 | POST/GET/PUT /api/dims (Zod validation in dimService) + syncService.ts batch-of-10 sync + POST /api/sync/cc. Per-item error isolation; one-dim-per-SKU upsert. Smoke green (2026-06-03); tsc/lint clean. **compile-stress C1 (Critical) RESOLVED 2026-06-04:** `POST /api/sync/cc` serialised via `pg_try_advisory_xact_lock` — concurrent runs no longer double-PATCH real CC. Verified exactly-once on the live stack (5 concurrent → 1 winner, 4 lock-skips, pending:0). 72/72 tests. STATE.md current. |
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
| 09 | `backend-error-hardening` | ✅ | feature/hardening | 01, 03, 04 | **Security (info leakage).** S1/S2/S3a/M5/M6 all resolved. errorHandler no longer echoes err.message; body-parser 400/413 honoured; CcApiError→502/CcRateLimitError→503 on barcode fallback; dim bounds 100,000 mm / 1,000 kg; zod Infinity produces "must be a finite number". tsc clean, 87/87 tests (+15). 2026-06-08. |
| 10 | `cc-resilience` | ✅ | feature/hardening | 02 | **Resilience.** S4: `AbortSignal.timeout(12 s)` on every `ccClient` fetch; frozen CC peer no longer hangs sync indefinitely; `CcTimeoutError extends CcApiError` (statusCode 504). M2a: `CcRateLimitError` from seed path now returns 429 (not 500). M2b: split buckets — burst capacity sync=40, seed=20 (combined burst=60); sustained refill sync=40/60/sec, seed=20/60/sec (combined sustained=60/min ≤ CC ceiling). Seed exhaustion no longer starves sync path. Bug fix: original 1/sec-per-bucket defaults gave 120/min combined sustained — corrected to 40/60+20/60=1/sec. tsc clean, 107/107 tests (+18+1). 2026-06-08. |
| 11 | `deploy-hardening` | ✅ | feature/hardening | 08 | **Security.** S5: backend host port dropped — no longer LAN-reachable; health checks via nginx proxy. S7: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, strict CSP added to `frontend/nginx.conf` (all response paths, `always`). M3: `server_tokens off` + `app.disable("x-powered-by")` + unit test. M4: frontend healthcheck `localhost` → `127.0.0.1` (IPv4, fixes false-unhealthy). tsc clean, 88/88 tests (+1). 2026-06-08. |
| 12 | `cc-write-authz` | ✅ | feature/hardening | 03, 04, 08 | **Security — the CC-write gate. S6 resolved.** `POST /api/sync/cc` and `POST /api/admin/seed` now require `X-Sync-Key: <SYNC_SECRET>` header. Missing/wrong key → 401; SYNC_SECRET unset → 503 fail-closed. Read routes + /api/dims stay open. Timing-safe compare. tsc clean; 134/134 tests (+18). 2026-06-08. |
| 13 | `write-concurrency` | ✅ | feature/hardening | 04 | **Robustness.** S8: `saveDim` runs the SKU-check + upsert inside `withAdvisoryLock` with `{ blocking: true }` (`pg_advisory_xact_lock` — BLOCKING variant); concurrent same-SKU captures serialise — the loser waits and completes, never drops the capture. Fixes critical data-loss defect: old `pg_try_advisory_xact_lock` returned null → 200-null body → frontend showed "Saved!" and discarded the queue entry. Sync unchanged (non-blocking by design). `saveDim` return type tightened to `Promise<Dim>`. M1: `getProgress`'s 3 counts in `prisma.$transaction([...])` for consistent snapshot. tsc clean, 116/116 tests. 2026-06-08. |

## Frontend auth module

| # | Name | Status | Branch | Depends on | Notes |
|---|------|--------|--------|-----------|-------|
| 14 | `sync-key-prompt` | ✅ | feature/sync-key-prompt | 05, 07, 12 | Operator authorises CC sync from the PWA via a per-session sync key. `lib/syncKey.ts` (sessionStorage store); `api.syncToCC()` sends `X-Sync-Key` header, handles 401 by clearing key; `useSync` skips CC-sync silently when no key; Review "Sync Now" opens prompt dialog on first use. New `components/ui/dialog.tsx`. tsc clean; 59/59 tests (+18). 2026-06-08. |
| 15 | `floor-camera-flow` | ✅ | feature/floor-camera-flow | 04, 06 | **Floor — full-screen mobile camera capture (from the claude.ai/design mockup).** Three routes OUTSIDE `<Layout>`: `/floor` (FloorScan — ZXing barcode camera + manual fallback), `/floor/capture/:barcode` (FloorCapture — SKU lookup, progress ring, customer chip, SKU card, Dry/Ambient/Chilled/Frozen toggle, carton-photo thumbnail, **L/W/H/KG in cm** with live auto-volume, SAVE), FloorPhotoCapture (getUserMedia carton camera → downscaled JPEG). **Backend:** `Dim.productType` + `Dim.photoPath` (additive migration); `POST/GET /api/dims/:id/photo` (on-disk JPEG, raw parser); `productType` validated. cm display / **mm-canonical storage** (cmToMm at the form boundary — no DB migration; see DECISIONS 2026-06-23). Online: save dims → upload photo (best-effort); offline: dims queue (photo needs a connection). tsc/lint/build clean; backend 154 tests (+20), frontend 64 tests (+5). **⚠ pre-existing flag (not fixed): cc-client sends dims to CC in mm — CC wants cm (the parent-repo 10× bug); needs a separate gated fix.** 2026-06-23. Module dir + STATE + smoke written in the 2026-06-24 closeout; `smoke-module.sh floor-camera-flow` PASSES (seed → floor capture w/ productType → photo upload → fetch). Local-deploy gate pending Jake. |

## Combine-pipeline modules (2026-06-24 — make the app carry the proven CC write recipe)

Design: `docs/superpowers/specs/2026-06-24-combine-pipeline-design.md`. The app's original
`cc-client` spoke a never-validated v1 contract (Bearer key, `/products` PATCH) that cannot
write dims. These modules swap in the recipe proven live in the parent `gocold-wms-flow` repo.

| # | Name | Status | Branch | Depends on | Notes |
|---|------|--------|--------|-----------|-------|
| 16 | `cc-oauth-write` | 🟨 | feature/cc-oauth-write | 02, 03, 04, 12 | **Rewrite the CC layer to the validated recipe.** OAuth2 client_credentials on `api.cartoncloud.com` (tenant-scoped); seed/lookup re-pointed to `/warehouse-products` v8 (barcode from `unitOfMeasures.{uom}.barcode`, code from `references.code`); `patchProductDims` → v8 JSON-Patch `op:add` on `/unitOfMeasures/{defaultUoM}/{field}` in **metres**, with name-poison guard + idempotent diff + read-back verify. `syncService` gains a **blocked** terminal state. Live-probe-grounded (2026-06-24). Built + adversarially reviewed (11 medium/low findings fixed); 159 backend tests + `tsc` + smoke green. → ✅ on PR merge. |
| 17 | `blocked-sku-feedback` | 🔲 | — | 16, 05, 07 | Operator UI for name-poisoned/blocked SKUs (consumes the `blocked` state from 16). May fold into 16. |

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
