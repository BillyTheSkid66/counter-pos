#!/bin/sh
set -eu
: "${RESTORE_SERVICE:?Set a libpq service pointing at a NEW EMPTY test database}"
: "${RESTORE_DATABASE:?Set the explicit test database name}"
case "$RESTORE_DATABASE" in *_restore_test) ;; *) echo 'Target must end in _restore_test' >&2; exit 1;; esac
test "$#" -eq 1 || { echo 'Usage: restore-test.sh backup.dump' >&2; exit 1; }
export PGSERVICE="$RESTORE_SERVICE"
actual=$(psql -X -At -c 'select current_database()')
test "$actual" = "$RESTORE_DATABASE" || { echo 'Database name mismatch' >&2; exit 1; }
tables=$(psql -X -At -c "select count(*) from pg_tables where schemaname='public'")
test "$tables" = 0 || { echo 'Restore target must be empty' >&2; exit 1; }
pg_restore --exit-on-error --single-transaction --no-owner --dbname="service=$RESTORE_SERVICE" "$1"
psql -X -v ON_ERROR_STOP=1 -c 'select count(*) as organisations from organisations; select count(*) as sales from sales;'
echo 'Restore completed. Validate application totals against the test database before accepting the recovery drill.'
