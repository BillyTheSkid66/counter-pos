#!/bin/sh
set -eu
umask 077
: "${BACKUP_DIR:?Set BACKUP_DIR outside the public document root}"
: "${PGSERVICE:?Configure a private libpq service and .pgpass first}"
mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$BACKUP_DIR/counter-$stamp.dump"
trap 'rm -f "$target.partial"' EXIT HUP INT TERM
pg_dump --format=custom --file="$target.partial"
pg_restore --list "$target.partial" >/dev/null
test -s "$target.partial"
mv "$target.partial" "$target"
sha256sum "$target" > "$target.sha256"
printf '%s\n' "Backup created and archive checked: $target"
# Retention/deletion is an explicit owner-managed policy.
