#!/usr/bin/env bash
# Smoke: dim-api happy path — one realistic round trip through the real backend
# container, a throwaway Postgres, and an in-container mock CC.
#
# Proves: empty dims → seed SKUs → capture a dim (422 on bad dims, 404 on
# unknown SKU) → list shows it unsynced with the joined SKU name → sync PATCHes
# CC and flips it to synced → PUT correction resets the sync state.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3010}"

# check <desc> <method> <path> <expected-status> [needle] [json-body]
# -w appends the status; no -f so a non-2xx (422/404) doesn't abort under set -e.
check() {
  local desc="$1" method="$2" path="$3" expected="$4" needle="${5:-}" json="${6:-}"
  local body status
  local -a args=(-s -w $'\n%{http_code}' -X "$method")
  if [[ -n "$json" ]]; then
    args+=(-H "Content-Type: application/json" -d "$json")
  fi
  body=$(curl "${args[@]}" "$BASE_URL$path")
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

CAPTURE='{"skuId":"cc-2","lengthMm":320,"widthMm":210,"heightMm":160,"weightKg":0.9,"measuredBy":"Smoke"}'
BAD_DIMS='{"skuId":"cc-2","lengthMm":320,"widthMm":210,"heightMm":0,"weightKg":0.9,"measuredBy":"Smoke"}'
UNKNOWN_SKU='{"skuId":"does-not-exist","lengthMm":10,"widthMm":10,"heightMm":10,"weightKg":1,"measuredBy":"Smoke"}'
CORRECTION='{"lengthMm":330,"widthMm":215,"heightMm":165,"weightKg":1.0,"measuredBy":"Smoke2"}'

# 1. No dims captured yet.
check "dims empty before capture"   GET  "/api/dims"        200 '[]'

# 2. Seed SKUs from the mock CC so there's something to capture against.
check "seed pulls CC products"      POST "/api/admin/seed"  200 '"upserted":3'

# 3. Capture a dim against a seeded SKU (cc-2 has no CC dims yet).
check "capture a dim"               POST "/api/dims"        200 '"skuId":"cc-2"'    "$CAPTURE"

# 4. Validation: a zero dimension is rejected with 422, nothing stored.
check "reject zero dimension (422)" POST "/api/dims"        422 ''                  "$BAD_DIMS"

# 5. Unknown SKU is rejected with 404.
check "reject unknown skuId (404)"  POST "/api/dims"        404 ''                  "$UNKNOWN_SKU"

# 6. List shows the capture, unsynced, with the joined SKU name (proves the join).
check "list shows capture"          GET  "/api/dims"        200 '"skuId":"cc-2"'
check "list joins SKU name"         GET  "/api/dims"        200 'Forage Muesli 1kg'
check "capture starts unsynced"     GET  "/api/dims"        200 '"syncedToCC":false'

# 7. Progress: one captured, one pending sync.
check "progress captured=1"         GET  "/api/progress"    200 '"captured":1'
check "progress pendingSync=1"      GET  "/api/progress"    200 '"pendingSync":1'

# 8. Sync pushes the dim to CC (PATCH /products/cc-2 on the mock).
check "sync pushes to CC"           POST "/api/sync/cc"     200 '"synced":1'
check "sync had no failures"        GET  "/api/progress"    200 '"syncedToCC":1'

# 9. The dim is now marked synced.
check "capture now synced"          GET  "/api/dims"        200 '"syncedToCC":true'
check "nothing left pending"        GET  "/api/progress"    200 '"pendingSync":0'

# 10. Correcting the dim (id 1 — first capture in a fresh DB) resets sync state.
check "correct dim resets sync"     PUT  "/api/dims/1"      200 '"syncedToCC":false' "$CORRECTION"
check "correction needs re-sync"    GET  "/api/progress"    200 '"pendingSync":1'

echo "All dim-api smoke checks passed."
