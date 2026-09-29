#!/usr/bin/env bash
set -euo pipefail

# Import the post-freeze production snapshot into a NEW, empty MariaDB schema.
# This script never replaces staging data or enables application writes.

if [[ $# -ne 3 || ! $2 =~ ^[0-9a-fA-F]{64}$ || ! $3 =~ ^nazraa_final_[0-9]{8}_[0-9]{6}$ ]]; then
  echo 'Usage: restore-final.sh /opt/nazraa/backups/FINAL.sql.gz EXPECTED_SHA256 nazraa_final_YYYYMMDD_HHMMSS' >&2
  exit 2
fi
if [[ ${NAZRAA_WRITE_FREEZE_CONFIRMED:-} != 1 ]]; then
  echo 'Authoritative source write freeze has not been confirmed. Import not started.' >&2
  exit 1
fi

backup_path=$1
expected_sha=$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')
target_schema=$3
db_container=${NAZRAA_MARIADB_CONTAINER:-nazraa-mariadb-staging}

if [[ $backup_path != /opt/nazraa/backups/* || ! -f $backup_path || ! -r $backup_path ]]; then
  echo 'Final backup must be a readable file under /opt/nazraa/backups.' >&2
  exit 1
fi
if [[ $db_container != nazraa-mariadb-staging ]]; then
  echo 'Unexpected database container. Import not started.' >&2
  exit 1
fi

actual_sha=$(sha256sum "$backup_path" | cut -d' ' -f1)
if [[ $actual_sha != "$expected_sha" ]]; then
  echo 'Backup checksum mismatch. Import not started.' >&2
  exit 1
fi
gzip -t "$backup_path"

# A dump made with --databases can silently change schema mid-stream. Import
# only a single-database dump with no CREATE DATABASE or USE statements.
if gzip -dc "$backup_path" | awk '
  toupper($0) ~ /^[[:space:]]*(CREATE[[:space:]]+DATABASE|USE[[:space:]]+[`[:alnum:]_])/ { bad=1 }
  END { exit bad ? 0 : 1 }
'; then
  echo 'Dump contains a database-switch/create statement. Import not started.' >&2
  exit 1
fi

db_query() {
  docker exec -i "$db_container" sh -c \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb -N -B -uroot' <<< "$1"
}

engine=$(docker inspect -f '{{.Config.Image}}' "$db_container")
if [[ $engine != mariadb:11.8.9 ]]; then
  echo 'Unexpected MariaDB image. Import not started.' >&2
  exit 1
fi

existing=$(db_query "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = '$target_schema';")
if [[ $existing != 0 ]]; then
  echo 'Target schema already exists. Refusing non-idempotent import.' >&2
  exit 1
fi

db_query "CREATE DATABASE \`$target_schema\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo "Created empty $target_schema; importing verified post-freeze snapshot."
gzip -dc "$backup_path" | docker exec -i "$db_container" sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb -uroot "$1"' -- "$target_schema"

table_count=$(db_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$target_schema';")
echo "Import completed with $table_count tables. Keep application writes disabled until financial reconciliation passes."
