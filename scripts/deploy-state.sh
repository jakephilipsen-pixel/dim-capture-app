#!/usr/bin/env bash
# deploy-state.sh
# Reads or writes .deploy-state JSON.
#
# Usage:
#   ./scripts/deploy-state.sh get <key>
#   ./scripts/deploy-state.sh set-target <cloudflare|nuc>
#   ./scripts/deploy-state.sh set-local-validated
#   ./scripts/deploy-state.sh set-prod-deployed <url>
#   ./scripts/deploy-state.sh check-prod-allowed
#   ./scripts/deploy-state.sh init <cloudflare|nuc>
#
# Backwards-compat aliases:
#   set-nuc-deployed <url>  → calls set-prod-deployed
#   check-nuc-allowed       → calls check-prod-allowed

set -euo pipefail

STATE_FILE=".deploy-state"

ensure_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq required (apt install jq)"
    exit 1
  fi
}

cmd_init() {
  local target="${1:?target required (cloudflare or nuc)}"
  if [ "$target" != "cloudflare" ] && [ "$target" != "nuc" ]; then
    echo "ERROR: target must be 'cloudflare' or 'nuc'"
    exit 1
  fi
  cat > "$STATE_FILE" <<EOF
{
  "deploy_target": "$target",
  "local_validated": false,
  "validated_at": null,
  "git_sha": null,
  "prod_deployed": false,
  "prod_deployed_at": null,
  "prod_url": null
}
EOF
  echo "✓ Initialized .deploy-state for target: $target"
}

cmd_get() {
  ensure_jq
  local key="$1"
  if [ ! -f "$STATE_FILE" ]; then
    echo "null"
    return
  fi
  jq -r ".$key // \"null\"" "$STATE_FILE"
}

cmd_set_target() {
  ensure_jq
  local target="${1:?target required}"
  if [ "$target" != "cloudflare" ] && [ "$target" != "nuc" ]; then
    echo "ERROR: target must be 'cloudflare' or 'nuc'"
    exit 1
  fi
  if [ ! -f "$STATE_FILE" ]; then
    cmd_init "$target"
    return
  fi
  jq --arg t "$target" '.deploy_target = $t' "$STATE_FILE" > "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
  echo "✓ Deploy target set to: $target"
}

cmd_set_local_validated() {
  ensure_jq
  local sha
  sha=$(git rev-parse HEAD)
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  if [ ! -f "$STATE_FILE" ]; then
    echo "ERROR: no .deploy-state. Run: ./scripts/deploy-state.sh init <cloudflare|nuc>"
    exit 1
  fi

  jq --arg sha "$sha" --arg now "$now" \
    '.local_validated = true | .validated_at = $now | .git_sha = $sha' \
    "$STATE_FILE" > "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
  echo "✓ Local validated for SHA $sha"
}

cmd_set_prod_deployed() {
  ensure_jq
  local url="${1:-null}"
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local sha
  sha=$(git rev-parse HEAD)

  if [ ! -f "$STATE_FILE" ]; then
    echo "ERROR: no .deploy-state - run /deploy-local first"
    exit 1
  fi

  jq --arg now "$now" --arg url "$url" --arg sha "$sha" \
    '.prod_deployed = true | .prod_deployed_at = $now | .prod_url = $url | .prod_sha = $sha' \
    "$STATE_FILE" > "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
  echo "✓ Production deployed at $url ($sha)"
}

cmd_check_prod_allowed() {
  ensure_jq

  if [ ! -f "$STATE_FILE" ]; then
    echo "BLOCKED: no .deploy-state - run /deploy-local first"
    exit 1
  fi

  local validated
  validated=$(jq -r '.local_validated' "$STATE_FILE")
  if [ "$validated" != "true" ]; then
    echo "BLOCKED: local_validated is not true - run /deploy-local"
    exit 1
  fi

  local validated_sha current_sha
  validated_sha=$(jq -r '.git_sha' "$STATE_FILE")
  current_sha=$(git rev-parse HEAD)
  if [ "$validated_sha" != "$current_sha" ]; then
    # The /deploy-local sign-off writes .deploy-state and commits it, which moves
    # HEAD one commit past the validated SHA. That marker commit is part of the
    # validation itself, not real code drift, so accept it iff:
    #   HEAD~1 == validated_sha  AND  HEAD only modifies .deploy-state.
    local parent_sha changed
    parent_sha=$(git rev-parse HEAD~1 2>/dev/null || echo "")
    if [ "$parent_sha" = "$validated_sha" ]; then
      changed=$(git diff HEAD~1 HEAD --name-only)
      if [ "$changed" != ".deploy-state" ]; then
        echo "BLOCKED: real code drift since validation."
        echo "  validated SHA: $validated_sha"
        echo "  current HEAD:  $current_sha"
        echo "  files changed since validation:"
        echo "$changed" | sed 's/^/    /'
        echo "Re-run /deploy-local to validate the new HEAD."
        exit 1
      fi
      # Validation-drift only (marker commit) — accept and continue.
    else
      echo "BLOCKED: HEAD has diverged from validation by more than the deploy-state marker commit."
      echo "  validated SHA: $validated_sha"
      echo "  current HEAD:  $current_sha"
      echo "  HEAD~1:        ${parent_sha:-<none>}"
      echo "Re-run /deploy-local to validate the new HEAD."
      exit 1
    fi
  fi

  if [ -n "$(git status --porcelain)" ]; then
    echo "BLOCKED: working tree dirty"
    exit 1
  fi

  local branch
  branch=$(git rev-parse --abbrev-ref HEAD)
  if [ "$branch" != "main" ]; then
    echo "BLOCKED: not on main (current: $branch)"
    exit 1
  fi

  local target
  target=$(jq -r '.deploy_target' "$STATE_FILE")
  echo "OK: production deploy allowed for SHA $current_sha (target: $target)"
}

case "${1:-}" in
  init) cmd_init "${2:-}" ;;
  get) cmd_get "${2:?key required}" ;;
  set-target) cmd_set_target "${2:-}" ;;
  set-local-validated) cmd_set_local_validated ;;
  set-prod-deployed) cmd_set_prod_deployed "${2:-}" ;;
  set-nuc-deployed) cmd_set_prod_deployed "${2:-}" ;;  # backwards-compat alias
  check-prod-allowed) cmd_check_prod_allowed ;;
  check-nuc-allowed) cmd_check_prod_allowed ;;        # backwards-compat alias
  *)
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  init <cloudflare|nuc>     Initialize state file with target"
    echo "  get <key>                 Read a key from state"
    echo "  set-target <target>       Change deploy target"
    echo "  set-local-validated       Mark local validation passed (uses current git SHA)"
    echo "  set-prod-deployed <url>   Mark production deploy complete"
    echo "  check-prod-allowed        Verify all gates pass before prod deploy"
    exit 1
    ;;
esac
