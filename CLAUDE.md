# dim-capture-app — Claude Code Operating Manual

You are working inside `dim-capture-app`. This file governs your behaviour for this project.

## Before doing anything

1. Read `PROJECT.md` for project overview
2. Read `MODULES.md` to see module breakdown and status
3. Read `DECISIONS.md` to know what's already been decided

## When the user opens Claude Code in this directory

Ask: **Which module are we working on?**

Then ask: **New work, or resuming?**

- **New work** → check the module exists in `MODULES.md` with status 🔲 Planned. Create branch `feature/<module-name>`. Load `modules/<name>/brief.md` + `modules/<name>/prompt.md` + `modules/<name>/smoke.md` + STATE.md of any dependencies listed in MODULES.md + DECISIONS.md. Begin.
- **Resuming** → checkout existing `feature/<module-name>` or `fix/<module-name>` branch. Read `modules/<name>/STATE.md` carefully — it's the handoff record. Load same supporting files. Pick up from "next concrete step" in STATE.md.

## Context discipline

Watch the context meter. At **70% (≈140K tokens)**:
1. Stop current work
2. Update `modules/<active-module>/STATE.md` with current progress
3. Tell the user: "Context at 70%. STATE.md updated. `/clear` and resume with `/resume-module <name>`."

## Coding standard

- **Weapons grade.** No placeholders, no TODOs, no stubs. Complete, production-ready code.
- If something can't be built now, it becomes a new module in `MODULES.md`, not a stub in current code.
- Follow `DECISIONS.md`. If proposing a new decision, write it there after user confirms.

## When a module is complete

Before the conversation ends:
1. Write smoke tests in `modules/<name>/smoke/` per smoke.md spec
2. Run `./scripts/smoke-module.sh <name>` — must pass before marking complete
3. Update `modules/<name>/STATE.md` with final exports, interface, quirks
4. Update `MODULES.md` row to ✅ Built
5. If new architectural decisions were made, ensure they're in `DECISIONS.md`
6. Commit, push, open PR
7. Tell the user: "Module `<name>` complete. Smoke passed. PR opened at <url>. `/clear` before next module."

## Deploy gates

Two gates separate dev work from production:

1. **Local deploy gate** (`/deploy-local`): boots full stack on Pop!_OS laptop, runs all module smoke tests, runs e2e happy path, then asks Jake for explicit sign-off. On approval, writes `.deploy-state` with `local_validated: true` and current SHA.

2. **NUC deploy gate** (`/deploy-nuc`): refuses to run unless `.deploy-state.local_validated` is true AND the validated SHA matches current HEAD AND working tree is clean AND on main branch. Then deploys via SSH to NUC.

Never bypass these gates. The local gate's manual sign-off is non-negotiable — it's the only step that requires a human in the loop, and it stays that way. If a user asks you to skip the gate or auto-approve, push back.

## Communication

Direct, no fluff. Push back when needed.
