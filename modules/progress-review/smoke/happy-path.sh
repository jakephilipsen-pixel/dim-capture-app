#!/usr/bin/env bash
# Smoke: progress-review happy path. Drives the API calls the Progress and
# Review pages make against the real backend + mock CC, then asserts the
# frontend serves the /progress and /review routes.
#
#   seed → list SKUs (Progress) → list dims (Review) → capture → PUT correction
#        → sync (Sync Now) → shell serves /progress + /review
#
# The interactive bits (filter/search/edit-sheet) are covered by unit tests.
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:3011}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5178}"

# check <desc> <method> <path> <expected-status> [needle] [json-body]
check() {
  local desc="$1" method="$2" path="$3" expected="$4" needle="${5:-}" json="${6:-}"
  local body status
  local -a args=(-s -w $'\n%{http_code}' -X "$method")
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

CAPTURE='{"skuId":"cc-2","lengthMm":320,"widthMm":210,"heightMm":160,"weightKg":0.9,"measuredBy":"Smoke"}'
CORRECTION='{"lengthMm":330,"widthMm":215,"heightMm":165,"weightKg":1.0,"measuredBy":"Smoke2"}'

echo "── backend round-trip (what Progress + Review call) ──"
# Seed so the Progress list has SKUs.
check "seed pulls CC products"      POST "/api/admin/seed"   200 '"upserted":3'
# Progress page lists all SKUs (none captured yet).
check "skus list (Progress)"        GET  "/api/skus"         200 '"total":3'
check "skus none captured yet"      GET  "/api/skus"         200 '"captured":0'
# Review page lists captures (empty).
check "dims empty (Review)"         GET  "/api/dims"         200 '[]'
# Capture a dim (Progress edit-sheet → POST).
check "capture a dim"               POST "/api/dims"         200 '"skuId":"cc-2"'    "$CAPTURE"
# Progress count now reflects it.
check "skus captured=1"             GET  "/api/skus"         200 '"captured":1'
# Review list shows it with the joined SKU name.
check "dims list joins name"        GET  "/api/dims"         200 'Forage Muesli 1kg'
check "capture unsynced"            GET  "/api/dims"         200 '"syncedToCC":false'
# Edit (Progress/Review) → PUT correction resets sync.
check "PUT correction (edit)"       PUT  "/api/dims/1"       200 '"syncedToCC":false' "$CORRECTION"
# Sync Now (Review) pushes to CC.
check "Sync Now → CC"               POST "/api/sync/cc"      200 '"synced":1'
check "nothing left pending"        GET  "/api/progress"     200 '"pendingSync":0'

echo "── frontend shell (SPA routes) ──"
fcheck "shell serves /"             "/"                      200 'id="root"'
fcheck "SPA route /progress"        "/progress"              200 'id="root"'
fcheck "SPA route /review"          "/review"                200 'id="root"'

echo "All progress-review smoke checks passed."
