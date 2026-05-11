#!/usr/bin/env bash
# healthcheck-all.sh
# Hits every service's health endpoint. Reads endpoint list from .health-endpoints
# Each line: <service-name> <url>
#
# Override target via NUC_URL env var to check NUC instead of localhost.
#
# Usage: ./scripts/healthcheck-all.sh

set -euo pipefail

ENDPOINTS_FILE=".health-endpoints"

if [ ! -f "$ENDPOINTS_FILE" ]; then
  echo "ERROR: $ENDPOINTS_FILE not found"
  echo "Format (one per line): <service-name> <url-or-path>"
  echo "  api http://localhost:3000/health"
  echo "  worker http://localhost:3001/health"
  exit 1
fi

BASE_URL="${NUC_URL:-}"
FAILED=()
TIMEOUT=30

while IFS=' ' read -r SERVICE URL; do
  [ -z "$SERVICE" ] && continue
  [[ "$SERVICE" == "#"* ]] && continue

  # If NUC_URL is set, replace localhost-style URLs with the NUC base URL
  if [ -n "$BASE_URL" ]; then
    # Strip any http://localhost:PORT prefix and prepend BASE_URL
    PATH_PART=$(echo "$URL" | sed -E 's|^https?://[^/]+||')
    TARGET="$BASE_URL$PATH_PART"
  else
    TARGET="$URL"
  fi

  echo -n "→ $SERVICE ($TARGET) ... "
  ELAPSED=0
  until STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$TARGET" 2>/dev/null) && [ "$STATUS" = "200" ]; do
    sleep 1
    ELAPSED=$((ELAPSED + 1))
    if [ $ELAPSED -ge $TIMEOUT ]; then
      echo "FAIL (status: ${STATUS:-no response} after ${TIMEOUT}s)"
      FAILED+=("$SERVICE")
      break
    fi
  done
  [ $ELAPSED -lt $TIMEOUT ] && echo "OK (${ELAPSED}s)"
done < "$ENDPOINTS_FILE"

echo ""
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "✓ All health checks passed"
  exit 0
else
  echo "✗ Failed: ${FAILED[*]}"
  exit 1
fi
