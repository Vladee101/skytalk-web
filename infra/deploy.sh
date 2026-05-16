#!/usr/bin/env bash
# deploy.sh — build locally and push to VPS
# Usage: ./infra/deploy.sh [user@host]
# Default host is read from SKYTALK_DEPLOY_HOST env var.
# Run from repo root.

set -euo pipefail

DEPLOY_HOST="${1:-${SKYTALK_DEPLOY_HOST:-}}"

if [[ -z "$DEPLOY_HOST" ]]; then
  echo "Error: deploy host required. Pass as argument or set SKYTALK_DEPLOY_HOST." >&2
  exit 1
fi

COMMIT=$(git rev-parse HEAD)
COMMIT_SHORT=$(git rev-parse --short HEAD)
echo "==> Deploying commit ${COMMIT_SHORT} (${COMMIT})"

echo "==> Building all packages..."
pnpm -r build

echo "==> Syncing server dist to ${DEPLOY_HOST}:/opt/skytalk/server/..."
rsync -az --delete \
  packages/server/dist/ \
  "${DEPLOY_HOST}:/opt/skytalk/server/dist/"

echo "==> Syncing server node_modules to ${DEPLOY_HOST}:/opt/skytalk/server/..."
rsync -az --delete \
  packages/server/node_modules/ \
  "${DEPLOY_HOST}:/opt/skytalk/server/node_modules/"

echo "==> Syncing web build to ${DEPLOY_HOST}:/var/www/skytalk/..."
rsync -az --delete \
  packages/web/dist/ \
  "${DEPLOY_HOST}:/var/www/skytalk/"

echo "==> Syncing infra scripts to ${DEPLOY_HOST}:/opt/skytalk/..."
rsync -az \
  infra/skytalk-metrics.sh \
  infra/skytalk-backup.sh \
  "${DEPLOY_HOST}:/opt/skytalk/"
ssh "${DEPLOY_HOST}" "chmod +x /opt/skytalk/skytalk-metrics.sh /opt/skytalk/skytalk-backup.sh"

echo "==> Restarting skytalk-server..."
ssh "${DEPLOY_HOST}" "systemctl restart skytalk-server"

echo "==> Checking service status..."
ssh "${DEPLOY_HOST}" "systemctl is-active skytalk-server && echo 'skytalk-server: OK'"

echo "==> Deploy complete. Commit: ${COMMIT_SHORT}"
