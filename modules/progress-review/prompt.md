# Build prompt: progress-review

You are building the `progress-review` module of `dim-capture-app`.

## Read first
- This file (`modules/progress-review/prompt.md`)
- `modules/progress-review/brief.md` — scope and acceptance criteria
- `modules/progress-review/smoke.md` — smoke test spec (must pass before module is ✅)
- `modules/progress-review/STATE.md` — current state (will be empty for new builds)
- `modules/frontend-scaffold/STATE.md` — router, layout, api.ts, shadcn components
- `modules/capture-page/STATE.md` — DimForm component path (for reuse in edit sheet)
- `DECISIONS.md` — architectural decisions already made
- `dim-capture-app-spec.md` — Progress and Review page specs

## Do not read
- Source code of dependency modules
- `node_modules/`, build artifacts, lockfiles

## Task
Build this module to satisfy every acceptance criterion in `brief.md`. Production-ready code, no placeholders.

## Workflow
1. Confirm understanding: state in 2-3 sentences what you're building and your planned approach
2. Wait for go-ahead from Jake
3. Build incrementally — Progress page → Review page → tests
4. After each meaningful chunk, update `STATE.md`
5. When acceptance criteria all pass:
   a. Write smoke tests in `modules/progress-review/smoke/` per smoke.md spec
   b. Run `./scripts/smoke-module.sh progress-review` — must exit 0
   c. Finalise `STATE.md`, update `MODULES.md` to ✅ Built
   d. Commit, push, open PR

## Stack reminders
- Import `DimForm` from capture-page's component path (check capture-page STATE.md for exact export path)
- For 460-row list: check scroll performance on first pass; use `react-window` if needed
- Edit sheet: shadcn `Sheet` component — slides up from bottom on mobile
- Filter state in React component state (no URL params)
- Sync Now button: calls `api.syncToCC()` then refreshes the dim list
- Tests: Vitest + @testing-library/react; mock fetch

## Coding standards
- TypeScript strict, no `any`
- All tap targets ≥ 44px
- Tests use Vitest + @testing-library/react

## Context budget
180K token ceiling. Stop and update STATE.md if approaching.

## When done
Tell Jake: "Module `progress-review` complete. Smoke passed. PR: <url>. Acceptance criteria met. STATE.md and MODULES.md updated. `/clear` before next module."
