#!/usr/bin/env bash
# Smoke: floor-camera-flow happy path — one realistic floor round trip through the
# real backend container + a throwaway Postgres (+ the mock CC, used only to seed a
# SKU so the floor flow has a target).
#
# Proves: seed a SKU → capture a floor dim WITH a carton class (productType) →
# attach a carton JPEG on disk → fetch it back. No camera/getUserMedia (browser-only).
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3013}"
SYNC_KEY="${SYNC_KEY:-smoke-secret}"

# 1. Seed a SKU via the mock CC (the seed route is gated by X-Sync-Key).
resp=$(curl -s -w $'\n%{http_code}' -X POST -H "X-Sync-Key: $SYNC_KEY" "$BASE_URL/api/admin/seed")
status="${resp##*$'\n'}"; body="${resp%$'\n'*}"
[[ "$status" == "200" ]] || { echo "FAIL: seed → $status: $body"; exit 1; }
echo "PASS: seed a SKU → $status"

# 2. Capture a floor dim WITH a carton class for the seeded SKU (whp-1).
cap='{"skuId":"whp-1","lengthMm":300,"widthMm":200,"heightMm":150,"weightKg":2.4,"measuredBy":"Floor Smoke","productType":"Chilled"}'
resp=$(curl -s -w $'\n%{http_code}' -X POST -H "Content-Type: application/json" -d "$cap" "$BASE_URL/api/dims")
status="${resp##*$'\n'}"; body="${resp%$'\n'*}"
[[ "$status" == "200" ]] || { echo "FAIL: capture → $status: $body"; exit 1; }
[[ "$body" == *'"productType":"Chilled"'* ]] || { echo "FAIL: productType not stored: $body"; exit 1; }
DIM_ID=$(printf '%s' "$body" | grep -oE '"id":[0-9]+' | head -1 | grep -oE '[0-9]+' || true)
[[ -n "$DIM_ID" ]] || { echo "FAIL: no dim id in capture response: $body"; exit 1; }
echo "PASS: capture floor dim (Chilled) → id $DIM_ID"

# 3. Attach a carton photo (raw JPEG bytes; the route bypasses the JSON parser).
JPEG="$(mktemp)"
trap 'rm -f "$JPEG"' EXIT
# Minimal valid JPEG: SOI + JFIF APP0 + EOI. savePhoto checks the FF D8 FF magic + non-empty + size.
printf '\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xFF\xD9' > "$JPEG"
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: image/jpeg" \
  --data-binary "@$JPEG" "$BASE_URL/api/dims/$DIM_ID/photo")
[[ "$status" == "200" ]] || { echo "FAIL: photo upload → $status"; exit 1; }
echo "PASS: upload carton photo → $status"

# 4. Fetch the photo back (two calls keep it simple under `set -e`).
status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/dims/$DIM_ID/photo")
[[ "$status" == "200" ]] || { echo "FAIL: photo fetch → $status"; exit 1; }
ctype=$(curl -s -o /dev/null -w '%{content_type}' "$BASE_URL/api/dims/$DIM_ID/photo")
[[ "$ctype" == image/jpeg* ]] || { echo "FAIL: photo content-type → $ctype"; exit 1; }
echo "PASS: fetch carton photo → $status ($ctype)"

echo "All floor-camera-flow smoke checks passed."
