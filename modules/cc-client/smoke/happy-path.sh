#!/usr/bin/env bash
# Smoke: cc-client happy path — exercise the live ccClient (against the
# in-container mock CC) through the smoke server's debug surface.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3007}"

# One request, asserts both the status code and a body substring.
# Usage: check <desc> <method> <path> <expected-status> <body-needle>
check() {
  local desc="$1" method="$2" path="$3" expected="$4" needle="$5"
  local body status
  # -w appends the status; no -f so non-2xx doesn't abort under set -e.
  body=$(curl -s -w $'\n%{http_code}' -X "$method" "$BASE_URL$path")
  status="${body##*$'\n'}"
  body="${body%$'\n'*}"
  if [[ "$status" != "$expected" ]]; then
    echo "FAIL: $desc ($method $path) — expected status $expected, got $status"
    echo "  body: $body"
    exit 1
  fi
  if [[ -n "$needle" && "$body" != *"$needle"* ]]; then
    echo "FAIL: $desc ($method $path) — body missing '$needle'"
    echo "  body: $body"
    exit 1
  fi
  echo "PASS: $desc → $status ${needle:+(contains '$needle')}"
}

# 1. Lookup of a known barcode returns the product.
check "lookup known barcode"   GET "/smoke/lookup?barcode=9300675024635" 200 '"found":true'
check "lookup known product id" GET "/smoke/lookup?barcode=9300675024635" 200 '"id":"prod-1"'

# 2. Lookup of an unknown barcode returns found:false (404 from CC → null).
check "lookup unknown barcode"  GET "/smoke/lookup?barcode=0000000000000" 200 '"found":false'

# 3. PATCH dims round trip succeeds (v8 JSON-Patch + read-back verify). The boot
#    self-test already wrote these dims (asserting status:written), so this
#    re-patch idempotently no-ops; either way a UoM-resolved (non-blocked)
#    outcome proves the write path works.
check "patch product dims"      POST "/smoke/patch" 200 '"uom":"EA"'

# 4. PATCH to an unknown id raises CcNotFoundError.
check "404 → CcNotFoundError"   GET "/smoke/notfound" 200 '"notFoundErrorRaised":true'

# 5. Draining the bucket raises CcRateLimitError.
check "bucket empty → CcRateLimitError" GET "/smoke/ratelimit" 200 '"rateLimitErrorRaised":true'

echo "All cc-client smoke checks passed."
