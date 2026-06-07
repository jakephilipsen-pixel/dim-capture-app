# State: deploy-hardening

> This file is the handoff record between conversations. Keep it accurate. Other modules will load THIS FILE (not source) to understand what this module exports.

## Status
✅ Built — 2026-06-08

## Branch
`feature/hardening` (shares with module 09 `backend-error-hardening`)

## Last touched
2026-06-08 — module built (S5, S7, M3, M4). tsc clean; **88/88** tests (was 87; +1 new test).

## What changed

### `docker-compose.yml`
- **S5**: Removed `ports: - "3005:3005"` from the backend service. The backend
  is no longer reachable from the host or LAN; all traffic reaches it via the
  nginx proxy over the compose network.
- **M4**: Frontend service healthcheck changed from `http://localhost:80/` to
  `http://127.0.0.1:80/` with a comment explaining the busybox IPv6 resolution
  issue.

### `frontend/Dockerfile`
- **M4**: Image-level `HEALTHCHECK` changed from `http://localhost:80/` to
  `http://127.0.0.1:80/`.

### `frontend/nginx.conf`
- **M3**: `server_tokens off;` added to the server block.
- **S7**: Added `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and
  `Content-Security-Policy` (see policy below) to all response paths using
  `add_header ... always;`. Due to nginx's add_header inheritance rules
  (a location-level add_header overrides server-level ones), the three security
  headers are repeated in every location block that sets its own `add_header`
  (`/assets/`, `/sw.js`, `/registerSW.js`, `/manifest.json`). The `/api/` proxy
  block and the catch-all `/` block inherit from the server level.

**Final CSP string:**
```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; media-src 'self'; frame-ancestors 'none';
```

No `'unsafe-inline'` or `'unsafe-eval'` required. ZXing uses `srcObject` (not
`createObjectURL`), so `blob:` is not needed in `media-src`.

### `backend/src/app.ts`
- **M3**: `app.disable("x-powered-by")` added before middleware registration,
  removing the `X-Powered-By: Express` response header.

### `.health-endpoints`
- Updated `api` endpoint from `http://localhost:3005/api/health` to
  `http://localhost:5175/api/health` (nginx proxy path) because the backend
  host port was removed as part of S5.

### `backend/src/__tests__/app.test.ts` (new)
- One test: asserts `x-powered-by` is absent on `GET /api/health`.
  Prisma is mocked (`$queryRaw` → `[{...}]`) so the test is self-contained.

## Public interface
No changes to HTTP routes, response shapes, or service signatures.
Observable changes:
- Backend no longer reachable on host port 3005 (production)
- Every frontend response carries `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`
- Express responses no longer carry `X-Powered-By`
- Frontend container reliably reports healthy (no false-unhealthy from IPv6)

## Exports / files owned
- `docker-compose.yml` — modified (S5 port removal, M4 healthcheck fix)
- `frontend/Dockerfile` — modified (M4 healthcheck fix)
- `frontend/nginx.conf` — modified (M3 server_tokens, S7 security headers)
- `backend/src/app.ts` — modified (M3 x-powered-by disable)
- `.health-endpoints` — modified (S5 proxy endpoint)
- `modules/deploy-hardening/brief.md` — created
- `modules/deploy-hardening/STATE.md` — created (this file)

## Test status
- [x] Unit test written: +1 (`app.test.ts` — M3 x-powered-by absent)
- [x] All tests passing: `npm test` → **88/88** (was 87/87)
- [x] Typecheck clean: `npx tsc --noEmit` exit 0
- [ ] Docker stack smoke — not runnable without Docker; flag for compile-stress
  - Verify `docker ps` shows frontend healthy (M4)
  - Verify backend port 3005 is NOT in `docker ps` output (S5)
  - Verify `curl -I http://localhost:5175/` returns security headers (S7)
  - Verify no `X-Powered-By` on `curl -I http://localhost:5175/api/health` (M3)
  - Verify no `Server: nginx/...` version in response (M3)

## Quirks / gotchas

- **nginx add_header inheritance.** nginx does NOT inherit server-level
  `add_header` in a location block that sets its own `add_header`. This is a
  well-known gotcha. The security headers are therefore repeated in each
  location block that defines `Cache-Control` (`/assets/`, `/sw.js`,
  `/registerSW.js`, `/manifest.json`). The `/api/` proxy and catch-all `/`
  blocks do not set their own `add_header`, so they inherit the server-level
  headers correctly.
- **Backend healthcheck still uses localhost:3005 internally.** The backend
  container's own healthcheck probes `http://localhost:3005/api/health` from
  inside the container — that path is still valid (the container binds 3005
  internally). Only the *host* port mapping was removed.
- **`.health-endpoints` now points to the proxy.** Any script reading
  `.health-endpoints` for production health checks must have the frontend
  container healthy first (it depends on the backend). This matches the
  compose `depends_on` ordering.

## In-flight work
None — module complete.

## New dependencies added
None.

## Decisions made during this module's build (also in DECISIONS.md)
- 2026-06-08 | Drop backend host port entirely (not rebind to 127.0.0.1) | App works without it; docker-deploy module documents backend is not exposed to the browser; cleaner and production-correct | deploy-hardening build (S5)
- 2026-06-08 | CSP: no 'unsafe-inline' needed; media-src 'self' without blob: | ZXing uses srcObject (not createObjectURL); Vite builds hashed bundles with no inline scripts or styles; verified by source inspection | deploy-hardening build (S7)
