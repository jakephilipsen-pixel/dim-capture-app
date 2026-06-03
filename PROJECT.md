# dim-capture-app

> Carton Dimension Capture PWA for Go Cold — scan barcodes, enter L×W×H + weight, sync to CartonCloud

## Stack
React 19 + TS + Vite + Tailwind + shadcn/ui / Node Express + TS / PostgreSQL 16 + Prisma / Docker Compose

## Deployment
- **Target:** nuc
- **Production URL:** http://dims.gocold.local (LAN-only — no Cloudflare tunnel)
- **Details:** NUC via Docker Compose + Caddy at dims.gocold.local (warehouse LAN only)

## Repo
- GitHub: https://github.com/jakephilipsen-pixel/dim-capture-app
- Visibility: private
- Created: 2026-05-11

## Status
- **2026-06-04:** Modules 01–08 ✅ built. `/compile-stress` run — integration GREEN
  (72/72 backend + 41/41 frontend), Critical **C1 fixed** (concurrent CC-sync double-PATCH).
  **NOT yet a production candidate / not tagged** — security hardening modules 09 / 11 / 12
  must land before prod (Jake's sign-off call). See [STRESS_TEST_RESULTS.md](./STRESS_TEST_RESULTS.md)
  + [KNOWN_ISSUES.md](./KNOWN_ISSUES.md).
- [MODULES.md](./MODULES.md) — module-by-module status
- [DECISIONS.md](./DECISIONS.md) — architectural decisions
- [LOCAL_DEPLOY.md](./LOCAL_DEPLOY.md) — local deploy gate
- [CLOUDFLARE_DEPLOY.md / NUC_DEPLOY.md](./) — production deploy procedure (depends on target)

## Local development

The local dev mechanics depend on this project's deploy target (nuc). See `LOCAL_DEPLOY.md` for the full validation flow.

Quick start:
```bash
git clone https://github.com/jakephilipsen-pixel/dim-capture-app
cd dim-capture-app
# For Cloudflare projects:
#   wrangler dev --local
# For NUC projects:
#   docker compose -f docker-compose.local.yml up -d
```

## Required secrets

Document any secrets the project needs here as they're added during module builds. Examples:
- `ANTHROPIC_API_KEY` — for Vision API calls
- `DATABASE_URL` — connection string (NUC projects)
- `CLOUDFLARE_API_TOKEN` — for deploys (Cloudflare projects, set via `wrangler secret`)

## Working on this project

Open Claude Code in this directory. The framework will detect the existing repo and ask which module to work on.

```bash
cd ~/projects/dim-capture-app
claude
```

Or use slash commands directly:
- `/build-module <name>` — start a new module
- `/resume-module <name>` — pick up where a previous conversation left off
- `/add-module <name>` — register a new module mid-project
- `/compile-stress` — integration + stress test phase
- `/deploy-local` — local deploy gate (must pass before production)
- `/deploy-prod` — gated push to production (routes to Cloudflare or NUC based on deploy target)
