#!/usr/bin/env bash
set -euo pipefail

# Import a verified Hostinger snapshot only into the isolated, empty VPS DB.
# This script is deliberately one-shot: a failed partial import needs a fresh
# staging database, never a blind rerun over existing financial records.

if [[ $# -ne 2 || ! $2 =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo 'Usage: restore-staging.sh /absolute/path/source.sql.gz EXPECTED_SHA256' >&2
  exit 2
fi

backup_path=$1
expected_sha=${2,,}
stack_dir=/opt/nazraa

if [[ ! -f $backup_path || ! -r $backup_path ]]; then
  echo 'Backup is missing or unreadable.' >&2
  exit 1
fi
if [[ ! -f $stack_dir/config/mysql.env ]]; then
  echo 'Staging database configuration is missing.' >&2
  exit 1
fi

actual_sha=$(sha256sum "$backup_path" | cut -d' ' -f1)
if [[ $actual_sha != "$expected_sha" ]]; then
  echo 'Backup checksum mismatch. Import not started.' >&2
  exit 1
fi
gzip -t "$backup_path"

cd "$stack_dir"
query_db() {
  docker compose exec -T mysql sh -c \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb -N -B -uroot nazraa' <<< "$1"
}

table_count=$(query_db "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();")
if [[ $table_count != 0 ]]; then
  echo "Staging database already contains $table_count tables. Import not started." >&2
  exit 1
fi

echo 'Checksum and empty-target checks passed; importing private staging snapshot.'
gzip -dc "$backup_path" | docker compose exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb -uroot nazraa'

query_db 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();'
query_db 'SELECT COUNT(*) FROM control_schema_migrations;'
echo 'Staging import finished. Reconcile financial totals before any cutover.'
