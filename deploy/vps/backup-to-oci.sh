#!/usr/bin/env bash
set -euo pipefail

# Install/schedule only after the one-writer cutover. OCI Object Storage must
# remain a private bucket with Oracle-managed encryption enabled. The OCI CLI
# profile should be a dedicated bucket-scoped backup identity, never the
# tenancy administrator. No database or OCI credential is written to a dump.

umask 077

if [[ ${EUID} -ne 0 ]]; then
  echo 'Run as root so backup files and OCI credentials stay private.' >&2
  exit 2
fi
if [[ ${NAZRAA_BACKUP_PRODUCTION_CONFIRMED:-} != 1 ]]; then
  echo 'Production database authority is not confirmed; refusing backup.' >&2
  exit 2
fi

db_container=${NAZRAA_BACKUP_DB_CONTAINER:-}
db_name=${NAZRAA_BACKUP_DB_NAME:-}
bucket=${NAZRAA_BACKUP_OCI_BUCKET:-}
config_file=${OCI_CLI_CONFIG_FILE:-}
backup_dir=/opt/nazraa/backups/production

if [[ ! $db_container =~ ^nazraa-[a-z0-9-]+$ || ! $db_name =~ ^nazraa_final_[0-9]{8}_[0-9]{6}$ || ! $bucket =~ ^[A-Za-z0-9._-]{3,128}$ ]]; then
  echo 'Container, authoritative schema, or backup bucket is missing/invalid.' >&2
  exit 2
fi
if [[ ! -f $config_file || ! -r $config_file ]]; then
  echo 'Root-readable OCI CLI config is missing.' >&2
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
  echo 'Unexpected database engine; refusing backup.' >&2
  exit 2
fi

oci_args=(--config-file "$config_file" --region ap-mumbai-1)
public_access=$(oci os bucket get "${oci_args[@]}" --bucket-name "$bucket" \
  --query 'data."public-access-type"' --raw-output)
if [[ $public_access != NoPublicAccess ]]; then
  echo 'Backup bucket is not confirmed private; refusing upload.' >&2
  exit 2
fi

install -d -m 0700 "$backup_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
tag=${NAZRAA_BACKUP_TAG:-nightly}
if [[ $tag != nightly && $tag != predeploy ]]; then
  echo 'Invalid backup tag.' >&2
  exit 2
fi
base="nazraa-${tag}-${timestamp}"
tmp=$(mktemp "$backup_dir/.${base}.XXXXXX")
trap 'rm -f -- "$tmp"' EXIT
backup="$backup_dir/${base}.sql.gz"
if [[ -e $backup || -e ${backup}.sha256 ]]; then
  echo 'A backup with this timestamp already exists; refusing overwrite.' >&2
  exit 1
fi

# --single-transaction captures InnoDB tables consistently without locking
# normal application writes. Fail the whole pipeline if dump or gzip fails.
docker exec "$db_container" sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb-dump -uroot --single-transaction --quick --skip-lock-tables --routines --triggers --events --default-character-set=utf8mb4 "$1"' \
  -- "$db_name" | gzip -1 > "$tmp"
gzip -t "$tmp"
if [[ ! -s $tmp ]]; then
  echo 'Empty backup; refusing upload.' >&2
  exit 1
fi
mv -- "$tmp" "$backup"
sha256sum "$backup" > "${backup}.sha256"
chmod 0600 "$backup" "${backup}.sha256"

# OCI verifies the uploaded file checksum. The separate checksum manifest
# makes an eventual offsite restore independently verifiable.
# Use single-part immutable PUTs. The bucket-scoped backup identity has
# OBJECT_CREATE but deliberately lacks OBJECT_OVERWRITE, which OCI requires
# even to initiate multipart uploads. Each timestamped object is unique;
# --no-overwrite remains a second guard against accidental replacement.
oci os object put "${oci_args[@]}" --bucket-name "$bucket" \
  --name "production/${base}.sql.gz" --file "$backup" \
  --no-multipart --verify-checksum --no-overwrite --output json >/dev/null
oci os object put "${oci_args[@]}" --bucket-name "$bucket" \
  --name "production/${base}.sql.gz.sha256" --file "${backup}.sha256" \
  --no-multipart --verify-checksum --no-overwrite --output json >/dev/null
oci os object head "${oci_args[@]}" --bucket-name "$bucket" \
  --name "production/${base}.sql.gz" --output json >/dev/null

echo "Offsite backup verified: $base (${db_name}, $(stat -c '%s' "$backup") bytes)."
