#!/usr/bin/env bash
# Smoke: backend-core happy path — health OK + stubs return 501
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3005}"

check_status() {
  local url="$1"
  local method="${2:-GET}"
  local expected="$3"
  local actual
  # No -f: we assert status codes (incl. 501), so curl must NOT fail on 4xx/5xx.
  actual=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url")
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $method $url — expected $expected, got $actual"
    exit 1
  fi
  echo "PASS: $method $url → $actual"
}

# Health endpoint
check_status "$BASE_URL/api/health" GET 200

# Stub routes return 501
check_status "$BASE_URL/api/skus"       GET  501
check_status "$BASE_URL/api/dims"       GET  501
check_status "$BASE_URL/api/dims"       POST 501
check_status "$BASE_URL/api/sync/cc"    POST 501
check_status "$BASE_URL/api/admin/seed" POST 501

echo "All smoke checks passed."
