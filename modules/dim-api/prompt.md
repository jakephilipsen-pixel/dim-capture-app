# Build prompt: dim-api

You are building the `dim-api` module of `dim-capture-app`.

## Read first
- This file (`modules/dim-api/prompt.md`)
- `modules/dim-api/brief.md` — scope and acceptance criteria
- `modules/dim-api/smoke.md` — smoke test spec (must pass before module is ✅)
- `modules/dim-api/STATE.md` — current state (will be empty for new builds)
- `modules/backend-core/STATE.md` — Prisma client, AppError, app exports
- `modules/cc-client/STATE.md` — CcClient.patchProductDims interface
- `DECISIONS.md` — architectural decisions already made
- `dim-capture-app-spec.md` — API route specs for /api/dims and /api/sync/cc

## Do not read
- Source code of dependency modules
- `node_modules/`, build artifacts, lockfiles

## Task
Build this module to satisfy every acceptance criterion in `brief.md`. Production-ready code, no placeholders.

## Workflow
1. Confirm understanding: state in 2-3 sentences what you're building and your planned approach
2. Wait for go-ahead from Jake
3. Build incrementally — routes first, then syncService, then tests
4. After each meaningful chunk, update `STATE.md`
5. When acceptance criteria all pass:
   a. Write smoke tests in `modules/dim-api/smoke/` per smoke.md spec
   b. Run `./scripts/smoke-module.sh dim-api` — must exit 0
   c. Finalise `STATE.md`, update `MODULES.md` to ✅ Built
   d. Commit, push, open PR

## Stack reminders
- Zod for all request body validation (add to backend package.json if not already present)
- syncService MUST NOT throw on individual CC failures — catch per-item, log, continue
- Batch size is exactly 10 — process in chunks, not one at a time
- `PUT /api/dims/:id` resets `syncedToCC = false` and `syncedAt = null` unconditionally
- Tests mock Prisma and CcClient — no real DB or CC calls in unit tests

## Coding standards
- TypeScript strict mode, no `any`
- All exports typed (SyncReport interface must be exported)
- Tests use Vitest
- No console.log — use project logger

## Context budget
180K token ceiling. Stop and update STATE.md if approaching.

## When done
Tell Jake: "Module `dim-api` complete. Smoke passed. PR: <url>. Acceptance criteria met. STATE.md and MODULES.md updated. `/clear` before next module."
