# State: docker-deploy

> This file is the handoff record between conversations. Keep it accurate. Other modules will load THIS FILE (not source) to understand what this module exports.

## Status
✅ Built — smoke passing + all acceptance criteria verified (2026-06-04)

## Branch
`feature/docker-deploy`

## Last touched
2026-06-04 — initial build: production compose, single-origin nginx /api proxy,
root .env.example, Caddy fragment, full-stack module smoke. Smoke green; production
compose validated end to end on real ports (5175/3005/5434).

## Public interface (the contract other modules see)

```typescript
// No TS exports — infrastructure only.
```

This module owns deployment infrastructure. The runtime contract it establishes:

- **Production is single-origin.** Everything reaches the app via the frontend
  (`http://dims.gocold.local` → Caddy → frontend:80). The frontend's nginx serves
  the static PWA and proxies `/api/*` to `backend:3005` over the compose network.
  The backend is NOT exposed to the browser; it is published on host `:3005` only
  for host-side health checks and migrations.
- **Frontend API base is build-time and relative.** `frontend/Dockerfile` takes an
  `ARG VITE_API_URL` (default `""`). Empty → `api.ts` uses a relative `/api` base.
  Both `docker-compose.yml` and the smoke stack build with `VITE_API_URL=""`.

## Exports
Files this module adds/owns:
- `docker-compose.yml` — production stack (postgres + backend + frontend)
- `docker-compose.local.yml` — dev: postgres only on 5434 (pre-existing; unchanged)
- `.env.example` (root) — all 7 production env vars, documented
- `caddy/dims.gocold.local.caddy` — Caddy fragment for the NUC (host → frontend:5175)
- `.health-endpoints` — `api http://localhost:3005/api/health`
- `modules/docker-deploy/docker-compose.smoke.yml` — full-stack smoke (real images + mock CC)
- `modules/docker-deploy/smoke/healthcheck.sh` + `happy-path.sh`

Files this module modified (owned by other modules, changed for deploy):
- `frontend/Dockerfile` — added `ARG/ENV VITE_API_URL` before the build
- `frontend/nginx.conf` — added the `/api/` reverse-proxy block (variable upstream)
- `NUC_DEPLOY.md` — Caddy stage rewritten for `dims.gocold.local` + DNS setup note

## Internal structure
```
dim-capture-app/
  docker-compose.yml          production: pg(5434) + backend(3005) + frontend(5175→80)
  docker-compose.local.yml    dev: postgres only (5434)
  .env.example                production env template (copy → .env, gitignored)
  caddy/dims.gocold.local.caddy   http://dims.gocold.local { reverse_proxy localhost:5175 }
  .health-endpoints           healthcheck-all.sh target list
  modules/docker-deploy/
    docker-compose.smoke.yml  pg + mock-cc + real backend(3012) + real frontend(5179)
    smoke/healthcheck.sh      polls /api/health direct AND via the frontend proxy
    smoke/happy-path.sh       seed → POST dim → readback (direct + via proxy) → shell
```

## Quirks / gotchas (read before touching deploy)
- **The spec's `VITE_API_URL=http://backend:3005` is wrong and deliberately NOT used.**
  It set a build-time Vite var as a runtime `environment:` (Vite never sees it), and
  the browser can't resolve the Docker hostname `backend`. We build the frontend with
  a relative base and proxy `/api` in nginx instead. See DECISIONS.md (2026-06-03/04).
- **nginx `/api/` uses a VARIABLE upstream** (`set $backend_upstream backend:3005;
  proxy_pass http://$backend_upstream;` + `resolver 127.0.0.11`). This is load-bearing:
  a literal `proxy_pass http://backend:3005` makes nginx resolve at startup and refuse
  to boot when no backend exists — which would break the frontend-only `frontend-scaffold`
  smoke. The variable defers DNS to request time. Do not "simplify" it to a literal.
- **Production `docker-compose.yml` requires a `.env`** (backend `env_file: .env`).
  Copy `.env.example` → `.env` first. `DATABASE_URL` MUST use the internal host
  `postgres:5432` (not `localhost:5434`, which is the host-published dev port).
- **Postgres credentials are hardcoded in `docker-compose.yml`** (gocold/gocold/dimcapture,
  matching the spec). If you change them, update `DATABASE_URL` in `.env` to match.
- **Caddy runs on the NUC host**, so the fragment proxies to `localhost:5175` (the
  published frontend port), not the compose service name `frontend` (unresolvable from
  the host). Install to `/etc/caddy/Caddyfile.d/`; the main Caddyfile must `import` it.
- **DNS for `dims.gocold.local` is a one-time manual network step** (router/dnsmasq →
  NUC IP). Not automated by deploy. Documented in NUC_DEPLOY.md.
- **Smoke host ports: backend 3012, frontend 5179** — chosen to dodge dev (3005/5175)
  and the other modules' smokes (06: 3010/5177, 07: 3011/5178).
- The smoke proxy check uses `curl` (server-side), which proves the nginx `/api` proxy.
  The browser's relative-base behaviour can't be checked without a headless browser
  (project convention: no headless browser in smoke); it's guaranteed by the build arg.

## Test status
- [x] Unit tests written — n/a (infrastructure only; no TS surface)
- [x] Smoke written + passing (`./scripts/smoke-module.sh docker-deploy` exit 0):
      direct + via-proxy health, seed, POST dim, readback (direct + proxy), shell, clean teardown
- [x] Integration with dependencies verified — production `docker-compose.yml` booted
      all three services (postgres + backend + frontend) Healthy; `GET :3005/api/health`
      and `GET :5175/api/health` (proxy) both 200; frontend shell 200 on :5175 (nginx 1.27.5);
      `docker-compose.local.yml` postgres on 5434; Caddy fragment `Valid configuration`
- [x] Caddy fragment validated via `caddy:2-alpine` image (host has no caddy binary)

## In-flight work
None — module complete.

## Decisions made during this module's build
(all added to DECISIONS.md)
- 2026-06-03 | Production is single-origin: frontend built relative (`VITE_API_URL=""`),
  nginx proxies `/api` → backend; overrides the spec's broken `VITE_API_URL=http://backend:3005`
- 2026-06-03 | nginx `/api` uses a variable upstream + resolver so it boots without a backend
  (keeps the frontend-only frontend-scaffold smoke working)
- 2026-06-03 | Deploy URL is `http://dims.gocold.local` (LAN-only, host-Caddy → frontend:5175),
  superseding the scaffold's `dim-capture-app.rolodex-ai.com`
