#!/usr/bin/env bash
# Smoke: capture-page health check. The page needs both its backend dependency
# (DB connected) and its own static server up. Polls both until ready.
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:3010}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5177}"
ATTEMPTS="${ATTEMPTS:-40}"

backend_ok=0
frontend_ok=0
for i in $(seq 1 "$ATTEMPTS"); do
  if [ "$backend_ok" -eq 0 ] && curl -sf "$BACKEND_URL/api/health" 2>/dev/null | grep -q '"db":"connected"'; then
    echo "✓ backend healthy after ${i}s"
    backend_ok=1
  fi
  if [ "$frontend_ok" -eq 0 ] && curl -sf "$FRONTEND_URL/" -o /dev/null 2>/dev/null; then
    echo "✓ frontend serving after ${i}s"
    frontend_ok=1
  fi
  if [ "$backend_ok" -eq 1 ] && [ "$frontend_ok" -eq 1 ]; then
    echo "PASS: backend + frontend ready"
    exit 0
  fi
  sleep 1
done

echo "FAIL: not ready within ${ATTEMPTS}s (backend=$backend_ok frontend=$frontend_ok)"
curl -s "$BACKEND_URL/api/health" || true
exit 1
