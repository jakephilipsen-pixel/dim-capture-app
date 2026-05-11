# Build prompt: cc-client

You are building the `cc-client` module of `dim-capture-app`.

## Read first
- This file (`modules/cc-client/prompt.md`)
- `modules/cc-client/brief.md` — scope and acceptance criteria
- `modules/cc-client/smoke.md` — smoke test spec (must pass before module is ✅)
- `modules/cc-client/STATE.md` — current state (will be empty for new builds)
- `modules/backend-core/STATE.md` — interface contract for the backend foundation
- `DECISIONS.md` — architectural decisions already made
- `dim-capture-app-spec.md` — CartonCloud API details (base URL, auth, rate limit, endpoints)

## Do not read
- Source code of dependency modules (use their STATE.md interface contracts instead)
- `node_modules/`, build artifacts, lockfiles

## Task
Build this module to satisfy every acceptance criterion in `brief.md`. Production-ready code, no placeholders.

## Workflow
1. Confirm understanding: state in 2-3 sentences what you're building and your planned approach
2. Wait for go-ahead from Jake
3. Build incrementally — implement, then test, then move on
4. After each meaningful chunk, update `STATE.md` with current exports and progress
5. When acceptance criteria all pass:
   a. Write smoke tests in `modules/cc-client/smoke/` per smoke.md spec
   b. Run `./scripts/smoke-module.sh cc-client` — must exit 0
   c. Finalise `STATE.md`, update `MODULES.md` to ✅ Built
   f. Commit, push, open PR

## Stack reminders
- Use native `fetch` (Node 22 — no axios, no node-fetch)
- Token bucket: simple in-memory implementation, 60 tokens, refills 1/second
- CC base URL: `https://app.cartoncloud.com.au/api/v1`
- Auth: `Authorization: Bearer ${CC_API_KEY}` header on every request
- All tests mock HTTP — use `vitest` + mock `fetch` (no real CC calls ever)
- This is a service module only — no Express routes

## Coding standards
- TypeScript strict mode, no `any` without explicit justification
- All exports typed
- Errors are typed classes, not string-thrown
- Tests use Vitest
- No console.log in committed code — use the project logger from backend-core

## Context budget
This module's full build conversation should not exceed 180K tokens. If approaching that ceiling, stop and update STATE.md so we can resume cleanly.

## When done
Tell Jake: "Module `cc-client` complete. Smoke passed. PR: <url>. Acceptance criteria met. STATE.md and MODULES.md updated. `/clear` before next module."
