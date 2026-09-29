#!/usr/bin/env bash
set -euo pipefail

# Download one offsite object and its SHA manifest, then import it into a new,
# isolated schema. This never changes the application's database pointer.

umask 077
if [[ ${EUID} -ne 0 || $# -ne 2 ]]; then
  echo 'Usage (root): verify-oci-restore.sh nazraa-nightly-YYYYMMDDTHHMMSSZ nazraa_restorecheck_YYYYMMDD_HHMMSS' >&2
  exit 2
fi

base=$1
target_schema=$2
db_container=${NAZRAA_BACKUP_DB_CONTAINER:-}
bucket=${NAZRAA_BACKUP_OCI_BUCKET:-}
config_file=${OCI_CLI_CONFIG_FILE:-}
restore_dir=/opt/nazraa/backups/restorechecks

if [[ ! $base =~ ^nazraa-(nightly|predeploy)-[0-9]{8}T[0-9]{6}Z$ ||
      ! $target_schema =~ ^nazraa_restorecheck_[0-9]{8}_[0-9]{6}$ ||
      ! $db_container =~ ^nazraa-[a-z0-9-]+$ ||
      ! $bucket =~ ^[A-Za-z0-9._-]{3,128}$ ||
      ! -r $config_file ]]; then
  echo 'Restore target or private backup configuration is missing/invalid.' >&2
  exit 2
fi
if [[ $(stat -c '%a' "$config_file") != 600 ]]; then
  echo 'OCI CLI config must have mode 0600.' >&2
  exit 2
fi
for executable in docker oci gzip sha256sum; do
  command -v "$executable" >/dev/null || { echo "Missing $executable." >&2; exit 2; }
done

image=$(docker inspect -f '{{.Config.Image}}' "$db_container")
if [[ $image != mariadb:11.8.9 ]]; then
  echo 'Unexpected database engine; refusing restore.' >&2
  exit 2
fi

db_query() {
  docker exec -i "$db_container" sh -c \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb -N -B -uroot' <<< "$1"
}
existing=$(db_query "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = '$target_schema';")
if [[ $existing != 0 ]]; then
  echo 'Restore-check schema already exists; refusing overwrite.' >&2
  exit 2
fi

install -d -m 0700 "$restore_dir"
backup="$restore_dir/${base}.sql.gz"
manifest="${backup}.sha256"
if [[ -e $backup || -e $manifest ]]; then
  echo 'Restore-check files already exist; refusing overwrite.' >&2
  exit 2
fi

oci_args=(--config-file "$config_file" --region ap-mumbai-1)
oci os object get "${oci_args[@]}" --bucket-name "$bucket" \
  --name "production/${base}.sql.gz.sha256" --file "$manifest" --output json >/dev/null
oci os object get "${oci_args[@]}" --bucket-name "$bucket" \
  --name "production/${base}.sql.gz" --file "$backup" --output json >/dev/null
chmod 0600 "$manifest" "$backup"

expected_sha=$(awk 'NR == 1 { print $1 }' "$manifest")
actual_sha=$(sha256sum "$backup" | cut -d' ' -f1)
if [[ ! $expected_sha =~ ^[0-9a-fA-F]{64}$ || $actual_sha != "${expected_sha,,}" ]]; then
  echo 'Offsite backup checksum mismatch; import not started.' >&2
  exit 1
fi
gzip -t "$backup"
if gzip -dc "$backup" | awk '
  toupper($0) ~ /^[[:space:]]*(CREATE[[:space:]]+DATABASE|USE[[:space:]]+[`[:alnum:]_])/ { bad=1 }
  END { exit bad ? 0 : 1 }
'; then
  echo 'Offsite dump contains database-switch/create statements; import not started.' >&2
  exit 1
fi

db_query "CREATE DATABASE \`$target_schema\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
gzip -dc "$backup" | docker exec -i "$db_container" sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb -uroot "$1"' -- "$target_schema"

table_count=$(db_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$target_schema';")
if [[ $table_count -lt 100 ]]; then
  echo "Restore imported only $table_count tables; investigate before cutover." >&2
  exit 1
fi
echo "Offsite restore imported $table_count tables into isolated schema $target_schema."
