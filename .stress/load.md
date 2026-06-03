# dim-capture-app — Load / Stress Test Report

**Date:** 2026-06-04
**Targets:** backend `http://localhost:3012` (direct), frontend/proxy `http://localhost:5179`
**Method:** HTTP only (curl backgrounded concurrency + `wait`; no `ab`/`hey`/`wrk` installed). No containers touched, no source/git modified.
**Deployment reality:** single ASUS NUC (16GB RAM), LAN-only, 3–5 warehouse staff, ~100–120 orders/day. **Realistic concurrency is single digits.** Severity is judged against that.

---

## OVERALL: PASS

No crash, no data loss, no unrecoverable degradation at any tested concurrency (up to 500). The app stays correct and fast well beyond any load this deployment will ever see. The rate limiter — the most likely failure surface — degrades **gracefully** (HTTP 200, failures counted, dims left pending for retry, full recovery on token refill). The findings below are all **Minor** or informational; none block deployment.

---

## Breaking point

**No functional breaking point found within the safety envelope (≤500 concurrent).**
- Reads: clean 200s at 10/50/100/200/500 concurrent. Throughput ~1,300–1,580 RPS on `/api/skus`. Latency scales linearly with concurrency (queueing), never errors.
- Writes: clean 200s at 10/25/50/100 concurrent upserts contending on the same 3 rows. No 500s, no pool exhaustion, no deadlocks.
- Static assets via nginx: ~2,000 RPS for the 353KB JS bundle at 500 concurrent, p95 22ms.
- The only "limit" is the **intentional** CC sync rate limiter (60-token bucket, refill 1/s), which rejects cleanly rather than failing.

The practical ceiling is CPU-bound request queueing, not failure. At the realistic single-digit concurrency, p50 ≈ 4–6ms.

---

## Latency table (representative)

| Scenario | Concurrency | p50 | p95 | max | errors |
|---|---|---|---|---|---|
| `GET /api/skus` direct | 10 | 6.0ms | 9.6ms | 12ms | 0 |
| `GET /api/skus` direct | 200 | 35ms | 58ms | 68ms | 0 |
| `GET /api/skus` direct | 500 | 99ms | 135ms | 145ms | 0 |
| `GET /api/skus` proxy (5179) | 500 | 42ms | 89ms | 110ms | 0 |
| `GET /api/health` direct | 500 | 78ms | 110ms | 146ms | 0 |
| `GET /api/progress` direct | 500 | 132ms | 178ms | 194ms | 0 |
| `GET /` frontend shell | 200 | 1.7ms | 9.3ms | 22ms | 0 |
| JS bundle 353KB (nginx) | 500 | 3.3ms | 22ms | 58ms | 0 |
| `POST /api/dims` upsert (3 rows) | 100 | — | 52ms | 55ms | 0 |
| Mixed 50 read + 50 write | 100 | — | R 32ms / W 49ms | R 35 / W 49ms | 0 |

Single-request baseline (idle): health 2.5ms, skus 5ms, progress 3.7ms, dims 3ms, 404 lookup 6.8ms.

---

## Probe-by-probe results

**1. Read throughput ramp (10→500).** All clean. Direct `/api/skus` peaked ~1,580 RPS. Latency grows with concurrency as expected for a queue (p50 6ms@10 → 99ms@500) but zero errors and no spikes/cliffs. `/api/progress` is the heaviest read (does the most aggregation): p95 178ms @ 500 vs 135ms for `/api/skus`.

**2. Proxy vs direct.** nginx `/api` proxy adds no meaningful latency; at high concurrency it was *faster* (p95 89ms vs 135ms @ 500) due to connection pooling/keep-alive to the backend. No nginx worker/connection ceiling hit. Static serving (shell + 353KB bundle) is gzip'd and served at ~2,000 RPS.

**3. Write load (concurrent upsert).** 555 upserts across 10–100 concurrency, all contending on 3 rows. All 200. **Upsert integrity held perfectly: exactly one dim per SKU after the storm** (verified `group_by(.skuId)` → dimCount=1 each). No Prisma connection-pool exhaustion, no deadlocks, no 500s. Validation paths correct: unknown skuId → 404, negative/missing fields → 422.

**4. Rate-limiter behaviour (the key probe).** Drove 25 rapid sync cycles of 3 CC calls each (75 calls) in 0.68s, exceeding the 60-token bucket. Cycles 1–20 (= 60 calls): `{synced:3,failed:0,pending:0}`. Cycles 21–25: `{synced:0,failed:3,pending:3}` — **HTTP 200, rate-limit surfaced as counted failures, dims left pending for retry. No 500, no crash.** After ~5s of token refill, re-sync returned `{synced:3,failed:0,pending:0}` — **full recovery, zero data loss.** This is exactly the designed, well-behaved contract.

**5. Sustained load (30s).** 535 waves × 50 concurrent reads (~26,750 requests). p95 flat at ~16ms from first wave to last (avg p95 16.2ms, worst single-wave max 49ms). **No latency drift, no memory-leak/pool-starvation symptom.** Health `{status:ok,db:connected}` throughout and after.

**6. Static assets.** Frontend shell (1.2KB) p50 1.7ms; 353KB JS bundle p50 3.3ms @ 500 concurrent. nginx handles asset fan-out trivially.

---

## Findings

### F1 — `POST /api/dims` upsert silently resets sync status to pending (by design, but unbounded re-sync cost)
- **Severity: Minor** (informational / future hardening)
- **Evidence:** Re-upserting an already-synced SKU flips `syncedToCC`→`pendingSync` (progress went `synced:3` → `synced:2,pending:1`). This is correct (a re-measured carton must re-sync), but it means repeated edits + auto-sync can burn CC rate-limit tokens. In a tight loop this is what drained the 60-token bucket. At single-digit user load with ~409 SKUs measured once, this is a non-issue.
- **Repro:** `POST /api/dims` for an already-synced skuId, then `GET /api/progress` → pendingSync increments.

### F2 — `/api/progress` is the most expensive read under load
- **Severity: Minor**
- **Evidence:** p95 178ms @ 500 concurrent vs 135ms for `/api/skus` and 110ms for `/api/health`. Suggests per-request aggregation rather than a cached/precomputed count. Irrelevant at realistic load (3.7ms idle), but if a dashboard polls `/api/progress` aggressively it is the first endpoint to feel pressure.
- **Repro:** ramp `GET /api/progress` to 500 concurrent; compare p95 to `/api/skus`.

### F3 — Latency is pure queueing under synthetic overload (no backpressure/shedding)
- **Severity: Minor**
- **Evidence:** p50 grows 6ms→99ms as concurrency goes 10→500 on `/api/skus`; the server accepts and queues everything rather than shedding. No errors, but there is no explicit concurrency cap or 503 backpressure. For a LAN single-NUC 3–5-user app this is fine and arguably preferable. Flagged only so it is a conscious choice, not an assumption.
- **Repro:** ramp concurrency; observe monotonic p50 growth with 0% error rate.

### F4 — Rate-limit failures are reported but not auto-retried by the server
- **Severity: Minor** (arguably correct design)
- **Evidence:** When the bucket is empty, dims are left `pending` and the caller must re-invoke `POST /api/sync/cc` after refill. Recovery worked perfectly on manual re-sync (3 pending → synced after ~5s). There is no server-side automatic retry/backoff loop, so a client/cron must drive retries. Acceptable for the human-approval-gated sync model in this project; noted so the sync caller (cron/UI button) is built to retry pending items.
- **Repro:** exceed 60 CC calls in <60s, observe `{failed:N,pending:N}`; wait ≥N seconds; re-POST `/api/sync/cc` → succeeds.

---

## Notes / caveats
- Only 3 seedable SKUs (cc-1/2/3) exist, so write/upsert contention was concentrated on 3 rows (a *harder* test for locking/deadlocks than spreading across many rows — and it passed).
- An external SKU `cc-9` (dim `measuredBy: ins27`) appeared mid-test from another process on this shared host (consistent with the brief's note about unrelated stacks). It was **not** created by this load test and is not a defect of the app.
- Token-bucket recovery and sustained-run waits were done via busy-poll loops on `/api/health` (foreground `sleep` is blocked in this environment), which also served as continuous light load — health stayed `ok` throughout.

## Verdict
**PASS.** Correct under concurrency far beyond this deployment's reality, no data loss, graceful rate-limit degradation with clean recovery, no leak/drift over 30s sustained. Findings are all Minor; none require a hardening module before NUC deployment.
