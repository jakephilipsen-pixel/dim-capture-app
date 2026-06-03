#!/usr/bin/env bash
# Smoke: dim-api health check. Polls the backend's /api/health until the DB
# reports connected (migrate deploy + Postgres ready), or times out.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3010}"
ATTEMPTS="${ATTEMPTS:-30}"

for i in $(seq 1 "$ATTEMPTS"); do
  if curl -sf "$BASE_URL/api/health" 2>/dev/null | grep -q '"db":"connected"'; then
    echo "PASS: health ok ($BASE_URL/api/health) after ${i}s"
    exit 0
  fi
  sleep 1
done

echo "FAIL: /api/health did not report db:connected within ${ATTEMPTS}s"
curl -s "$BASE_URL/api/health" || true
exit 1
