#!/usr/bin/env bash
# skytalk-metrics.sh — append a one-minute system snapshot to metrics.log
# Invoked by skytalk-metrics.timer every minute.
# Output: /var/log/skytalk/metrics.log (rotated weekly by logrotate)

set -euo pipefail

LOG=/var/log/skytalk/metrics.log

{
  echo "--- $(date --iso-8601=seconds) ---"
  vmstat 1 1
  free -h
  ss -s
  echo ""
} >> "$LOG"
