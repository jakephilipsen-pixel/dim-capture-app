#!/usr/bin/env bash
# Smoke: docker-deploy happy path.
# Proves the production stack works end to end and that the single-origin nginx
# proxy serves real API data — the two things this deploy module adds:
#
#   seed (needs a SKU to attach a dim to) → POST a dim → confirm it saved
#        → read it back THROUGH the frontend proxy → frontend serves the shell
#
# CC sync is out of smoke scope (it needs real CC); the mock CC only backs the seed.
set -euo pipefail
SYNC_KEY="${SYNC_KEY:-smoke-secret}"

BACKEND_URL="${BACKEND_URL:-http://localhost:3012}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5179}"

# req <desc> <base> <method> <path> <expected-status> [needle] [json-body]
req() {
  local desc="$1" base="$2" method="$3" path="$4" expected="$5" needle="${6:-}" json="${7:-}"
  local body status
  local -a args=(-s -w $'\n%{http_code}' -H "X-Sync-Key: $SYNC_KEY" -X "$method")
  if [[ -n "$json" ]]; then
    args+=(-H "Content-Type: application/json" -d "$json")
  fi
  body=$(curl "${args[@]}" "$base$path")
  status="${body##*$'\n'}"
  body="${body%$'\n'*}"
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
}

DIM='{"skuId":"whp-1","lengthMm":300,"widthMm":200,"heightMm":150,"weightKg":1.2,"measuredBy":"DeploySmoke"}'

echo "── backend round trip (production image) ──"
# Seed so there's a SKU to attach a dim to (mock CC backs this).
req "seed pulls CC products"  "$BACKEND_URL" POST "/api/admin/seed" 200 '"upserted":2'
# POST a dim and confirm it saved.
req "POST a dim"              "$BACKEND_URL" POST "/api/dims"       200 '"skuId":"whp-1"' "$DIM"
req "dim saved (direct read)" "$BACKEND_URL" GET  "/api/dims"       200 '"skuId":"whp-1"'

echo "── single origin (browser path: frontend nginx → backend) ──"
# The same saved dim, read back through the frontend's /api proxy — proves the
# deploy's single-origin wiring serves live API data, not just the static shell.
req "dim readable via frontend proxy" "$FRONTEND_URL" GET "/api/dims"   200 '"skuId":"whp-1"'
req "health via frontend proxy"       "$FRONTEND_URL" GET "/api/health" 200 '"db":"connected"'

echo "── frontend shell ──"
req "frontend serves the app shell"   "$FRONTEND_URL" GET "/"           200 'id="root"'

echo "All docker-deploy smoke checks passed."
