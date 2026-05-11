# Build prompt: backend-core

You are building the `backend-core` module of `dim-capture-app`.

## Read first
- This file (`modules/backend-core/prompt.md`)
- `modules/backend-core/brief.md` — scope and acceptance criteria
- `modules/backend-core/smoke.md` — smoke test spec (must pass before module is ✅)
- `modules/backend-core/STATE.md` — current state (will be empty for new builds)
- `DECISIONS.md` — architectural decisions already made
- `dim-capture-app-spec.md` — the full product spec (reference for schema details)

## Do not read
- Source code of dependency modules
- `node_modules/`, build artifacts, lockfiles

## Task
Build this module to satisfy every acceptance criterion in `brief.md`. Production-ready code, no placeholders.

## Workflow
1. Confirm understanding: state in 2-3 sentences what you're building and your planned approach
2. Wait for go-ahead from Jake
3. Build incrementally — implement, then test, then move on. Don't write 500 lines then run tests.
4. After each meaningful chunk, update `STATE.md` with current exports and progress
5. When acceptance criteria all pass:
   a. Write smoke tests in `modules/backend-core/smoke/` per smoke.md spec
   b. Run `./scripts/smoke-module.sh backend-core` — must exit 0
   c. If smoke fails, fix on this same branch — do not mark module complete
   d. Finalise `STATE.md` with full interface contract + quirks
   e. Update `MODULES.md` row to ✅ Built
   f. Commit, push, open PR

## Stack reminders
- Node 22 (nvm), TypeScript strict, `ts-node-dev` for dev server
- Express 4.x — no magic frameworks
- Prisma 5.x — `prisma generate` after schema changes, `prisma migrate dev` for migrations
- Dev DB: `docker compose -f docker-compose.local.yml up -d postgres` (port 5434)
- `DATABASE_URL=postgresql://gocold:gocold@localhost:5434/dimcapture` for local dev
- Backend runs on port 3005

## Coding standards
- TypeScript strict mode, no `any` without explicit justification
- All exports typed
- Errors are typed, not string-thrown — use `AppError` class
- Tests use Vitest
- No console.log in committed code — use a simple logger (e.g. `pino` or a thin wrapper)
- Match existing code style (run linter before commit)

## Context budget
This module's full build conversation should not exceed 180K tokens. If approaching that ceiling, stop and update STATE.md so we can resume cleanly.

## When done
Tell Jake: "Module `backend-core` complete. Smoke passed. PR: <url>. Acceptance criteria met. STATE.md and MODULES.md updated. `/clear` before next module."
