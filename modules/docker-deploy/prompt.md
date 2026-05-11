# Build prompt: docker-deploy

You are building the `docker-deploy` module of `dim-capture-app`.

## Read first
- This file (`modules/docker-deploy/prompt.md`)
- `modules/docker-deploy/brief.md` — scope and acceptance criteria
- `modules/docker-deploy/smoke.md` — smoke test spec (must pass before module is ✅)
- `modules/docker-deploy/STATE.md` — current state (will be empty for new builds)
- All previous modules' STATE.md files — to understand ports, env vars, and services
- `DECISIONS.md` — architectural decisions already made
- `dim-capture-app-spec.md` — Docker Compose spec and env var list

## Do not read
- Source code of any modules unless needed to write correct Dockerfile entrypoints
- `node_modules/`, build artifacts, lockfiles

## Task
Build this module to satisfy every acceptance criterion in `brief.md`. Production-ready configs, no placeholders.

## Workflow
1. Confirm understanding: state in 2-3 sentences what you're building and your planned approach
2. Wait for go-ahead from Jake
3. Build incrementally — local compose → Dockerfiles → production compose → Caddy → smoke scripts
4. After each meaningful chunk, update `STATE.md`
5. When acceptance criteria all pass:
   a. Write smoke tests in `modules/docker-deploy/smoke/` per smoke.md spec
   b. Run `./scripts/smoke-module.sh docker-deploy` — must exit 0
   c. Finalise `STATE.md`, update `MODULES.md` to ✅ Built
   d. Update `NUC_DEPLOY.md` to reference `http://dims.gocold.local` (not the scaffold's rolodex-ai.com URL)
   e. Commit, push, open PR

## Stack reminders
- Ports: frontend 5175, backend 3005, postgres 5434 (host-side for dev)
- `docker-compose.local.yml` — postgres only. Backend and frontend run locally.
- `docker-compose.yml` — all three services. Frontend built via multi-stage Dockerfile, served by nginx.
- Frontend Dockerfile: `node:22-alpine` build stage → `nginx:alpine` serve stage
- Backend Dockerfile: `node:22-alpine`, runs compiled JS (`dist/index.js`)
- Caddy config at `caddy/dims.gocold.local.caddy` — proxy to frontend container port 80
- The NUC does NOT have a Cloudflare tunnel for this project — LAN only at `http://dims.gocold.local`
- `./scripts/healthcheck-all.sh` should check `http://localhost:3005/api/health`
- `.health-endpoints` file: add `api http://localhost:3005/api/health`

## Coding standards
- No placeholder comments in Dockerfiles or Compose files
- All env vars in `.env.example` with description comments
- Smoke scripts must exit 0/1 — no ambiguous output

## Context budget
180K token ceiling. Stop and update STATE.md if approaching.

## When done
Tell Jake: "Module `docker-deploy` complete. Smoke passed. PR: <url>. Acceptance criteria met. STATE.md and MODULES.md updated. `/clear` — project ready for `/compile-stress`."
