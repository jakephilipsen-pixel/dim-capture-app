# Build prompt: sku-seed

You are building the `sku-seed` module of `dim-capture-app`.

## Read first
- This file (`modules/sku-seed/prompt.md`)
- `modules/sku-seed/brief.md` — scope and acceptance criteria
- `modules/sku-seed/smoke.md` — smoke test spec (must pass before module is ✅)
- `modules/sku-seed/STATE.md` — current state (will be empty for new builds)
- `modules/backend-core/STATE.md` — Prisma client, AppError, app exports
- `modules/cc-client/STATE.md` — CcClient interface (what methods are available)
- `DECISIONS.md` — architectural decisions already made
- `dim-capture-app-spec.md` — API route specs and CC pagination details

## Do not read
- Source code of dependency modules (use their STATE.md contracts instead)
- `node_modules/`, build artifacts, lockfiles

## Task
Build this module to satisfy every acceptance criterion in `brief.md`. Production-ready code, no placeholders.

## Workflow
1. Confirm understanding: state in 2-3 sentences what you're building and your planned approach
2. Wait for go-ahead from Jake
3. Build incrementally — implement, then test, then move on
4. After each meaningful chunk, update `STATE.md` with current exports and progress
5. When acceptance criteria all pass:
   a. Write smoke tests in `modules/sku-seed/smoke/` per smoke.md spec
   b. Run `./scripts/smoke-module.sh sku-seed` — must exit 0
   c. Finalise `STATE.md`, update `MODULES.md` to ✅ Built
   d. Commit, push, open PR

## Stack reminders
- Prisma upsert (`upsert`) for idempotent seed — never raw insert
- CC pagination: `GET /products?warehouseAccountId=&page=1&pageSize=100` — loop until last page
- `CC_WAREHOUSE_ID` env var required for seed — document in `.env.example`
- Zod for request validation on route handlers
- Tests mock both Prisma and CcClient — no real DB or CC calls in unit tests

## Coding standards
- TypeScript strict mode, no `any`
- All exports typed
- Tests use Vitest
- No console.log — use project logger

## Context budget
180K token ceiling. Stop and update STATE.md if approaching.

## When done
Tell Jake: "Module `sku-seed` complete. Smoke passed. PR: <url>. Acceptance criteria met. STATE.md and MODULES.md updated. `/clear` before next module."
