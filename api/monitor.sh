#!/bin/sh
set -eu
: "${HEALTH_URL:?Set the HTTPS API URL ending in /health}"
: "${BACKUP_DIR:?Set the local backup directory}"
# Configure cron MAILTO to a monitored mailbox. Successful checks stay quiet.
curl --fail --silent --show-error --max-time 15 "$HEALTH_URL" | grep -q '"database":"ok"' || { echo 'Counter API/database unavailable' >&2; exit 1; }
recent=$(find "$BACKUP_DIR" -maxdepth 1 -name 'counter-*.dump' -type f -mmin -1560 -print -quit)
test -n "$recent" || { echo 'Counter backup is missing or more than 26 hours old' >&2; exit 1; }
used=$(df -P "$BACKUP_DIR" | awk 'NR==2 {gsub(/%/,"",$5);print $5}')
test "$used" -lt 85 || { echo 'Counter backup disk is at least 85% full' >&2; exit 1; }
