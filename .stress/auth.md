# dim-capture-app — Auth / Security Posture Stress Test

**Date:** 2026-06-04
**Targets:** backend direct `http://localhost:3012` (container `dimcap-cs-backend-1`, internal `:3005`), frontend+proxy `http://localhost:5179` (`dimcap-cs-frontend-1`).
**CC backend:** in-container mock (`CC_BASE_URL=http://mock-cc:9099`, `smoke-key`/`smoke-tenant`) — confirmed via `printenv`. No real CC touched.
**Deployment reality:** single NUC on Go Cold warehouse LAN, Caddy-fronted `http://dims.gocold.local`, ~3-5 staff, no internet exposure. No login by design (internal tool).

## Overall: PASS (with mandatory hardening before prod)

No secret leakage, no injection, no stack-trace leakage. The auth posture is "none," which is acceptable for a LAN-only internal tool — **except** that one unauthenticated endpoint (`POST /api/sync/cc`) writes to the REAL CartonCloud in production, which collides with the CLAUDE.md "never auto-write to CC without human approval" rule. That, plus the backend being published LAN-wide and missing browser security headers, are the items to fix. None of the findings constitute remote exploitation beyond LAN-tool intent, so this is a PASS, but F1 and F2 are Significant and should ship as a hardening module with/before production.

---

## FINDINGS

### F1 — `POST /api/sync/cc` writes to real CartonCloud, unauthenticated, no confirmation — Significant
**Evidence:**
```
$ curl -s -i -X POST http://localhost:3012/api/sync/cc
HTTP/1.1 200 OK
{"synced":1,"failed":2,"pending":2}
# also reachable through the single-origin proxy:
$ curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:5179/api/sync/cc
200
```
`routes/sync.ts` → `syncUnsyncedDims()` PATCHes every unsynced dim into CC (`ccClient.patchProductDims`). There is no auth, no CSRF token, no idempotency guard, and no human-approval gate. In the running stack this hit the mock; in production `CC_BASE_URL` is empty → defaults to `https://app.cartoncloud.com.au/api/v1` (confirmed in `ccClient.ts` `CC_DEFAULT_BASE_URL` and `.env.example` leaving `CC_BASE_URL=` blank), so any LAN host that can reach the frontend or backend can push local dims into the live WMS.

**Why it matters here:** The product spec omits user auth and that's fine for reads and local dim writes. But CLAUDE.md (parent project) is explicit: *"Never push slotting rules to CC automatically… let a human review."* `POST /api/sync/cc` is exactly an automated, unguarded CC write, triggerable by anyone on the warehouse LAN (or any device/script that lands on that subnet). The blast radius is "wrong/partial dims written to the production WMS for 400+ SKUs," which then drive cartonisation/slotting. That's a data-integrity action against an external system of record, not a local-only effect — it exceeds normal internal-tool intent.

**Recommendation:** Gate the CC-write path specifically (not the whole app):
- Require a confirmation step / explicit operator action token for `/api/sync/cc` (a shared bench secret in a header, or a server-side "sync armed" flag a supervisor toggles), even if the rest stays open. This satisfies the human-approval gate without forcing a login on the capture flow.
- Keep an audit log line per sync run (already partially done via pino `log.info`) and surface "who/when" in the response.

### F2 — Backend port published to the LAN (`0.0.0.0:3005`), defeating single-origin design — Significant
**Evidence:**
```
$ docker inspect dimcap-cs-backend-1 --format '{{json .NetworkSettings.Ports}}'
{"3005/tcp":[{"HostIp":"0.0.0.0","HostPort":"3012"},{"HostIp":"::","HostPort":"3012"}]}
```
`docker-compose.yml` (prod) publishes the backend as `"3005:3005"` — also `0.0.0.0`. The architecture comment in that file states the browser "never reaches the backend host directly," but the published port means every endpoint (including `POST /api/sync/cc` and `POST /api/admin/seed`) is reachable on the LAN bypassing nginx/Caddy entirely. The single-origin/proxy design is therefore not actually enforced.

**Recommendation:** In prod, bind the backend publish to loopback only (`127.0.0.1:3005:3005`) or drop the host port mapping entirely and rely on the compose network + the nginx `/api` proxy. Host-side health checks/migrations can use `docker exec` or the internal network. This removes the second, unproxied attack surface and is the cheapest hardening win.

### F3 — No browser security headers on the frontend (clickjacking, MIME sniffing) — Significant
**Evidence:**
```
$ curl -s -I http://localhost:5179/ | grep -iE 'x-frame-options|content-security-policy|x-content-type-options'
(none)
```
`frontend/nginx.conf` sets cache headers only. Missing: `X-Frame-Options: DENY` / CSP `frame-ancestors 'none'`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`. HSTS is N/A (plain-http LAN). A malicious page on a staff workstation could frame `dims.gocold.local` and clickjack the (unauthenticated, state-changing) sync/seed buttons.

**Recommendation:** Add to nginx `server` block:
```
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Content-Security-Policy "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'" always;
add_header Referrer-Policy "no-referrer" always;
```
(Validate the CSP against the Vite bundle — may need `style-src 'self' 'unsafe-inline'` and the theme-color/img bits.)

### F4 — Shared rate-limit bucket lets sync/seed starve each other (transient DoS) — Minor
**Evidence:** `ccClient.ts` uses a single app-wide `TokenBucket` (60 tokens, 1/sec) shared by `listProducts` (seed) and `patchProductDims` (sync). Back-to-back sync+seed produced:
```
$ curl -s -X POST .../api/admin/seed
{"error":"CartonCloud rate limit exceeded (60 req/min)"}
```
A real seed pages through ~460 products (multiple tokens); a concurrent or rapid sync can drain the bucket and make the other operation fail with a 500. Since the endpoints are unauthenticated, any LAN host can also intentionally hammer them. Bucket refills at 1/sec so the effect is transient, not a hard outage.

**Recommendation:** Acceptable for a LAN tool, but cleaner to (a) translate `CcRateLimitError` to HTTP 429 rather than 500, and (b) consider separate buckets or a queue for seed vs sync. Tie this to the F1 gate (gating sync also throttles abuse).

### F5 — Framework / server version disclosure — Minor
**Evidence:**
```
X-Powered-By: Express          (backend, every response)
Server: nginx/1.27.5           (frontend)
```
Low value to an attacker on a LAN tool, but trivial to remove.

**Recommendation:** `app.disable("x-powered-by")` in `app.ts`; `server_tokens off;` in nginx.

### F6 — `POST /api/admin/seed` is unauthenticated and the "admin" prefix is not protected — Minor (in LAN context)
**Evidence:**
```
$ curl -s -X POST http://localhost:3012/api/admin/seed
{"pages":1,"fetched":3,"upserted":3,"ccDimsPresent":1}
```
`routes/admin.ts` mounts under `/api/admin` with zero auth middleware — the prefix is cosmetic. The action is a read-from-CC + local upsert (idempotent, non-destructive to CC), so on a LAN tool the risk is low: worst case is forced re-seed churn / token-budget drain (see F4). Flagging because the path name implies a privilege boundary that does not exist.

**Recommendation:** If/when the F1 operator-token gate is added, apply the same middleware to `/api/admin/*` so the naming matches reality.

---

## What was tested and found CLEAN (no finding)

- **Secret handling — PASS.** `CC_API_KEY` (len 9, `smoke-key`) never appears in any response, error, or health body. Grepped `/api/admin/seed` and `/api/sync/cc` outputs for the key → 0 hits. Secrets live only in container env (`printenv` / `env_file: .env`), not logged to responses. No endpoint echoes env/config (`/api/config`, `/api/env`, `/api/debug`, `/api/.env`, `/api/admin/config` all 404).
- **CORS — PASS.** `Access-Control-Allow-Origin` is the configured `FRONTEND_URL` (`http://localhost:5179`), not `*`, and a foreign `Origin: http://evil.example.com` is **not** reflected. Static allowlist, not echo. Preflight `OPTIONS` returns only standard method list, no sensitive data.
- **Injection — PASS.** SQLi-style `skuId` (`DROP TABLE skus;--`) is treated as a literal via Prisma (parameterized) → clean 404 `Unknown skuId`. Zod validates dim bodies (positive numbers, non-blank strings) → 422 with field message only.
- **Error leakage — PASS.** No stack traces, file paths, or DB connection strings. `errorHandler.ts` returns `{error: message}` only. Malformed JSON returns the body-parser position message (informational, no path). 500s return the bare error message.
- **Header injection / tenant override — PASS.** Client-supplied `X-Tenant-Id` is ignored; backend uses the env tenant. Host-header tampering via the proxy does not alter CORS (static env value).
- **Method tampering — PASS.** `TRACE` → 404 with `Content-Security-Policy: default-src 'none'` (Express default 404). No XST.

## Severity tally
- Critical: 0
- Significant: 3 (F1 unauth real-CC write, F2 backend LAN-published, F3 missing security headers)
- Minor: 3 (F4 shared rate-limit bucket, F5 version disclosure, F6 unprotected admin prefix)
