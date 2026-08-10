#!/usr/bin/env bash
# Deploy bkk-3d-atlas to atlas.nonarkara.org and verify the live HTML.
# Learned the hard way: a successful wrangler deploy can still look "stale"
# for ~10s because Cloudflare edge returns cf-cache-status: HIT on the old
# asset. Always wait, then check markers on a single response — do not trust
# the first curl after upload.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EXPECTED_ACCOUNT="74ad6bf8dfaaccf82de6f0847f7d2d54"
LIVE_URL="${LIVE_URL:-https://atlas.nonarkara.org/}"
LIVE_ORIGIN="${LIVE_URL%/}"
MARKER_ABOUT='id="atlas-about"'
MARKER_LABS='id="atlas-labs"'
MARKER_LANDMARKS='installLandmarks'
WAIT_SECS="${DEPLOY_CACHE_WAIT_SECS:-12}"

echo "==> ensure main is current"
git fetch origin main
git checkout main
git pull --ff-only origin main

echo "==> preflight: About markup + landmarks wiring present in public/"
if ! grep -q "$MARKER_ABOUT" public/index.html; then
  echo "ERROR: $MARKER_ABOUT missing from public/index.html — refusing to deploy stale tree" >&2
  exit 1
fi
if ! grep -q "$MARKER_LANDMARKS" public/app.js; then
  echo "ERROR: $MARKER_LANDMARKS missing from public/app.js — refusing to deploy stale tree" >&2
  exit 1
fi
if [[ ! -f public/bkk-landmarks.geojson || ! -f public/bkk-heritage-detail.geojson ]]; then
  echo "ERROR: heritage GeoJSON missing under public/ — refusing to deploy" >&2
  exit 1
fi

echo "==> wrangler whoami (account must be $EXPECTED_ACCOUNT)"
WHOAMI="$(npx wrangler whoami 2>&1)" || {
  echo "$WHOAMI" >&2
  echo "ERROR: wrangler not authenticated. Run: npx wrangler login" >&2
  exit 1
}
echo "$WHOAMI"
if ! printf '%s' "$WHOAMI" | grep -q "$EXPECTED_ACCOUNT"; then
  echo "ERROR: wrong Cloudflare account. Expected $EXPECTED_ACCOUNT" >&2
  exit 1
fi

echo "==> wrangler deploy"
DEPLOY_LOG="$(mktemp)"
npx wrangler deploy | tee "$DEPLOY_LOG"
if ! grep -q "atlas.nonarkara.org" "$DEPLOY_LOG"; then
  echo "WARN: deploy log did not mention atlas.nonarkara.org — check routes" >&2
fi

echo "==> waiting ${WAIT_SECS}s for Workers asset edge cache to catch up"
sleep "$WAIT_SECS"

verify_once() {
  local html app lm_code lm_http heritage_http
  html="$(curl -sL "$LIVE_URL")"
  app="$(curl -sL "$LIVE_ORIGIN/app.js")"
  lm_http="$(curl -s -o /dev/null -w '%{http_code}' "$LIVE_ORIGIN/bkk-landmarks.geojson")"
  heritage_http="$(curl -s -o /dev/null -w '%{http_code}' "$LIVE_ORIGIN/bkk-heritage-detail.geojson")"
  local bytes about labs landmarks
  bytes="$(printf '%s' "$html" | wc -c | tr -d ' ')"
  about="$(printf '%s' "$html" | grep -c "$MARKER_ABOUT" || true)"
  labs="$(printf '%s' "$html" | grep -c "$MARKER_LABS" || true)"
  landmarks="$(printf '%s' "$app" | grep -c "$MARKER_LANDMARKS" || true)"
  printf 'bytes=%s about=%s labs=%s landmarks=%s lm_http=%s heritage_http=%s\n' \
    "$bytes" "$about" "$labs" "$landmarks" "$lm_http" "$heritage_http"
  [[ "$about" -ge 1 && "$labs" -eq 0 && "$landmarks" -ge 1 && "$lm_http" == "200" && "$heritage_http" == "200" ]]
}

echo "==> live verify (3 stable checks: About + landmarks + heritage GeoJSON)"
ok=0
for i in 1 2 3; do
  echo -n "  check $i: "
  if verify_once; then
    ok=$((ok + 1))
  else
    echo "    (mismatch — waiting 5s and retrying once)"
    sleep 5
    if verify_once; then
      ok=$((ok + 1))
    fi
  fi
done

if [[ "$ok" -lt 3 ]]; then
  echo "ERROR: live did not stabilize on About + heritage build ($ok/3). Deploy may still be propagating." >&2
  exit 1
fi

echo "OK: live matches About + heritage build on $LIVE_URL"
