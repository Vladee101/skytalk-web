#!/usr/bin/env bash
# remote-deploy.sh — runs ON THE VPS. Shipped inside the archive built by infra/deploy.sh and
# started over the same SSH session:
#   ssh host 'T=$(mktemp -d) && tar xzf - -C "$T" && bash "$T/remote-deploy.sh" "$T"' < archive
#
# Touches only SkyTalk paths (the VPS hosts other apps): backs up, swaps the web build and
# server dist, restarts skytalk-server, checks health and rolls the server back if it fails.
set -euo pipefail

SRC="${1:?usage: remote-deploy.sh <unpacked archive dir>}"
trap 'rm -rf "$SRC"' EXIT

# Overridable for local testing only
SERVER_DIR="${SKYTALK_SERVER_DIR:-/opt/skytalk/server}"
WEB_DIR="${SKYTALK_WEB_DIR:-/var/www/skytalk}"
OPT_DIR="${SKYTALK_OPT_DIR:-/opt/skytalk}"
HEALTH_URL="${SKYTALK_HEALTH_URL:-http://127.0.0.1:3001/api/health}"
KEEP_BACKUPS=5

COMMIT="$(cat "$SRC/COMMIT")"
WEB_ONLY=0
[[ -f "$SRC/WEB_ONLY" ]] && WEB_ONLY=1

fail() { echo "ERROR: $*" >&2; exit 1; }

# ---- Preflight: nothing is changed until all checks pass ----
[[ -d "$WEB_DIR" ]] || fail "$WEB_DIR not found — first-time setup first (infra/README.md)"
if [[ "$WEB_ONLY" -eq 0 ]]; then
  [[ -d "$SERVER_DIR/dist" ]] || fail "$SERVER_DIR/dist not found — first-time setup first (infra/README.md)"
  # dist/server.js is bundled, but its npm dependencies live in $SERVER_DIR/node_modules.
  # A deploy with changed dependencies would start and crash on a missing module.
  DEPS_MARK="$SERVER_DIR/.deployed-deps.json"
  if [[ -f "$DEPS_MARK" && ! -f "$SRC/DEPS_INSTALLED" ]] && ! cmp -s "$SRC/server-deps.json" "$DEPS_MARK"; then
    echo "Server dependencies changed since the last deploy:" >&2
    diff "$DEPS_MARK" "$SRC/server-deps.json" >&2 || true
    fail "install them in $SERVER_DIR/node_modules, then re-run deploy.sh with --deps-installed"
  fi
fi

# ---- Backup ----
BACKUP="$OPT_DIR/backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
cp -a "$WEB_DIR" "$BACKUP/www"
[[ "$WEB_ONLY" -eq 0 ]] && cp -a "$SERVER_DIR/dist" "$BACKUP/server-dist"
[[ -f "$OPT_DIR/DEPLOYED_COMMIT" ]] && cp "$OPT_DIR/DEPLOYED_COMMIT" "$BACKUP/PREVIOUS_COMMIT"
echo "==> Backup: $BACKUP"

# ---- Web: copy over, never delete (old hashed assets keep already-open tabs working) ----
cp -a "$SRC/web-dist/." "$WEB_DIR/"
chown -R --reference="$WEB_DIR" "$WEB_DIR"
echo "==> Web updated"

# ---- Infra helper scripts (metrics, backups) ----
for f in skytalk-metrics.sh skytalk-backup.sh; do
  if [[ -f "$SRC/$f" ]]; then
    cp "$SRC/$f" "$OPT_DIR/$f"
    chmod +x "$OPT_DIR/$f"
  fi
done

# ---- Server ----
if [[ "$WEB_ONLY" -eq 0 ]]; then
  rm -rf "$SERVER_DIR/dist"
  cp -a "$SRC/server-dist" "$SERVER_DIR/dist"
  chown -R --reference="$SERVER_DIR" "$SERVER_DIR/dist"

  echo "==> Restarting skytalk-server..."
  systemctl restart skytalk-server
  if ! curl -fsS --retry 10 --retry-delay 1 --retry-connrefused "$HEALTH_URL"; then
    echo >&2
    echo "Health check failed — restoring the previous server build" >&2
    rm -rf "$SERVER_DIR/dist"
    cp -a "$BACKUP/server-dist" "$SERVER_DIR/dist"
    systemctl restart skytalk-server
    journalctl -u skytalk-server -n 30 --no-pager >&2 || true
    fail "deploy of $COMMIT rolled back (web files stay updated; restore from $BACKUP/www if needed)"
  fi
  echo
  cp "$SRC/server-deps.json" "$SERVER_DIR/.deployed-deps.json"
fi

echo "$COMMIT" > "$OPT_DIR/DEPLOYED_COMMIT"

# ---- Keep only the newest backups ----
ls -1dt "$OPT_DIR"/backup-* 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -rf --

echo "==> Deployed $COMMIT"
echo "    Rollback: cp -a $BACKUP/www/. $WEB_DIR/  and  rm -rf $SERVER_DIR/dist && cp -a $BACKUP/server-dist $SERVER_DIR/dist && systemctl restart skytalk-server"
