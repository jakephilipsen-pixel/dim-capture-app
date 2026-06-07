# Module 11 — deploy-hardening

## What this module does

Closes four security/quality findings surfaced by the `/compile-stress` run
(2026-06-04): two Significant (S5, S7) and two Minor (M3, M4). Changes span
the production compose file, the frontend nginx config, and the Express app.

## Scope

### S5 — Production backend published to the LAN

`docker-compose.yml` mapped the backend to `0.0.0.0:3005`, bypassing the
single-origin nginx proxy and exposing every (unauthenticated) backend endpoint
to any host on the LAN.

**Fix:** The backend host port mapping is dropped entirely. The frontend nginx
reaches the backend over the compose network (`backend:3005`). Host-side health
checks use the nginx proxy (`http://localhost:5175/api/health`).
`.health-endpoints` updated accordingly.

**Decision:** drop the host mapping (not rebind to 127.0.0.1), as it is
architecturally cleaner and production-correct: the docker-deploy module's
documented design states the backend is not exposed to the browser or to
host-side callers. See DECISIONS.md (2026-06-08).

### S7 — Frontend nginx sets no security headers

`frontend/nginx.conf` set no security headers, enabling clickjacking and
MIME-sniffing attacks against the unauthenticated state-changing UI.

**Fix:** Added to all response paths (server-level `add_header ... always;`,
repeated in each location block that sets its own `add_header` to prevent
nginx inheritance override):

- `X-Frame-Options: DENY` — blocks framing in all browsers (legacy compat)
- `X-Content-Type-Options: nosniff` — prevents MIME-sniffing
- `Content-Security-Policy` (see policy string below) — restricts resource
  origins for this SPA

**CSP policy:**
```
default-src 'self'; script-src 'self'; style-src 'self';
img-src 'self' data:; connect-src 'self'; worker-src 'self';
manifest-src 'self'; media-src 'self'; frame-ancestors 'none';
```

Rationale for each directive:
- `default-src 'self'` — blanket same-origin restriction
- `script-src 'self'` — Vite builds hashed bundles served from `/assets/`; no inline scripts
- `style-src 'self'` — Tailwind CSS bundle served from `/assets/`; no inline styles
- `img-src 'self' data:` — favicons/icons plus any `data:` URIs React components may emit for SVGs
- `connect-src 'self'` — all `fetch()`/XHR calls target relative `/api/*` paths
- `worker-src 'self'` — Workbox service worker served from `/sw.js` (same origin)
- `manifest-src 'self'` — PWA manifest at `/manifest.json`
- `media-src 'self'` — ZXing assigns the camera stream via `srcObject` (not `createObjectURL`), so `blob:` is not required
- `frame-ancestors 'none'` — redundant with `X-Frame-Options: DENY` but honoured by modern browsers
- No `'unsafe-inline'` or `'unsafe-eval'` needed — confirmed by inspecting the ZXing library and Vite build output

### M3 — Version disclosure

Express sets `X-Powered-By: Express` on every response; nginx's default
configuration includes its version in the `Server` header.

**Fix:**
- `backend/src/app.ts`: `app.disable("x-powered-by")` added before middleware registration
- `frontend/nginx.conf`: `server_tokens off;` added to the server block
- Unit test in `backend/src/__tests__/app.test.ts` asserts `x-powered-by` absent on `/api/health`

### M4 — Frontend healthcheck false-unhealthy

The in-container healthcheck `wget http://localhost:80/` caused busybox wget
to attempt `::1` (IPv6) first, but nginx listens on IPv4 only, so the container
reported `unhealthy` while serving 200 OK to real clients.

**Fix:** Changed `localhost` to `127.0.0.1` in both the
`docker-compose.yml` frontend service healthcheck and the `frontend/Dockerfile`
image-level `HEALTHCHECK` directive.

## Out of scope

- S6 (`POST /api/sync/cc` and `/api/admin/seed` unauthenticated) — module 12 `cc-write-authz`
- S8 (dim upsert insert-path race) — module 13 `write-concurrency`
- Modules 10, 12, 13 all remain planned (🔲)

## Acceptance criteria

1. `docker-compose.yml`: no host port mapping for the backend service
2. `docker-compose.yml` + `frontend/Dockerfile`: frontend healthcheck uses `127.0.0.1`
3. `frontend/nginx.conf`: `server_tokens off;` present; `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy` present with `always` on every response path
4. `backend/src/app.ts`: `app.disable("x-powered-by")` present
5. `.health-endpoints`: points to the nginx proxy path (`:5175/api/health`), not `:3005`
6. `npx tsc --noEmit` clean; all tests green; +1 unit test for M3
