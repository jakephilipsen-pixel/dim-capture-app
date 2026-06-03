# Known Issues — dim-capture-app

Minor findings from `/compile-stress` (2026-06-04). None block a deploy; each is
safe and recoverable. Full context in `STRESS_TEST_RESULTS.md` + `.stress/*.md`.
Severity here is **Minor** by definition (Critical → fix branch; Significant → planned module).

| ID | Issue | Severity | Repro / Evidence | Suggested fix |
|----|-------|----------|------------------|---------------|
| M1 | `getProgress` reads `total`/`captured`/`synced` counts in 3 separate queries outside a transaction — a torn-read window exists | Minor | 200 samples under concurrent capture/sync churn: 0 incoherent reads; invariant `captured ≥ syncedToCC` held | Wrap the 3 counts in one `prisma.$transaction([...])` if it ever surfaces |
| M2 | A single shared CC token bucket (60, refill 1/s) is used by both seed and sync, so they can starve each other; bucket-empty returns **500** | Minor | Concurrent seed + sync observed `500 rate limit exceeded` | Return **429** (retryable) + separate buckets per operation; ties into the `cc-resilience` module |
| M3 | Version-disclosure headers: `X-Powered-By: Express` (backend), `Server: nginx/1.27.5` (frontend) | Minor | `curl -I` on both | `app.disable('x-powered-by')`; `server_tokens off;` — folded into `deploy-hardening` |
| M4 | Frontend container shows `unhealthy` in `docker ps` while serving HTTP 200 | Minor | Healthcheck `wget localhost:80` resolves to IPv6 `::1`; nginx listens IPv4-only → "connection refused", FailingStreak 300+. App serves fine | Healthcheck `127.0.0.1` **or** `listen [::]:80;` — folded into `deploy-hardening` |
| M5 | Absurd-but-finite dims accepted (`lengthMm:1e308`, `0.0000001`) — only `>0` is enforced | Minor | `POST /api/dims` with `1e308` → 200, stored verbatim | Add an upper sanity bound (e.g. ≤ 5000 mm, weight ≤ 1000 kg) in the zod schema |
| M6 | JSON `Infinity` (`1e400`) correctly rejected 422 but with a confusing message: `expected number, received number` | Minor | `POST /api/dims` with `"lengthMm":1e400` | Custom zod refinement message for non-finite numbers |
| M7 | Sync rate-limit failures are not auto-retried server-side | Minor (by design) | After 60 tokens, `{synced:0,failed:N,pending:N}`; a manual re-sync ~5 s later fully recovers, no data loss | Optional: a background retry/backoff worker (out of current scope; the offline-sync caller already retries) |
| M8 | `/api/progress` is the heaviest read (uncached aggregation): p95 178 ms @ 500 concurrent vs 135 ms for `/api/skus` | Minor | Load ramp; irrelevant at real single-digit-user load on the NUC | Cache/short-TTL only if a real device proves slow |
| M9 | shadcn `DialogContent` missing `Description`/`aria-describedby` | Minor (a11y) | Warning emitted in `Progress.test.tsx` / `Review.test.tsx` | Add `<SheetDescription>` (or `aria-describedby`) to the edit sheet |

## Non-issues confirmed (recorded so they aren't re-investigated)
- SQLi/XSS/template-injection/path-traversal: all neutralised (Prisma parameterised + zod + no SSR).
- Mass-assignment of `syncedToCC`/`id`/`measuredAt` via POST body: ignored.
- CC `CC_API_KEY` never leaks into any response/error/health body.
- DB-down → graceful 503 + automatic reconnect; data survives backend restart; no process crash under any injected failure.
