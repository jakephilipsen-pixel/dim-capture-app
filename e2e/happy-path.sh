#!/usr/bin/env bash
# e2e/happy-path.sh — Stage 4 of /deploy-local.
#
# A realistic cross-module floor round trip against the docker-compose.local.yml
# gate stack (assume Stage 1 already brought it up). Goes through the FRONTEND
# single-origin nginx proxy (the path the browser actually uses): frontend:5179
# serves the PWA and proxies /api → backend. The backend talks only to the
# in-container mock CartonCloud — no live CC.
#
# Flow: seed (v8 warehouse-products) → barcode lookup → floor capture (with
# productType) → carton photo upload + fetch → capture a name-poisoned SKU →
# sync (clean SKU written + read-back verified; poisoned SKU blocked) → progress
# reflects synced/blocked/pending coherently → re-sync is a no-op.
#
# Override BASE_URL to hit the backend directly (e.g. http://localhost:3015) if
# diagnosing the proxy.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5179}"
SYNC_KEY="${SYNC_KEY:-smoke-secret}"

# check <desc> <method> <path> <expected-status> [needle] [json-body]
check() {
  local desc="$1" method="$2" path="$3" expected="$4" needle="${5:-}" json="${6:-}"
  local out body status
  local -a args=(-s -w $'\n%{http_code}' -X "$method" -H "X-Sync-Key: $SYNC_KEY")
  if [[ -n "$json" ]]; then
    args+=(-H "Content-Type: application/json" -d "$json")
  fi
  out=$(curl "${args[@]}" "$BASE_URL$path")
  status="${out##*$'\n'}"
  body="${out%$'\n'*}"
  if [[ "$status" != "$expected" ]]; then
    echo "FAIL: $desc ($method $path) — expected $expected, got $status"
    echo "  body: $body"
    exit 1
  fi
  if [[ -n "$needle" && "$body" != *"$needle"* ]]; then
    echo "FAIL: $desc ($method $path) — body missing '$needle'"
    echo "  body: $body"
    exit 1
  fi
  echo "PASS: $desc → $status ${needle:+(contains '$needle')}"
  LAST_BODY="$body"
}

echo "e2e happy path against $BASE_URL (single-origin proxy → backend → mock CC)"

# 1. Seed pulls the two Forage warehouse-products from the v8 mock CC.
check "seed warehouse-products"       POST "/api/admin/seed"        200 '"upserted":2'

# 2. Barcode lookup resolves the scanned barcode to the seeded SKU (DB hit).
check "barcode lookup (DB hit)"       GET  "/api/skus/9311111000011" 200 '"source":"db"'
check "lookup returns the SKU code"   GET  "/api/skus/9311111000011" 200 '"code":"FG-GRA"'

# 3. Floor capture WITH a carton class for the clean SKU (whp-1).
CAP_CLEAN='{"skuId":"whp-1","lengthMm":300,"widthMm":200,"heightMm":150,"weightKg":2.4,"measuredBy":"E2E","productType":"Chilled"}'
check "floor capture (Chilled)"       POST "/api/dims"               200 '"productType":"Chilled"' "$CAP_CLEAN"
DIM_ID=$(printf '%s' "$LAST_BODY" | grep -oE '"id":[0-9]+' | head -1 | grep -oE '[0-9]+' || true)
[[ -n "$DIM_ID" ]] || { echo "FAIL: no dim id in capture response: $LAST_BODY"; exit 1; }
echo "      captured dim id $DIM_ID"

# 4. Carton photo: upload raw JPEG bytes (route bypasses the JSON parser), fetch back.
JPEG="$(mktemp)"; trap 'rm -f "$JPEG"' EXIT
printf '\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xFF\xD9' > "$JPEG"
PHOTO_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: image/jpeg" \
  --data-binary "@$JPEG" "$BASE_URL/api/dims/$DIM_ID/photo")
[[ "$PHOTO_STATUS" == "200" ]] || { echo "FAIL: photo upload → $PHOTO_STATUS"; exit 1; }
echo "PASS: upload carton photo → 200"
PHOTO_CTYPE=$(curl -s -o /dev/null -w '%{content_type}' "$BASE_URL/api/dims/$DIM_ID/photo")
[[ "$PHOTO_CTYPE" == image/jpeg* ]] || { echo "FAIL: photo fetch content-type → $PHOTO_CTYPE"; exit 1; }
echo "PASS: fetch carton photo → image/jpeg"

# 5. Capture a dim for the name-poisoned SKU (whp-2).
CAP_POISON='{"skuId":"whp-2","lengthMm":250,"widthMm":140,"heightMm":70,"weightKg":1.3,"measuredBy":"E2E"}'
check "capture poisoned SKU dim"      POST "/api/dims"               200 '"skuId":"whp-2"' "$CAP_POISON"

# 6. Sync: clean SKU written + read-back verified; poisoned SKU blocked (no PATCH).
check "sync blocks the poisoned SKU"  POST "/api/sync/cc"            200 '"blocked":1'

# 7. Progress reflects the new terminal states coherently.
check "progress: one synced"          GET  "/api/progress"           200 '"syncedToCC":1'
check "progress: one blocked"         GET  "/api/progress"           200 '"blocked":1'

# 8. Re-sync is a clean no-op (blocked excluded from the retry set; clean one done).
check "re-sync is a no-op"            POST "/api/sync/cc"            200 '"synced":0'

echo ""
echo "✓ e2e happy path passed"
