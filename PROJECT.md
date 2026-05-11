# dim-capture-app

> Carton Dimension Capture PWA for Go Cold — scan barcodes, enter L×W×H + weight, sync to CartonCloud

## Stack
React 19 + TS + Vite + Tailwind + shadcn/ui / Node Express + TS / PostgreSQL 16 + Prisma / Docker Compose

## Deployment
- **Target:** nuc
- **Production URL:** https://dim-capture-app.rolodex-ai.com
- **Details:** NUC via Docker Compose + Caddy at dim-capture-app.rolodex-ai.com

## Repo
- GitHub: https://github.com/jakephilipsen-pixel/dim-capture-app
- Visibility: private
- Created: 2026-05-11

## Status
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
