#!/bin/bash
set -Eeuo pipefail
umask 077
export PGPASSWORD="$(cat "$PGPASSWORD_FILE")"
archive="/backups/nycap-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}.dump.age"
trap 'rm -f -- "${archive}.tmp"' EXIT
pg_dump -Fc --no-owner --no-acl --exclude-table-data=public.sessions | age -R /run/secrets/backup_recipient > "${archive}.tmp"
test -s "${archive}.tmp"
mv -- "${archive}.tmp" "$archive"
sha256sum "$archive" > "${archive}.sha256"
echo '{"event":"backup_complete","encrypted":true}'
