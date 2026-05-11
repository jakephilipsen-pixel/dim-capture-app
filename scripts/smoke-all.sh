#!/usr/bin/env bash
# smoke-all.sh
# Runs every module's smoke tests against the running full local stack.
# Assumes docker-compose.local.yml is already up.
#
# Usage: ./scripts/smoke-all.sh

set -euo pipefail

if ! docker compose -f docker-compose.local.yml ps --format json | grep -q '"State":"running"'; then
  echo "ERROR: local stack not running. Start it with: docker compose -f docker-compose.local.yml up -d"
  exit 1
fi

FAILED=()

for module_dir in modules/*/; do
  MODULE=$(basename "$module_dir")

  if [ ! -d "$module_dir/smoke" ]; then
    echo "⚠ $MODULE has no smoke/ directory - skipping"
    continue
  fi

  echo "→ Smoke: $MODULE"

  if [ -x "$module_dir/smoke/healthcheck.sh" ]; then
    if ! "$module_dir/smoke/healthcheck.sh"; then
      echo "✗ $MODULE healthcheck failed"
      FAILED+=("$MODULE/healthcheck")
      continue
    fi
  fi

  if [ -x "$module_dir/smoke/happy-path.sh" ]; then
    if ! "$module_dir/smoke/happy-path.sh"; then
      echo "✗ $MODULE happy-path failed"
      FAILED+=("$MODULE/happy-path")
      continue
    fi
  fi

  echo "✓ $MODULE"
done

echo ""
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "✓ All module smoke tests passed"
  exit 0
else
  echo "✗ Failed: ${FAILED[*]}"
  exit 1
fi
