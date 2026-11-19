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
# A lock older than LOCK_TTL_MINUTES is presumed orphaned. The EXIT trap below
# clears the lock on every ordinary failure, but a trap cannot survive kill -9,
# a power cut or a container eviction — and an empty directory with no owner is
# indistinguishable from a live deploy. Without an expiry, one crashed release
# wedges every release after it until a human notices and rmdirs it by hand.
LOCK_TTL_MINUTES="${LOCK_TTL_MINUTES:-30}"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin "+$LOCK_TTL_MINUTES" 2>/dev/null)" ]; then
    echo "release: lock is older than ${LOCK_TTL_MINUTES}m with no deploy holding it — clearing and continuing" >&2
    rmdir "$LOCK" 2>/dev/null || true
    if ! mkdir "$LOCK" 2>/dev/null; then
      echo "release refused: could not re-take the lock after clearing a stale one" >&2
      exit 1
    fi
  else
    echo "release refused: another deploy holds the lock (if none is running: wait ${LOCK_TTL_MINUTES}m, or rmdir $LOCK)" >&2
    exit 1
  fi
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
RELEASE_SOURCE_REV="$(git rev-parse HEAD)"
npx wrangler whoami 2>&1 | grep -q "$EXPECTED_ACCOUNT" || { echo "release refused: wrangler is not on account $EXPECTED_ACCOUNT" >&2; exit 1; }
npm run typecheck
npm run verify
npm test
check_clean  # a parallel agent may have dirtied the tree during the gate
if [ "$(git rev-parse HEAD)" != "$RELEASE_SOURCE_REV" ]; then
  echo "release refused: HEAD changed while checks were running; verify the new revision first." >&2
  exit 1
fi

TAG="$(node scripts/stamp-build-id.mjs)"
# Freeze the expected stamping diff too. A clean-tree check before a network
# upload cannot catch an agent changing assets during that upload.
RELEASE_ASSET_DIFF="$(git diff --binary -- public src | git hash-object --stdin)"
check_release_snapshot() {
  if [ "$(git rev-parse HEAD)" != "$RELEASE_SOURCE_REV" ] ||
     [ "$(git diff --binary -- public src | git hash-object --stdin)" != "$RELEASE_ASSET_DIFF" ] ||
     [ -n "$(git status --porcelain --untracked-files=all -- public src | sed -n '/^??/p')" ]; then
    echo "release refused: source/assets changed after stamping; do not publish mixed agent work." >&2
    exit 1
  fi
}
npx wrangler deploy --config wrangler.cron.toml
check_release_snapshot
npx wrangler deploy
DEPLOYED_BUILD="$TAG"
check_release_snapshot

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
