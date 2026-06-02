#!/usr/bin/env bash
# Smoke: backend-core health endpoint
# Polls until the backend has finished `prisma migrate deploy` + boot, then
# asserts health=ok / db=connected. A single curl is too flaky for a service
# that takes a few seconds to migrate and start.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3005}"
ATTEMPTS="${HEALTH_ATTEMPTS:-30}"   # ~30s at 1s intervals
INTERVAL="${HEALTH_INTERVAL:-1}"

echo "Checking $BASE_URL/api/health (up to ${ATTEMPTS}s) ..."

RESPONSE=""
for i in $(seq 1 "$ATTEMPTS"); do
  if RESPONSE=$(curl -sf "$BASE_URL/api/health" 2>/dev/null); then
    break
  fi
  sleep "$INTERVAL"
done

if [[ -z "$RESPONSE" ]]; then
  echo "FAIL: no response from $BASE_URL/api/health after ${ATTEMPTS}s"
  exit 1
fi

STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])")
DB=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['db'])")

if [[ "$STATUS" != "ok" ]]; then
  echo "FAIL: expected status=ok, got '$STATUS'"
  exit 1
fi

if [[ "$DB" != "connected" ]]; then
  echo "FAIL: expected db=connected, got '$DB'"
  exit 1
fi

echo "PASS: health=$STATUS db=$DB"
