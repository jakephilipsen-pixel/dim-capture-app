#!/usr/bin/env bash
# smoke-module.sh
# Runs smoke tests for a single module on the local Pop!_OS Docker stack.
#
# Usage: ./scripts/smoke-module.sh <module-name>

set -euo pipefail

MODULE="${1:?module name required}"

if [ ! -d "modules/$MODULE" ]; then
  echo "ERROR: modules/$MODULE not found"
  exit 1
fi

if [ ! -d "modules/$MODULE/smoke" ]; then
  echo "ERROR: modules/$MODULE/smoke/ not found - smoke tests must exist before marking module complete"
  exit 1
fi

# Prefer a module-specific compose file if it exists, fall back to the main local compose
COMPOSE_FILE="docker-compose.local.yml"
if [ -f "modules/$MODULE/docker-compose.smoke.yml" ]; then
  COMPOSE_FILE="modules/$MODULE/docker-compose.smoke.yml"
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: no compose file found ($COMPOSE_FILE)"
  exit 1
fi

cleanup() {
  echo "→ Cleaning up"
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

echo "→ Smoke test: $MODULE"
echo "→ Using compose: $COMPOSE_FILE"

echo "→ Building"
docker compose -f "$COMPOSE_FILE" build

echo "→ Starting stack"
docker compose -f "$COMPOSE_FILE" up -d

echo "→ Waiting up to 30s for boot"
BOOT_TIMEOUT=30
ELAPSED=0
until docker compose -f "$COMPOSE_FILE" ps --format json | grep -q '"State":"running"' || [ $ELAPSED -ge $BOOT_TIMEOUT ]; do
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

if [ $ELAPSED -ge $BOOT_TIMEOUT ]; then
  echo "✗ Boot timeout after ${BOOT_TIMEOUT}s"
  docker compose -f "$COMPOSE_FILE" logs --tail=50
  exit 1
fi

echo "✓ Stack running after ${ELAPSED}s"

# Health check
if [ -x "modules/$MODULE/smoke/healthcheck.sh" ]; then
  echo "→ Health check"
  if ! ./modules/$MODULE/smoke/healthcheck.sh; then
    echo "✗ Health check failed"
    docker compose -f "$COMPOSE_FILE" logs --tail=50
    exit 1
  fi
  echo "✓ Health check passed"
fi

# Happy path
if [ -x "modules/$MODULE/smoke/happy-path.sh" ]; then
  echo "→ Happy path smoke"
  if ! ./modules/$MODULE/smoke/happy-path.sh; then
    echo "✗ Happy path failed"
    docker compose -f "$COMPOSE_FILE" logs --tail=50
    exit 1
  fi
  echo "✓ Happy path passed"
fi

echo ""
echo "✓ Smoke test passed for $MODULE"
