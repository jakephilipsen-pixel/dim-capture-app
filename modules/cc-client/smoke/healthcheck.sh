#!/usr/bin/env bash
# Health check for cc-client smoke server.
# Polls /smoke/health until the boot self-test reports ok (200), or times out.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3007}"
ATTEMPTS=20

for i in $(seq 1 "$ATTEMPTS"); do
  if curl -sf "$BASE_URL/smoke/health" | grep -q '"status":"ok"'; then
    echo "PASS: $BASE_URL/smoke/health → ok (attempt $i)"
    exit 0
  fi
  sleep 1
done

echo "FAIL: $BASE_URL/smoke/health did not report ok after ${ATTEMPTS}s"
curl -s "$BASE_URL/smoke/health" || true
exit 1
