#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 || ${NAZRAA_WRITE_FREEZE_CONFIRMED:-} != 1 ]]; then
  echo 'Root and a confirmed old-writer freeze are required.' >&2
  exit 2
fi
schema=${1:-}
if [[ ! $schema =~ ^nazraa_final_[0-9]{8}_[0-9]{6}$ ]]; then
  echo 'Expected a verified nazraa_final_YYYYMMDD_HHMMSS schema.' >&2
  exit 2
fi
report="/opt/nazraa/backups/reconcile-${schema}.json"
env_file=/opt/nazraa/config/app.env
if [[ ! -f $report || ! -f $env_file || $(stat -c '%a' "$env_file") != 600 ]]; then
  echo 'Private application configuration or reconciliation report is missing.' >&2
  exit 2
fi
if ! jq -e '.status == "MATCH" and .mode == "final" and .sourceTables == .targetTables and .sourceTables > 0 and (.mismatchedSections | length) == 0' "$report" >/dev/null; then
  echo 'Final financial reconciliation is not a complete match.' >&2
  exit 1
fi
old_status=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' https://nazraa.vercel.app/api/v1/config)
if [[ $old_status != 503 ]]; then
  echo 'Old Vercel mobile API is not fenced; refusing database promotion.' >&2
  exit 1
fi

app_user=$(sed -n 's/^DB_USER=//p' "$env_file")
if [[ ! $app_user =~ ^[A-Za-z0-9_]+$ ]]; then
  echo 'Application DB user is missing or unsafe.' >&2
  exit 2
fi
db_container=nazraa-mysql-1
if [[ $(docker inspect -f '{{.Config.Image}}' "$db_container") != mariadb:11.8.9 ]]; then
  echo 'Unexpected database engine.' >&2
  exit 2
fi
printf 'GRANT ALL PRIVILEGES ON `%s`.* TO `%s`@`%%`;\n' "$schema" "$app_user" |
  docker exec -i "$db_container" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb -uroot'

if grep -q "^DB_NAME=$schema$" "$env_file"; then
  echo "Final database already selected: $schema"
  exit 0
fi
backup="${env_file}.pre-cutover-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p -- "$env_file" "$backup"
umask 077
tmp=$(mktemp /opt/nazraa/config/.app-env-final.XXXXXX)
trap 'rm -f -- "$tmp"' EXIT
awk -v schema="$schema" '
  BEGIN { replacements=0 }
  /^DB_NAME=/ { print "DB_NAME=" schema; replacements++; next }
  { print }
  END { if (replacements != 1) exit 1 }
' "$env_file" > "$tmp"
install -m 0600 "$tmp" "$env_file"
echo "Selected verified final schema: $schema"
