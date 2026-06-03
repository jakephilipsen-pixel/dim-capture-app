#!/usr/bin/env bash
# Smoke: sku-seed happy path — one realistic round trip through the real
# backend container, a throwaway Postgres, and an in-container mock CC.
#
# Proves: empty start → seed (CC list pull) → idempotent re-seed → DB-first
# barcode lookup → CC-fallback upsert → 404 → top-level progress.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3009}"

# check <desc> <method> <path> <expected-status> <body-needle>
# -w appends the status; no -f so non-2xx (e.g. 404) doesn't abort under set -e.
check() {
  local desc="$1" method="$2" path="$3" expected="$4" needle="${5:-}"
  local body status
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

# 1. Empty DB to start.
check "skus empty before seed"      GET  "/api/skus"                  200 '"total":0'

# 2. Seed pulls the 3 mock-CC products; one already has dims in CC.
check "seed pulls CC products"      POST "/api/admin/seed"           200 '"upserted":3'
check "seed marks CC dims present"  POST "/api/admin/seed"           200 '"ccDimsPresent":1'

# 3. After seeding, 3 SKUs, none captured locally yet.
check "skus total after seed"       GET  "/api/skus"                 200 '"total":3'
check "skus captured still zero"    GET  "/api/skus"                 200 '"captured":0'

# 4. Idempotency — re-running seed does not duplicate (still 3).
check "skus total unchanged"        GET  "/api/skus"                 200 '"total":3'

# 5. DB-first lookup of a seeded barcode.
check "lookup seeded barcode (db)"  GET  "/api/skus/9311111000011"   200 '"source":"db"'

# 6. CC-fallback: barcode not seeded but known to CC → upsert + source:cc.
check "lookup fallback (cc)"        GET  "/api/skus/9311111000099"   200 '"source":"cc"'
check "fallback grew the table"     GET  "/api/skus"                 200 '"total":4'

# 7. Unknown barcode → 404 from neither DB nor CC.
check "unknown barcode 404"         GET  "/api/skus/0000000000000"   404

# 8. Progress at the top-level path (spec: /api/progress, not /api/admin).
check "progress summary"            GET  "/api/progress"             200 '"total":4'
check "progress percentage field"   GET  "/api/progress"             200 '"percentage":0'

echo "All sku-seed smoke checks passed."
