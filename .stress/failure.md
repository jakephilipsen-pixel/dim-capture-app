# dim-capture-app — Failure-Injection / Chaos Stress Test

**Stack:** compose project `dimcap-cs` (postgres16, mock-cc, express backend :3012, nginx PWA :5179)
**Date:** 2026-06-04  **Mode:** SOLO (no other agents). Only `dimcap-cs-*` containers were touched.
**Overall: PASS** (no process crash, automatic DB recovery, no data loss, degraded-mode frontend, clean cold boot) — with 1 Significant resilience gap (no CC fetch timeout) and 2 Minor findings.

Severity counts: **Critical 0 · Significant 1 · Minor 2**

---

## Scenario 1 — DB down at request time — PASS (with Minor info leak)

**Repro:** `docker stop dimcap-cs-postgres-1`; hit `/api/health`, `/api/skus`, `POST /api/dims`; `docker start dimcap-cs-postgres-1`; poll `/api/health`.

**Evidence:**
- `GET /api/health` → **503 `{"status":"error","db":"error"}`** (the previously-unexercised 503 branch in `app.ts` works). Latency ~5s (Prisma connect timeout) then clean 503.
- `GET /api/skus` → **500**, body leaked Prisma internals: `Invalid prisma.sku.findMany() invocation: Can't reach database server at postgres:5432`.
- `POST /api/dims` → **500**, leaked `prisma.sku.findUnique()` text. `findUnique` precedes the upsert, so **no half-write**.
- Backend container stayed **Up (healthy)** throughout — PID 1 never exited (no `restart:` policy in compose, so a crash would have been fatal; it did not crash).
- **Automatic recovery:** after `docker start`, the *first* `/api/health` probe returned **200** with zero backend restart — Prisma reconnects on its own. Reads + a fresh `POST /api/dims` both succeeded post-recovery.

**Finding 1 (Minor) — Leaked Prisma error text on infra failure.** `errorHandler` returns `err.message` verbatim for non-`AppError` errors, exposing the internal DB hostname/port and Prisma call shape to clients on any 500. **Recommendation:** in `middleware/errorHandler.ts`, for unknown errors return a generic `{"error":"Internal server error"}` with the real message logged server-side only. (Note: this is the only place internal infra detail leaks; the 503 health branch is already clean.)

---

## Scenario 2 — DB killed mid-request — PASS

**Repro:** 20 concurrent `POST /api/dims`, `docker kill dimcap-cs-postgres-1` ~150ms in; then a single write with `kill` at 0ms delay; restart pg; inspect data.

**Evidence:**
- The 20-write burst all returned 200 before the kill landed (one-row-per-SKU upsert is sub-ms).
- A genuinely in-flight write during the kill returned **500 `{"error":"...prisma.sku.findUnique()... Server has closed the connection."}`** — clean error, no crash, no partial write (cc-1 retained its prior value, the 333 write did not persist).
- Backend **Up (healthy)** after both kills.
- After `docker start`: first health probe **200**; `GET /api/dims` shows **one row per SKU, no duplicates/orphans** — upsert + transactional write preserve integrity.

(Same leaked-Prisma-text caveat as Finding 1.)

---

## Scenario 3 — mock-CC down during sync — PASS

**Repro:** capture 3 unsynced dims; `docker stop dimcap-cs-mock-cc-1`; `POST /api/sync/cc`; restart mock-cc; re-sync.

**Evidence:**
- With CC down: `POST /api/sync/cc` → **200 `{"synced":0,"failed":3,"pending":3}`** in ~15s (~5s/PATCH = OS connect-refused timeout × 3). Per-item `try/catch` isolated every failure; **run did not abort, backend did not crash**, dims left `syncedToCC=false` for retry.
- After restart + re-sync: **200 `{"synced":3,"failed":0,"pending":0}`** in 12ms. Retry path fully works, **no data loss**.

---

## Scenario 4 — mock-CC slow / paused (timeout) — SIGNIFICANT FINDING

**Repro:** capture 1 unsynced dim; `docker pause dimcap-cs-mock-cc-1` (TCP accepted, never responds); `POST /api/sync/cc` with a 90s client timeout; probe other endpoints; `docker unpause`.

**Evidence:**
- The sync request **never returned** — curl hit its own `-m 90` ceiling: **HTTP 000, exit 28, time=90.004s**. The server side had no timeout of its own.
- The event loop was **not** starved: `/api/health` and `/api/progress` answered in ~2ms while sync hung.
- After unpause, the long-blocked `fetch` resumed and completed the PATCH server-side; a follow-up sync showed `{"synced":0,"failed":0,"pending":0}` (the dim had synced) — so **no data loss**, but a client saw an indefinite hang.

**Finding 2 (Significant) — No timeout on CartonCloud fetch calls; sync can hang indefinitely.** `services/ccClient.ts` calls `this.fetchImpl(...)` for `lookupByBarcode`, `listProducts`, and `patchProductDims` with **no `AbortSignal` / timeout**. A slow or frozen CC (or a half-open connection) blocks the `POST /api/sync/cc` request forever — the only thing that ended it was the client giving up. On the NUC this would tie up sync requests and the frontend's sync button for as long as CC is unresponsive. **Recommendation:** add a per-request timeout via `AbortSignal.timeout(ms)` (e.g. 10–15s) to every `fetchImpl` call in `ccClient`; surface an abort as a `CcApiError` so the existing per-item `try/catch` in `syncService` counts it as `failed` and leaves the dim for retry (degrades exactly like Scenario 3). Connect-refused (CC down) already fails in ~5s via the OS; this closes the *frozen-peer* hole.

---

## Scenario 5 — Backend restart with in-flight data — PASS, no data loss

**Repro:** capture a dim tagged `survive-restart`; `docker restart dimcap-cs-backend-1`; inspect logs + data.

**Evidence:**
- Boot CMD is `npx prisma migrate deploy && node dist/index.js` (Dockerfile). On restart: **“1 migration found … No pending migrations to apply.”** — `migrate deploy` is non-destructive (no reset/drop). `package.json db:migrate` (`prisma migrate dev`) is dev-only and not used at runtime.
- Backend healthy again within ~2s; `survive-restart` dim present → **DATA SURVIVED** (Postgres named volume persists).

---

## Scenario 6 — Backend down, frontend up — PASS (with Minor healthcheck note)

**Repro:** `docker stop dimcap-cs-backend-1`; hit `/` and `/api/health` through nginx; restart backend.

**Evidence:**
- `GET /` → **200** — static PWA shell still served (degraded mode works).
- `GET /api/health` via proxy → **clean 502 Bad Gateway** (`nginx/1.27.5`) in <1ms — nginx did NOT refuse to boot or crash; variable-upstream proxy degrades gracefully.
- nginx container **stayed Up** throughout.
- After backend restart, proxy `/api/health` → **200 `{db:connected}`** automatically.

---

## Scenario 7 — Restart ordering / cold boot — PASS

**Repro:** `docker compose ... -p dimcap-cs restart`, then full stop-all + `up -d`.

**Evidence:**
- `compose restart` recovered to backend-200 in ~2s; data intact.
- Cold `up -d` honoured `depends_on` **dependency ordering**: postgres + mock-cc → **Healthy** first, then backend Started → Healthy, then frontend. No race, no manual intervention.
- Post-boot: health 200, frontend 200, proxy 200, all dim rows present → **data fully survived**, stack converged clean.

---

## Minor finding (cross-scenario)

**Finding 3 (Minor) — Frontend container reports `unhealthy` despite serving 200.** The container healthcheck `wget -qO- http://localhost:80/` runs inside the nginx container and resolves `localhost` to **IPv6 `::1`**, but nginx listens only on IPv4 `0.0.0.0:80` → wget gets `Connection refused`, healthcheck exits 1 (FailingStreak 328 since boot). The service itself serves `/` as 200 to the host the entire time, so this is **cosmetic** — but it masks real frontend health and would mislead `depends_on: condition: service_healthy` for anything downstream of the frontend. **Recommendation:** point the healthcheck at `http://127.0.0.1:80/` (force IPv4) or add `listen [::]:80;` to the nginx server block.

---

## PASS criteria check
- No backend process crash — **PASS** (survived every DB stop/kill, CC stop/pause, and restart).
- DB-down → graceful 503/5xx + automatic recovery — **PASS** (503 health branch verified; auto-reconnect, no bounce). Caveat: 500s leak Prisma text (Minor, Finding 1).
- CC-down leaves dims unsynced for retry, no loss/crash — **PASS** (Scenario 3).
- Frontend serves degraded shell when backend down — **PASS** (Scenario 6).
- Cold boot recovers cleanly with correct ordering — **PASS** (Scenario 7).
- Key risks: (a) DB-blip auto-recovery — **YES, recovers, not wedged**. (b) CC call timeout — **NO timeout, sync can hang forever** (Finding 2, Significant). (c) data loss across restarts — **NONE**.

## Stack restored
`docker compose ... -p dimcap-cs up -d` → all 4 `dimcap-cs-*` containers running; postgres/mock-cc/backend healthy; frontend serving 200 (label `unhealthy` per Finding 3 only). `GET :3012/api/health` → 200 `{"status":"ok","db":"connected"}`; `:5179/` → 200; proxy `:5179/api/health` → 200; progress 4/4 synced, 0 pending.
