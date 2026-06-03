# NUC Deploy

Production deploy to the NUC at Go Cold. **Locked behind `LOCAL_DEPLOY.md` validation.**

## Pre-flight (enforced by `/deploy-nuc`)

The slash command refuses to run unless ALL of these are true:

1. `.deploy-state` exists at project root
2. `.deploy-state.local_validated` is `true`
3. `.deploy-state.git_sha` matches current `git rev-parse HEAD`
4. Working tree is clean (`git status` shows nothing)
5. Current branch is `main`
6. SSH connection to `nuc` works

If any check fails: stop, tell Jake what failed, do nothing else.

## Stages

### Stage 1: Pre-deploy snapshot
```bash
ssh nuc "cd /opt/dim-capture-app 2>/dev/null && docker compose ps" || echo "(first deploy, no existing instance)"
ssh nuc "test -d /opt/dim-capture-app/backups && ls -1 /opt/dim-capture-app/backups | tail -3" || true
```

Acceptance: capture current state for rollback reference. First-time deploys skip this.

### Stage 2: Sync
```bash
# If first deploy, clone the repo on the NUC
ssh nuc "test -d /opt/dim-capture-app || (cd /opt && git clone https://github.com/jakephilipsen-pixel/dim-capture-app.git)"

# Pull latest
ssh nuc "cd /opt/dim-capture-app && git fetch --all && git checkout main && git pull --ff-only"

# Verify SHA matches local
REMOTE_SHA=$(ssh nuc "cd /opt/dim-capture-app && git rev-parse HEAD")
LOCAL_SHA=$(git rev-parse HEAD)
[ "$REMOTE_SHA" = "$LOCAL_SHA" ] || { echo "SHA mismatch — abort"; exit 1; }
```

### Stage 3: Build on NUC
```bash
ssh nuc "cd /opt/dim-capture-app && docker compose -f docker-compose.yml build"
```

Acceptance: build completes without errors.

### Stage 4: Deploy with zero-downtime where possible
```bash
# For stateless services: rolling restart
ssh nuc "cd /opt/dim-capture-app && docker compose -f docker-compose.yml up -d --remove-orphans"

# For services needing migration: run migrations first
ssh nuc "cd /opt/dim-capture-app && docker compose -f docker-compose.yml run --rm <migration-service>"
```

### Stage 5: Caddy reverse proxy registration
This project is LAN-only at `http://dims.gocold.local` (no Cloudflare tunnel, no
public subdomain). Caddy runs on the NUC host and proxies to the published
frontend port (5175 → frontend container :80); the frontend's nginx then proxies
`/api/*` to the backend, so this one fragment covers the whole app (single origin).

First deploy — install the fragment and ensure the main Caddyfile imports it:
```bash
# Copy the repo's fragment into Caddy's drop-in dir
ssh nuc "sudo cp /opt/dim-capture-app/caddy/dims.gocold.local.caddy /etc/caddy/Caddyfile.d/"
# Confirm the main Caddyfile imports the drop-in dir (one-time):
ssh nuc "grep -q 'import /etc/caddy/Caddyfile.d/\*' /etc/caddy/Caddyfile || echo 'ADD: import /etc/caddy/Caddyfile.d/*'"
ssh nuc "caddy validate --config /etc/caddy/Caddyfile"
ssh nuc "sudo systemctl reload caddy"
```

Subsequent deploys — verify it's present and reload:
```bash
ssh nuc "cat /etc/caddy/Caddyfile.d/dims.gocold.local.caddy"  # verify exists
ssh nuc "sudo systemctl reload caddy"
```

**One-time network setup (not automated):** local DNS must resolve
`dims.gocold.local` → the NUC's LAN IP. Add a DNS override on the warehouse router
(DHCP static host) or in `dnsmasq` (`address=/dims.gocold.local/<NUC-IP>`). Until
this exists, the app is reachable only via the NUC IP directly.

### Stage 6: Post-deploy health check
```bash
# Wait for services to settle
sleep 15

# Run same healthcheck-all.sh against NUC URL instead of localhost
NUC_URL=http://dims.gocold.local ./scripts/healthcheck-all.sh
```

Acceptance: every health endpoint returns 200.

### Stage 7: Smoke test against production
Run a subset of smoke tests against the deployed instance — read-only operations only, NO writes that could pollute production data:
```bash
NUC_URL=http://dims.gocold.local ./scripts/smoke-prod-readonly.sh
```

### Stage 8: Update deploy state
On success, update `.deploy-state`:
```json
{
  "local_validated": true,
  "validated_at": "...",
  "git_sha": "<sha>",
  "nuc_deployed": true,
  "nuc_deployed_at": "<iso-now>",
  "nuc_url": "http://dims.gocold.local"
}
```

Commit the `.deploy-state` change to main: `chore: deploy <sha> to NUC`.

### Stage 9: Notify
Tell Jake:
> Deployed `dim-capture-app` SHA `<sha>` to NUC. Live at http://dims.gocold.local. All health checks green. Read-only smoke tests passed.

## Rollback

If post-deploy health check fails:
```bash
ssh nuc "cd /opt/dim-capture-app && git reset --hard <previous-sha> && docker compose up -d"
```

Then mark `.deploy-state.nuc_deployed = false` and tell Jake the rollback occurred and why.

## What this does NOT do

- Schema migrations beyond what's defined in the project's migration service
- Secrets management — env files on NUC are managed manually, deploy assumes they're correct
- Backup of NUC databases — that's a separate scheduled job, not deploy's responsibility
