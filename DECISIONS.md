# Architectural Decisions

Append-only log of decisions made during planning and module builds. Once written, decisions are binding for all future work on this project unless explicitly revisited.

Format: `YYYY-MM-DD | Decision | Rationale | Made during`

## Decisions

| Date | Decision | Rationale | Context |
|------|----------|-----------|---------|
| 2026-05-11 | Stack: React 19 + TS + Vite + Tailwind + shadcn/ui / Node Express + TS / PostgreSQL 16 + Prisma / Docker Compose | Project default | Initial scaffold |
| 2026-05-11 | Deployment: NUC via Docker Compose + Caddy at dim-capture-app.rolodex-ai.com | Project default | Initial scaffold |
| 2026-06-03 | Prisma generator `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` + `apk add --no-cache openssl` in every Dockerfile stage that runs prisma | On node:22-alpine the Prisma schema/query engine defaults to libssl-1.1 and fails to load ("Could not parse schema engine response"), crashing `migrate deploy` so the server never starts | backend-core build — applies to all backend modules (02–04) sharing this container |

## How to add a decision
When working on a module and a non-trivial choice comes up (library, pattern, schema shape, naming convention that will repeat), append a row here before continuing. This prevents re-litigating the same question in every future module conversation.
