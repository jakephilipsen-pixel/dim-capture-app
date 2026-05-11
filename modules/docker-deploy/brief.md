# Module: docker-deploy

## Purpose
Containerise the full stack and configure the NUC deployment. This module produces the Docker Compose files for both dev and production, the complete `.env.example`, Caddy reverse proxy config for `dims.gocold.local`, and the smoke/healthcheck scripts the framework uses. After this module, the full local smoke gate (`/deploy-local`) is runnable.

## In scope
- `docker-compose.yml` — production: frontend (nginx serving Vite build), backend, postgres; all services on a shared network
- `docker-compose.local.yml` — dev: postgres only (port 5434); backend and frontend run locally via `npm run dev`
- `frontend/Dockerfile` — multi-stage: node build stage → nginx:alpine serve stage
- `backend/Dockerfile` — node:20-alpine, builds TS, runs compiled JS
- `.env.example` — all env vars documented with descriptions
- `.health-endpoints` — populated with real backend health URL
- `scripts/smoke-all.sh` and `scripts/healthcheck-all.sh` — updated to point at correct local ports
- `modules/docker-deploy/smoke/healthcheck.sh` — curls `GET /api/health` against the composed stack
- `modules/docker-deploy/smoke/happy-path.sh` — boots full stack via docker compose, POSTs a dim, checks it was saved, tears down
- Caddy config fragment: `dims.gocold.local` → frontend port 5175 (file at `caddy/dims.gocold.local.caddy`)
- NUC_DEPLOY.md updated to reflect actual local URL (`http://dims.gocold.local`)

## Out of scope
- Application code — all prior modules
- CI/CD pipeline (not in scope for this project)

## Dependencies
- All modules 01–07 (all application code must be complete and built)

## Public interface (what this module exports)

```typescript
// No TS exports — infrastructure only
```

## Acceptance criteria
- [ ] `docker compose -f docker-compose.local.yml up -d postgres` starts DB on port 5434 cleanly
- [ ] `docker compose up -d` (production compose) boots all three services with no errors
- [ ] `GET http://localhost:3005/api/health` returns 200 with composed stack running
- [ ] Frontend is served at port 5175 via nginx
- [ ] `./scripts/smoke-module.sh docker-deploy` exits 0 (boots, health check, happy path, teardown)
- [ ] `.env.example` documents all required vars: `CC_API_KEY`, `CC_TENANT_ID`, `CC_WAREHOUSE_ID`, `DATABASE_URL`, `NODE_ENV`, `PORT`, `FRONTEND_URL`
- [ ] Caddy fragment file present and syntactically valid (`caddy validate --config caddy/dims.gocold.local.caddy`)
- [ ] NUC_DEPLOY.md references `http://dims.gocold.local` (not the incorrect rolodex-ai.com URL from scaffold)

## Notes
The production URL for this project is `http://dims.gocold.local` (LAN-only, no Cloudflare tunnel). The Caddy fragment should be placed at `/etc/caddy/Caddyfile.d/` on the NUC — document the install step in NUC_DEPLOY.md. Local DNS (`dnsmasq` or router DHCP override) must resolve `dims.gocold.local` to the NUC IP on the warehouse LAN — document this as a one-time network setup step, not something this module does automatically.

Postgres credentials in Docker: `POSTGRES_DB=dimcapture`, `POSTGRES_USER=gocold`, `POSTGRES_PASSWORD=gocold` (local dev). Production uses env file with real credentials.
