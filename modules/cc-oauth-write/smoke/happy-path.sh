#!/usr/bin/env bash
# Smoke: cc-oauth-write happy path — one realistic round trip through the real
# backend container, a throwaway Postgres, and the v8 mock CartonCloud.
#
# Proves: seed via the v8 warehouse-products search → barcode lookup (DB hit) →
# capture a dim for a clean SKU and for a name-poisoned SKU → sync writes +
# read-back-verifies the clean one (synced:1) and marks the poisoned one
# blocked:1 (no PATCH). No real CartonCloud is contacted.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3011}"
SYNC_KEY="${SYNC_KEY:-smoke-secret}"

# check <desc> <method> <path> <expected-status> [needle] [json-body]
check() {
  local desc="$1" method="$2" path="$3" expected="$4" needle="${5:-}" json="${6:-}"
  local body status
  local -a args=(-s -w $'\n%{http_code}' -X "$method" -H "X-Sync-Key: $SYNC_KEY")
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

# whp-1 is clean (writable); whp-2 has a 2-char "CT" UoM name (name-poisoned).
CAP_CLEAN='{"skuId":"whp-1","lengthMm":300,"widthMm":200,"heightMm":150,"weightKg":2.4,"measuredBy":"Smoke"}'
CAP_POISON='{"skuId":"whp-2","lengthMm":250,"widthMm":140,"heightMm":70,"weightKg":1.3,"measuredBy":"Smoke"}'

# 1. Seed pulls the two Forage warehouse-products from the v8 mock.
check "seed pulls warehouse-products" POST "/api/admin/seed" 200 '"upserted":2'

# 2. Barcode lookup resolves to the seeded warehouse-product (DB hit).
check "lookup clean SKU by barcode"   GET  "/api/skus/9311111000011" 200 '"source":"db"'
check "lookup returns the code"       GET  "/api/skus/9311111000011" 200 '"code":"FG-GRA"'

# 3. Capture a dim for each SKU.
check "capture clean SKU dim"         POST "/api/dims" 200 '"skuId":"whp-1"' "$CAP_CLEAN"
check "capture poisoned SKU dim"      POST "/api/dims" 200 '"skuId":"whp-2"' "$CAP_POISON"

# 4. Sync (single run): the clean SKU is written + read-back verified and the
#    poisoned one is blocked (no PATCH). One run does both.
check "sync blocks the poisoned SKU"  POST "/api/sync/cc" 200 '"blocked":1'
# whp-1 was written + verified in that same run.
check "progress shows one synced"     GET  "/api/progress" 200 '"syncedToCC":1'
# A second sync is a no-op: the blocked SKU is excluded, the clean one is synced.
check "re-sync is a clean no-op"      POST "/api/sync/cc" 200 '"synced":0'

echo "All cc-oauth-write smoke checks passed."
