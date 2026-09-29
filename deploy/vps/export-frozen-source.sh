#!/usr/bin/env bash
set -euo pipefail

# Capture the last shared-hosting database state only after the Vercel API,
# cron, webhooks and Control mutations have stopped. This script is read-only
# against the source and never changes the application database pointer.
if [[ ${EUID} -ne 0 || ${NAZRAA_WRITE_FREEZE_CONFIRMED:-} != 1 ]]; then
  echo 'Root and a confirmed source write freeze are required.' >&2
  exit 2
fi

source_env=/opt/nazraa/config/source-db.env
backup_dir=/opt/nazraa/backups
if [[ ! -f $source_env || $(stat -c '%a' "$source_env") != 600 ]]; then
  echo 'Private source credential file is missing or incorrectly permissioned.' >&2
  exit 2
fi
install -d -m 0700 "$backup_dir"
stamp=$(date -u +%Y%m%d_%H%M%S)
backup="$backup_dir/source-final-${stamp}.sql.gz"
tmp=$(mktemp "$backup_dir/.source-final-${stamp}.XXXXXX")
trap 'rm -f -- "$tmp"' EXIT

# The dedicated source account has SELECT but no INSERT/UPDATE. A frozen
# single-transaction dump also preserves routines, triggers and events.
docker run --rm --network nazraa_private --env-file "$source_env" mariadb:11.8.9 \
  sh -c '
    ssl_option=""
    if [ "$DB_SSL" = "true" ]; then ssl_option="--ssl"; fi
    MYSQL_PWD="$DB_PASSWORD" exec mariadb-dump \
      -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" \
      ${ssl_option} --single-transaction --quick --skip-lock-tables \
      --routines --triggers --events --default-character-set=utf8mb4 \
      "$DB_NAME"
  ' | gzip -1 > "$tmp"

if [[ ! -s $tmp ]]; then
  echo 'Dump is empty; refusing final export.' >&2
  exit 1
fi
gzip -t "$tmp"
mv -- "$tmp" "$backup"
chmod 0600 "$backup"
sha256sum "$backup"
