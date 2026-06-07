# Stress Test Results — dim-capture-app

**Date:** 2026-06-04
**Phase:** `/compile-stress` (post-build integration + stress)
**Integrated tree:** `feature/docker-deploy` (= `main` + module 08; all 8 modules ✅ Built)
**Stress environment:** full stack via `modules/docker-deploy/docker-compose.smoke.yml`
(`-p dimcap-cs`) — postgres 16 + in-container **mock** CartonCloud + real backend
(`:3012`) + real frontend (`:5179`). No real CartonCloud was contacted at any point
(`CC_BASE_URL=http://mock-cc:9099`, creds `smoke-key`/`smoke-tenant`).

## Phase 1 — Integration: GREEN

| Check | Result |
|-------|--------|
| Module deps vs MODULES.md | Consistent; no STATE.md misrepresented its interface (no 🔧 flags) |
| `docker compose build` (production) | OK — backend + frontend images built |
| Stack boot + health (4 services) | All healthy; direct health, via-proxy health, shell 200, progress 200 |
| Backend `tsc --noEmit` + `npm test` | clean / **69/69** |
| Frontend `tsc -b` + `npm test` | clean / **41/41** |
| E2E happy path | seed → lookup → capture → sync(mock) → `{synced:1, pending:0}` ✅ |

## Phase 2 — Stress: 5 parallel/solo subagents

| Agent | Verdict | C | S | M |
|-------|---------|---|---|---|
| Load / performance | PASS | 0 | 0 | 4 |
| Edge case / input validation | PASS | 0 | 3 | 2 |
| Auth / security posture | PASS* | 0 | 3 | 3 |
| Data integrity / concurrency | **FAIL** | **1** | 1 | 2 |
| Failure injection / chaos | PASS | 0 | 1 | 2 |

\* PASS with mandatory hardening before production.

Per-agent raw reports: `.stress/{load,edge,auth,integrity,failure}.md`.
Harnesses: `.stress/run.sh`, `.stress/probe.py`.

---

## Deduplicated master findings

### CRITICAL (must resolve before sign-off)

**C1 — Concurrent `POST /api/sync/cc` double-PATCHes CartonCloud and over-counts `synced`.**
`syncUnsyncedDims()` (`backend/src/services/syncService.ts`) does `findMany({syncedToCC:false})`
then per-item PATCH + `update`, with **no claim/lock between read and mark**. Two+ concurrent
runs read the same unsynced set and both PATCH every dim.
- Evidence: 5 concurrent runs over 4 pending dims each returned `synced:4` (20 total); backend
  logs confirmed **20 PATCHes = 5× per product**. Code path verified by hand — race window is real.
- Local DB end-state is correct (dims end `synced`, `pending` accurate), but: redundant writes to
  the **real** CC system-of-record in production; `synced` count misreports what happened; and the
  60/min CC token bucket gets burned 5×, which can reject legitimate syncs.
- Realistic trigger: Review-page **"Sync Now"** overlapping the 30 s background auto-sync, or an
  offline-queue drain overlapping it. Reachable in normal single-user operation.
- Conflicts with CLAUDE.md's zero-tolerance-for-breakage and "CC is the system of record" posture.
- Fix: serialise sync runs (Postgres advisory lock around the run, or atomic claim-then-patch).

### SIGNIFICANT (logged as planned hardening modules — see MODULES.md)

- **S1 — `errorHandler` leaks internal error detail.** Every non-`AppError` is mapped to 500 with
  `err.message` echoed verbatim → leaks Prisma/Postgres stack traces + the `postgres:5432` DSN
  (DB-down), and CC error strings. `backend/src/middleware/errorHandler.ts`.
- **S2 — Malformed bodies → 500 instead of 400/413.** Non-JSON, JSON primitives (`42`/`null`/`"x"`),
  trailing commas, and >100 KB bodies all 500. The body-size limit *exists* (100 KB, no OOM) — only
  the status code is wrong (handler ignores body-parser `err.status`/`err.statusCode`).
- **S3 — `GET /api/skus/:barcode` CC-fallback → 500 + DoS amplifier.** CC errors on the fallback
  path aren't `AppError` → 500 (leaks CC error). Worse: the endpoint is unauthenticated, so ~60
  junk barcode scans/min exhaust the shared CC token bucket and 500 every legitimate CC-fallback
  lookup until it refills.
- **S4 — No timeout on CartonCloud fetch calls.** `ccClient` has no `AbortSignal`/timeout. A frozen
  CC peer hung `POST /api/sync/cc` indefinitely (event loop NOT starved; only the 90 s client
  timeout ended it). Fix: `AbortSignal.timeout(10–15 s)` per call → surfaces as a normal retryable
  failure. `backend/src/services/ccClient.ts`.
- **S5 — Production backend is published to the LAN.** `docker-compose.yml` maps `0.0.0.0:3005`,
  bypassing the single-origin nginx proxy so every (unauthenticated) endpoint is directly reachable
  from any LAN host. Fix: bind `127.0.0.1:3005` or drop the host mapping (host health checks can use
  the compose network / the proxy).
- **S6 — `POST /api/sync/cc` & `/api/admin/seed` are unauthenticated with no confirmation.** In
  production `sync/cc` writes to the **real** CC. Any LAN device can trigger a CC write or a full
  re-seed. Directly conflicts with CLAUDE.md "never push to CC automatically … human approval gate."
- **S7 — Frontend nginx sets no security headers** (`X-Frame-Options`, CSP, `X-Content-Type-Options`)
  → clickjacking exposure on the unauthenticated state-changing buttons. `frontend/nginx.conf`.
- **S8 — `prisma.dim.upsert` insert-path race.** 40 concurrent first-captures of a dim-less SKU
  converge to one coherent row only because Prisma retries the unique-constraint violation; there is
  no transaction/locking and the autoincrement sequence is burned. Recoverable today; correctness
  rests on driver retry. `backend/src/services/dimService.ts`.

### MINOR (logged in KNOWN_ISSUES.md)

- **M1** — `getProgress` reads 3 counts outside a transaction (torn-read window); 0 incoherence in
  200 samples under churn. Latent.
- **M2** — Single shared CC token bucket lets seed & sync starve each other; returns 500 not 429.
- **M3** — Version disclosure: `X-Powered-By: Express`, `Server: nginx/1.27.5`.
- **M4** — Frontend container reports `unhealthy` while serving 200 — the in-container healthcheck
  wgets `localhost` → IPv6 `::1` but nginx listens IPv4-only. Cosmetic, but pollutes `docker ps` and
  any health-gated orchestration. Fix: healthcheck `127.0.0.1` or `listen [::]:80`.
- **M5** — Absurd-but-finite dims (`1e308`, `1e-7`) accepted; only `>0` is enforced, no upper sanity bound.
- **M6** — Confusing zod message for JSON `Infinity` ("expected number, received number").
- **M7** — Sync rate-limit failures aren't auto-retried server-side; a manual re-sync recovers fully
  (~5 s, no data loss). By design — the sync caller drives retries.
- **M8** — `/api/progress` is the heaviest read (uncached aggregation), p95 178 ms @ 500 concurrent;
  irrelevant at the real single-digit-user load.
- **M9** — Frontend `DialogContent` missing `aria-describedby` (a11y warning surfaced in unit tests).

---

## What passed notably (no action)
- All SQLi / XSS / `{{7*7}}` / path-traversal payloads neutralised (Prisma parameterised, zod
  validated, strings stored verbatim with no server-side rendering).
- Mass-assignment ignored (`syncedToCC`/`id`/`measuredAt` in a POST body do nothing).
- CC secret (`CC_API_KEY`) never appears in any response/error/health body — env-only.
- CORS uses a static `FRONTEND_URL` allowlist; foreign origins not reflected. Client `X-Tenant-Id` ignored.
- Same-SKU upsert race (existing row), POST-vs-PUT race, seed idempotency, serial sync idempotency,
  sync-state reset, and counter reconciliation all held.
- Chaos: DB-down → graceful 503 + **automatic** reconnect (no bounce); DB-killed-mid-write → clean
  500, integrity intact; CC-down during sync → `{0,N,N}` then retry succeeds, no data loss; backend
  restart → migrations non-destructive, data survived; backend-down → frontend serves degraded shell,
  nginx proxy returns clean 502; cold boot recovers via `depends_on` ordering. No process crash anywhere.

---

## /compile-stress re-run — 2026-06-08 (post-hardening 09–13)

**Tree:** `feature/hardening` (= integrated 8 modules + C1 fix + hardening 09,10,11,12,13).
**Stack:** production images via `modules/docker-deploy/docker-compose.smoke.yml` (`-p dimcap-cs`)
— postgres 16 + in-container mock CartonCloud + real backend (:3012) + real frontend (:5179).
No real CartonCloud contacted (`CC_BASE_URL=http://mock-cc:9099`).

### Integration: GREEN
- `docker compose build` (prod images): OK.
- Stack boot + health: **all 4 services healthy** (frontend now healthy — M4 fixed).
- Backend `tsc --noEmit` clean; `npm test` **134/134**. Frontend `tsc -b` clean; `npm test` **41/41**.
- E2E happy path (with `X-Sync-Key`): seed → list skus → capture → **re-capture** → sync(mock) → `{synced:1,failed:0,pending:0}`, progress `captured:1, syncedToCC:1`. ✅

### Original CRITICAL — resolved
- **C1** (concurrent sync double-PATCH): resolved earlier (advisory lock), unchanged here.

### Hardening findings — verified resolved on the live stack
- **S1** unknown error → generic `{"error":"Internal server error"}`, no DSN/stack leak (forced 500 path). ✅
- **S2** malformed JSON body → **400** (not 500). ✅
- **S5** production `docker-compose.yml` has no backend host port (single-origin only). ✅ (static)
- **S6** `POST /api/sync/cc` & `/api/admin/seed` without `X-Sync-Key` → **401**; with key → handler reached; `SYNC_SECRET` unset → 503 fail-closed (unit). GET routes + `/api/dims` ungated → 200. ✅
- **S7** frontend nginx returns `X-Frame-Options: DENY`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`. ✅
- **M3** no `X-Powered-By`; `Server: nginx` (no version). ✅
- **M4** frontend container reports **healthy**. ✅

### Regression caught + fixed by this re-run
- **Blocking advisory lock P2010** (`pg_advisory_xact_lock` returns SQL `void`; `$queryRaw` could not
  deserialise → every dim capture 500'd in the real stack though unit tests passed). Fixed: use
  `$executeRaw` for the blocking lock. Re-verified live: capture 200, re-capture 200, missing-sku 404.

**Verdict:** GREEN. Ready for `/deploy-local` (which requires Jake's manual sign-off).
