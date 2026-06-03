#!/usr/bin/env bash
# Smoke: docker-deploy health check.
# Proves the composed stack is up two ways:
#   1. backend /api/health → 200 with db connected (direct, published port)
#   2. /api/health *through the frontend nginx* → 200 (single-origin proxy works)
# Polls each until ready (readiness), so it's safe to run right after boot.
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:3012}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5179}"
TIMEOUT="${TIMEOUT:-40}"

poll() {
  local desc="$1" url="$2" needle="$3"
  local elapsed=0 body
  echo -n "→ $desc ($url) ... "
  until body=$(curl -sf --max-time 5 "$url" 2>/dev/null) && [[ "$body" == *"$needle"* ]]; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge "$TIMEOUT" ]; then
      echo "FAIL (after ${TIMEOUT}s; last body: ${body:-<none>})"
      exit 1
    fi
  done
  echo "OK (${elapsed}s)"
}

poll "backend health (direct)"        "$BACKEND_URL/api/health"  '"db":"connected"'
poll "backend health (via frontend)"  "$FRONTEND_URL/api/health" '"db":"connected"'

echo "✓ healthcheck passed"
