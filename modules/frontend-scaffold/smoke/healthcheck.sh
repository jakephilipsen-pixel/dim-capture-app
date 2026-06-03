#!/usr/bin/env bash
# Health check for frontend-scaffold (module 05).
# Polls the nginx static server until the app shell responds 200.
set -euo pipefail

PORT="${FRONTEND_SMOKE_PORT:-5176}"
URL="http://localhost:${PORT}/"

echo "→ Polling ${URL} for 200"
for i in $(seq 1 20); do
  if curl -sf "$URL" -o /dev/null; then
    echo "✓ Shell responded 200"
    exit 0
  fi
  sleep 1
done

echo "✗ Shell did not return 200 within 20s"
exit 1
