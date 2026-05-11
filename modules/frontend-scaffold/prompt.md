# Build prompt: frontend-scaffold

You are building the `frontend-scaffold` module of `dim-capture-app`.

## Read first
- This file (`modules/frontend-scaffold/prompt.md`)
- `modules/frontend-scaffold/brief.md` — scope and acceptance criteria
- `modules/frontend-scaffold/smoke.md` — smoke test spec (must pass before module is ✅)
- `modules/frontend-scaffold/STATE.md` — current state (will be empty for new builds)
- `modules/backend-core/STATE.md` — health endpoint shape, port
- `DECISIONS.md` — architectural decisions already made
- `dim-capture-app-spec.md` — frontend structure, PWA requirements, API route shapes

## Do not read
- Source code of dependency modules
- `node_modules/`, build artifacts, lockfiles

## Task
Build this module to satisfy every acceptance criterion in `brief.md`. Production-ready code, no placeholders.

## Workflow
1. Confirm understanding: state in 2-3 sentences what you're building and your planned approach
2. Wait for go-ahead from Jake
3. Build incrementally — scaffold → Tailwind/shadcn → router → layout → lib → components → tests
4. After each meaningful chunk, update `STATE.md`
5. When acceptance criteria all pass:
   a. Write smoke tests in `modules/frontend-scaffold/smoke/` per smoke.md spec
   b. Run `./scripts/smoke-module.sh frontend-scaffold` — must exit 0
   c. Finalise `STATE.md`, update `MODULES.md` to ✅ Built
   d. Commit, push, open PR

## Stack reminders
- Vite 5 + React 19 + TypeScript strict
- Tailwind CSS v4 (preferred) or v3 — check latest available
- shadcn/ui: `npx shadcn@latest init` — install components as needed (Button, Input, Badge, Card, Sheet)
- `vite-plugin-pwa` with `generateSW` strategy for service worker
- React Router v6 (`createBrowserRouter`)
- Frontend runs on port 5175; `VITE_API_URL` env var (default `http://localhost:3005`)
- `lib/api.ts` uses native `fetch` — typed return values, throws on non-2xx
- Tests use Vitest + `@testing-library/react` for component tests; pure unit tests for lib/units.ts

## Coding standards
- TypeScript strict mode, no `any`
- All exported functions and types typed
- Tests use Vitest
- No console.log in committed code

## Context budget
180K token ceiling. Stop and update STATE.md if approaching.

## When done
Tell Jake: "Module `frontend-scaffold` complete. Smoke passed. PR: <url>. Acceptance criteria met. STATE.md and MODULES.md updated. `/clear` before next module."
