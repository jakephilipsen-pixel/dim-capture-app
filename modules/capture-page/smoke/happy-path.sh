#!/usr/bin/env bash
# Smoke: capture-page happy path. Drives the exact API round-trip the Capture
# page performs against the real backend + mock CC, then asserts the frontend
# container serves the PWA shell.
#
#   seed → lookup-by-barcode → POST /api/dims → progress → sync → shell serves
#
# The camera/torch/beep/offline-queue paths can't be driven headless; they are
# covered by this module's unit tests.
set -euo pipefail
SYNC_KEY="${SYNC_KEY:-smoke-secret}"

BACKEND_URL="${BACKEND_URL:-http://localhost:3010}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5177}"

# check <desc> <method> <path> <expected-status> [needle] [json-body]
# No -f, so a non-2xx doesn't abort under set -e; we assert the status ourselves.
check() {
  local desc="$1" method="$2" path="$3" expected="$4" needle="${5:-}" json="${6:-}"
  local body status
  local -a args=(-s -w $'\n%{http_code}' -H "X-Sync-Key: $SYNC_KEY" -X "$method")
  if [[ -n "$json" ]]; then
    args+=(-H "Content-Type: application/json" -d "$json")
  fi
  body=$(curl "${args[@]}" "$BACKEND_URL$path")
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

# fcheck <desc> <path> <expected-status> [needle] — frontend (static) assertions.
fcheck() {
  local desc="$1" path="$2" expected="$3" needle="${4:-}"
  local body status
  body=$(curl -s -w $'\n%{http_code}' "$FRONTEND_URL$path")
  status="${body##*$'\n'}"
  body="${body%$'\n'*}"
  if [[ "$status" != "$expected" ]]; then
    echo "FAIL: $desc (GET $path) — expected $expected, got $status"
    exit 1
  fi
  if [[ -n "$needle" && "$body" != *"$needle"* ]]; then
    echo "FAIL: $desc (GET $path) — body missing '$needle'"
    exit 1
  fi
  echo "PASS: $desc → $status ${needle:+(contains '$needle')}"
}

# whp-1 = "Forage Granola 500g", barcode 9311111000011, no CC dims (the page's
# "No dims in CC" path).
CAPTURE='{"skuId":"whp-1","lengthMm":320,"widthMm":210,"heightMm":160,"weightKg":0.9,"measuredBy":"Smoke"}'

echo "── backend round-trip (what the Capture page calls) ──"
# 1. Seed SKUs so a lookup has something to find.
check "seed pulls CC products"        POST "/api/admin/seed"            200 '"upserted":2'
# 2. Page looks the scanned barcode up (DB-first).
check "lookup by barcode"             GET  "/api/skus/9311111000011"    200 '"id":"whp-1"'
check "lookup shows no CC dims"        GET  "/api/skus/9311111000011"    200 '"hasDims":false'
# 3. Page Save → POST /api/dims.
check "save a dim"                     POST "/api/dims"                  200 '"skuId":"whp-1"'    "$CAPTURE"
# 4. Page refreshes progress after save.
check "progress reflects capture"      GET  "/api/progress"              200 '"captured":1'
check "capture pending sync"           GET  "/api/progress"              200 '"pendingSync":1'
# 5. Background useSync pushes to CC.
check "background sync to CC"          POST "/api/sync/cc"               200 '"synced":1'
check "nothing left pending"           GET  "/api/progress"              200 '"pendingSync":0'

echo "── frontend shell ──"
fcheck "shell serves"                  "/"                               200 'id="root"'
fcheck "manifest served"               "/manifest.json"                  200 '"standalone"'
fcheck "SPA fallback (/)"              "/review"                         200 'id="root"'

echo "All capture-page smoke checks passed."
