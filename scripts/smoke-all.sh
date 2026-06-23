#!/usr/bin/env bash
# smoke-all.sh
# Runs every module's smoke test via scripts/smoke-module.sh. Each module boots
# its OWN hermetic stack (real backend container + throwaway Postgres + the
# in-container mock CartonCloud) and tears it down — so this does NOT require the
# docker-compose.local.yml gate stack to be up, and it never touches live CC.
#
# Usage: ./scripts/smoke-all.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon not running"
  exit 1
fi

PASSED=()
FAILED=()

for module_dir in modules/*/; do
  MODULE=$(basename "$module_dir")

  if [ ! -d "$module_dir/smoke" ]; then
    echo "⚠ $MODULE has no smoke/ directory - skipping"
    continue
  fi

  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "→ Smoke: $MODULE"
  echo "════════════════════════════════════════════════════════════"

  if ./scripts/smoke-module.sh "$MODULE"; then
    PASSED+=("$MODULE")
  else
    echo "✗ $MODULE smoke failed"
    FAILED+=("$MODULE")
  fi
done

echo ""
echo "════════════════════════════════════════════════════════════"
echo "Smoke summary: ${#PASSED[@]} passed, ${#FAILED[@]} failed"
[ ${#PASSED[@]} -gt 0 ] && echo "  passed: ${PASSED[*]}"
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "✓ All module smoke tests passed"
  exit 0
else
  echo "✗ Failed: ${FAILED[*]}"
  exit 1
fi
