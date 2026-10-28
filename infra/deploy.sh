#!/usr/bin/env bash
# deploy.sh — build the committed HEAD and deploy it to the VPS in one SSH session.
#
# Usage: ./infra/deploy.sh [--web-only] [--deps-installed] [user@host]
#   --web-only        frontend only; skytalk-server is not restarted
#   --deps-installed  server npm dependencies changed and are already installed on the VPS
# Host defaults to $SKYTALK_DEPLOY_HOST. Set $SKYTALK_DEPLOY_URL (e.g. https://skytalk.website)
# to also check health from outside after the deploy.
#
# Works from Git Bash on Windows: no rsync, and no node_modules leave this machine
# (pnpm's are Windows symlinks). Uncommitted changes are never deployed — a clean
# worktree of HEAD is built. The server side is infra/remote-deploy.sh.
set -euo pipefail

WEB_ONLY=0
DEPS_INSTALLED=0
HOST=""
for arg in "$@"; do
  case "$arg" in
    --web-only) WEB_ONLY=1 ;;
    --deps-installed) DEPS_INSTALLED=1 ;;
    -*) echo "Unknown option: $arg" >&2; exit 1 ;;
    *) HOST="$arg" ;;
  esac
done
HOST="${HOST:-${SKYTALK_DEPLOY_HOST:-}}"
if [[ -z "$HOST" ]]; then
  echo "Error: deploy host required. Pass user@host or set SKYTALK_DEPLOY_HOST." >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
COMMIT="$(git rev-parse HEAD)"
COMMIT_SHORT="$(git rev-parse --short HEAD)"

echo "==> Deploying ${COMMIT_SHORT} to ${HOST}$([[ $WEB_ONLY -eq 1 ]] && echo ' (web only)')"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "    Note: uncommitted changes are NOT included — building ${COMMIT_SHORT} as committed."
fi
if ! git branch -r --contains HEAD 2>/dev/null | grep -q .; then
  echo "    Warning: ${COMMIT_SHORT} is not pushed to any remote."
fi

TMP="$(mktemp -d)"
cleanup() {
  git -C "$ROOT" worktree remove --force "$TMP/src" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "==> Building clean worktree..."
git worktree add --detach --quiet "$TMP/src" HEAD
(
  cd "$TMP/src"
  pnpm install --frozen-lockfile --silent
  if [[ $WEB_ONLY -eq 1 ]]; then
    pnpm --filter @skytalk/web build
  else
    pnpm -r build
  fi
)

STAGE="$TMP/stage"
mkdir -p "$STAGE"
cp -r "$TMP/src/packages/web/dist" "$STAGE/web-dist"
if [[ $WEB_ONLY -eq 1 ]]; then
  touch "$STAGE/WEB_ONLY"
else
  # tsup's onSuccess patches `from "sqlite"` back to node:sqlite — a regression here breaks startup
  grep -q 'from "node:sqlite"' "$TMP/src/packages/server/dist/server.js" \
    || { echo "Error: server bundle does not import node:sqlite" >&2; exit 1; }
  cp -r "$TMP/src/packages/server/dist" "$STAGE/server-dist"
  # Runtime npm deps of the server (core is bundled) — remote-deploy.sh refuses to deploy
  # if they changed and nobody installed them on the VPS
  (cd "$TMP/src/packages/server" && node -e '
    const deps = { ...require("./package.json").dependencies };
    delete deps["@skytalk/core"];
    const sorted = Object.fromEntries(Object.keys(deps).sort().map((k) => [k, deps[k]]));
    process.stdout.write(JSON.stringify(sorted, null, 2) + "\n");
  ') > "$STAGE/server-deps.json"
  [[ $DEPS_INSTALLED -eq 1 ]] && touch "$STAGE/DEPS_INSTALLED"
fi
cp "$TMP/src/infra/remote-deploy.sh" "$TMP/src/infra/skytalk-metrics.sh" "$TMP/src/infra/skytalk-backup.sh" "$STAGE/"
echo "$COMMIT" > "$STAGE/COMMIT"

ARCHIVE="$TMP/deploy.tgz"
tar czf "$ARCHIVE" -C "$STAGE" .
echo "==> Archive: $(du -h "$ARCHIVE" | cut -f1)"

echo "==> Uploading and installing on ${HOST}..."
# shellcheck disable=SC2016 # expanded on the remote side
ssh "$HOST" 'T=$(mktemp -d) && tar xzf - -C "$T" && bash "$T/remote-deploy.sh" "$T"' < "$ARCHIVE"

if [[ -n "${SKYTALK_DEPLOY_URL:-}" ]]; then
  echo "==> External health check: ${SKYTALK_DEPLOY_URL}/api/health"
  curl -fsS "${SKYTALK_DEPLOY_URL}/api/health"
  echo
fi

echo "==> Deploy complete: ${COMMIT_SHORT}"
