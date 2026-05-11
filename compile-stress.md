# Compile + Stress Test Phase

Final phase. Run after all modules in MODULES.md show ✅ Built.

## Read first
- `PROJECT.md`
- `MODULES.md` (all rows should be ✅)
- Every module's `STATE.md` (interface contracts and quirks only — NOT source)
- `DECISIONS.md`

## Do not read
- Module source code in this orchestrating conversation. Source is read by spawned subagents that have their own context windows.

## Phase 1: Integration

1. Verify all modules' declared dependencies match what's in MODULES.md
2. Run the full build: `docker compose build`
3. Boot the stack: `docker compose up -d`
4. Health-check every service exposed by any module (per their STATE.md)
5. Run the project's full test suite
6. If anything fails, identify which module's STATE.md misrepresented its interface — that module gets a 🔧 Needs revision flag and a `fix/<name>` branch

## Phase 2: Stress test (subagents)

Spawn parallel subagents via the Task tool. Each subagent gets a focused brief and its own context window — they don't bloat this conversation.

Suggested stress test agents:

1. **Load agent** — concurrent requests against public endpoints, ramp until breaking point
2. **Edge case agent** — malformed inputs, boundary values, encoding attacks against every input surface
3. **Failure injection agent** — kill dependent services mid-request, network partitions, disk full, OOM
4. **Auth agent** — privilege escalation attempts, token replay, session fixation if applicable
5. **Data integrity agent** — concurrent writes, transaction boundaries, idempotency

Each subagent returns: pass/fail + findings list. Aggregate findings into `STRESS_TEST_RESULTS.md` at project root.

## Phase 3: Triage

For each finding:
- **Critical** → create `fix/<module>` branch, address before declaring project complete
- **Significant** → log as new module in MODULES.md (e.g., `rate-limiting`, `audit-logging`)
- **Minor** → log in `KNOWN_ISSUES.md` with severity and reproduction

## Phase 4: Sign-off

When all critical findings resolved:
1. Tag release in git: `v0.1.0`
2. Update `PROJECT.md` status to "Production candidate"
3. Tell Jake: "Compile + stress complete. Findings in STRESS_TEST_RESULTS.md. Tagged v0.1.0. Next: `/clear` and `/deploy-local` to run the local validation gate."

## Context discipline

This phase tends to bloat fast because of the integration scope. Hard rules:
- Subagents do the heavy lifting — keep this conversation as orchestrator only
- If approaching 70% context, write current state to `COMPILE_STATE.md`, /clear, resume
- Findings go in markdown files, not in the conversation
