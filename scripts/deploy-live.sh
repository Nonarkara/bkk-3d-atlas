#!/usr/bin/env bash
# Release: verify locally, stamp, deploy both Workers, then prove the edge
# serves the exact committed bytes. Ported from the Jakarta atlas gate.
# Only committed work ships: an uncommitted tree means the live bytes could
# not be traced to a commit. Replaces the old script, which ran
# `git checkout main && git pull` mid-deploy and checked stale markers.
set -euo pipefail
cd "$(dirname "$0")/.."

EXPECTED_ACCOUNT="74ad6bf8dfaaccf82de6f0847f7d2d54"
ATLAS_URL="${ATLAS_URL:-https://atlas.nonarkara.org}"

# Two agents deploying over each other leave the edge on bytes no commit
# describes. mkdir is atomic, so it serializes releases.
LOCK=.deploy-locked
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "release refused: another deploy holds the lock (if none is running: rmdir $LOCK)" >&2
  exit 1
fi
DEPLOYED_BUILD=""
on_exit() {
  local code=$?
  rmdir "$LOCK" 2>/dev/null || true
  if [ "$code" -ne 0 ] && [ -n "$DEPLOYED_BUILD" ]; then
    echo "release FAILED after ${DEPLOYED_BUILD} went live. Fix the failing check and release again." >&2
  fi
  exit "$code"
}
trap on_exit EXIT

check_clean() {
  # Untracked files under public/ and src/ ship with wrangler too.
  if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git status --porcelain --untracked-files=all -- public src)" ]; then
    echo "release refused: uncommitted changes. Commit, then release." >&2
    git status --short >&2
    exit 1
  fi
}

check_clean
npx wrangler whoami 2>&1 | grep -q "$EXPECTED_ACCOUNT" || { echo "release refused: wrangler is not on account $EXPECTED_ACCOUNT" >&2; exit 1; }
npm run typecheck
npm run verify
npm test
check_clean  # a parallel agent may have dirtied the tree during the gate

TAG="$(node scripts/stamp-build-id.mjs)"
npx wrangler deploy --config wrangler.cron.toml
npx wrangler deploy
DEPLOYED_BUILD="$TAG"

# Record what reached the edge straight away, before verification, so a later
# failing check cannot leave the stamp uncommitted. Pathspec only: never sweep
# in files another agent staged.
STAMPED=(public/app.js public/index.html)
git add -- "${STAMPED[@]}"
git commit -q -m "chore: stamp build ${TAG}" -m "Agent: ${RELEASE_AGENT:-unattributed-release}" -- "${STAMPED[@]}"
git push -q origin HEAD

EXPECTED_BUILD="$TAG" ATLAS_URL="$ATLAS_URL" node scripts/verify-deployed-bytes.mjs
ATLAS_URL="$ATLAS_URL" npm run smoke
echo "released ${TAG}"
