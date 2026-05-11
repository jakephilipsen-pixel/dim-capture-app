# Local Deploy

Final local validation gate. Must pass before `/deploy-prod` (or `/deploy-nuc`) is allowed to run.

The local validation flow is the same conceptually regardless of deploy target — boot the stack on Pop!_OS, validate it works, manual sign-off. The mechanics differ slightly between Cloudflare-targeted projects (use `wrangler dev` / `miniflare`) and Docker-targeted projects (use `docker compose`).

## Pre-flight
- All modules in MODULES.md show ✅ Built
- Compile + stress phase complete (`STRESS_TEST_RESULTS.md` exists, no critical findings open)
- On Pop!_OS laptop
- For Docker projects: Docker daemon running, no services on conflicting ports
- For Cloudflare projects: `wrangler` CLI installed, `wrangler whoami` succeeds

## Stages

### Stage 1: Boot

**For Cloudflare projects:**
```bash
# Start local D1, R2 emulation, and Worker
wrangler dev --local --persist-to=.wrangler/state &
WRANGLER_PID=$!

# If there's a separate Pages frontend, start it too
npm run dev:pages &
PAGES_PID=$!
```

**For Docker projects:**
```bash
docker compose -f docker-compose.local.yml down -v
docker compose -f docker-compose.local.yml build
docker compose -f docker-compose.local.yml up -d
```

Acceptance: stack reaches running state within 60s. For Cloudflare, `wrangler dev` reports "Ready on http://localhost:8787" (or whichever port).

### Stage 2: Health checks
```bash
./scripts/healthcheck-all.sh
```

Acceptance: every health check returns 200 within 30s of boot completion.

### Stage 3: Smoke tests
Run every module's smoke test against the running stack:
```bash
./scripts/smoke-all.sh
```

Acceptance: all module smoke tests pass.

### Stage 4: End-to-end happy path
Exercise the realistic primary user flow against the local stack. Defined per project in `e2e/happy-path.sh`.

Acceptance: e2e completes without errors.

### Stage 5: Manual sign-off
**This stage cannot be automated. Jake reviews the running local stack and explicitly approves.**

Claude presents a sign-off summary:
- All services up: yes/no
- All health checks passing: yes/no
- All smoke tests passing: yes/no
- E2E happy path: pass/fail
- Logs reviewed for warnings: yes/no
- URL to access local stack: `http://localhost:<port>`

Then asks: **"Local deploy complete. Reviewed and approve push to production? (yes / no / fix)"**

- **yes** → write `.deploy-state` with `{"local_validated": true, "validated_at": "<iso>", "git_sha": "<sha>"}` and tell Jake the production deploy command is now unlocked
- **no** → abort, do not write deploy-state, ask what's wrong
- **fix** → tear down local, return to module fix workflow

## State tracking

`.deploy-state` at project root tracks deploy gates:
```json
{
  "local_validated": true,
  "validated_at": "2026-04-29T12:00:00Z",
  "git_sha": "abc123",
  "prod_deployed": false,
  "prod_deployed_at": null,
  "prod_url": null,
  "deploy_target": "cloudflare"
}
```

The production deploy command (`/deploy-prod` for Cloudflare, `/deploy-nuc` for NUC) reads this file. If `local_validated` is false OR `git_sha` doesn't match current HEAD, it refuses to run.

## Why this gate exists

Production environments — whether Cloudflare or the NUC — should never see code that hasn't been validated locally. Local-first validation catches the common breakage patterns (missing env vars, broken dependency contracts, misconfigured bindings, container build failures) on a machine where breakage is cheap.

This gate is non-negotiable. There is no `--force` flag.
