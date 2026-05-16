#!/usr/bin/env bash
# skytalk-backup.sh — daily snapshot of /var/lib/skytalk/ to /var/backups/
# Invoked by skytalk-backup.timer at 02:00 daily.
# Retains the last 14 daily archives locally.

set -euo pipefail

SRC=/var/lib/skytalk
DEST=/var/backups
ARCHIVE="${DEST}/skytalk-$(date +%F).tgz"

mkdir -p "$DEST"
tar czf "$ARCHIVE" -C / "${SRC#/}"
echo "Backup written: $ARCHIVE ($(du -sh "$ARCHIVE" | cut -f1))"

# Prune archives older than 14 days
find "$DEST" -maxdepth 1 -name 'skytalk-*.tgz' -mtime +14 -delete
echo "Pruned archives older than 14 days"
