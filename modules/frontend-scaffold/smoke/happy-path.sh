#!/usr/bin/env bash
# Happy-path smoke for frontend-scaffold (module 05).
# One realistic round trip against the served PWA shell:
#   1. index.html renders the app mount + title
#   2. the PWA manifest is served and is valid standalone JSON
#   3. the service worker is present (PWA installable)
#   4. SPA history fallback serves the shell for a client route
set -euo pipefail

PORT="${FRONTEND_SMOKE_PORT:-5176}"
BASE="http://localhost:${PORT}"

echo "→ 1. index.html"
INDEX="$(curl -sf "${BASE}/")"
echo "$INDEX" | grep -q 'id="root"' || { echo "✗ #root mount missing"; exit 1; }
echo "$INDEX" | grep -q '<title>' || { echo "✗ <title> missing"; exit 1; }
echo "$INDEX" | grep -q 'rel="manifest"' || { echo "✗ manifest link missing"; exit 1; }
echo "  ✓ shell HTML ok"

echo "→ 2. manifest.json"
MANIFEST="$(curl -sf "${BASE}/manifest.json")"
# Portable JSON assertions without jq: grep the required fields.
echo "$MANIFEST" | grep -q '"display"[[:space:]]*:[[:space:]]*"standalone"' \
  || { echo "✗ manifest display is not standalone"; exit 1; }
echo "$MANIFEST" | grep -q '"icons"' || { echo "✗ manifest has no icons"; exit 1; }
echo "  ✓ manifest valid + standalone"

echo "→ 3. service worker"
curl -sf "${BASE}/sw.js" -o /dev/null || { echo "✗ sw.js not served"; exit 1; }
echo "  ✓ service worker present"

echo "→ 4. SPA fallback (/progress)"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/progress")"
[ "$CODE" = "200" ] || { echo "✗ /progress did not fall back to shell (got $CODE)"; exit 1; }
echo "  ✓ history fallback ok"

echo "✓ happy path passed"
