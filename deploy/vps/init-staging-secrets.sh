#!/usr/bin/env bash
set -euo pipefail

if [[ $(id -u) -ne 0 ]]; then
  echo 'Run as root on the dedicated Nazraa VPS.' >&2
  exit 1
fi

config_dir=/opt/nazraa/config
install -d -m 0700 -o root -g root "$config_dir"
if [[ -e "$config_dir/mysql.env" || -e "$config_dir/app.env" ]]; then
  echo 'Existing Nazraa secret files were not modified.' >&2
  exit 1
fi

umask 077
mysql_root_password=$(openssl rand -hex 32)
mysql_app_password=$(openssl rand -hex 32)
realtime_internal_secret=$(openssl rand -hex 32)

{
  printf 'MYSQL_DATABASE=nazraa\n'
  printf 'MYSQL_USER=nazraa_app\n'
  printf 'MYSQL_PASSWORD=%s\n' "$mysql_app_password"
  printf 'MYSQL_ROOT_PASSWORD=%s\n' "$mysql_root_password"
} > "$config_dir/mysql.env"

{
  printf 'DB_HOST=mysql\n'
  printf 'DB_PORT=3306\n'
  printf 'DB_NAME=nazraa\n'
  printf 'DB_USER=nazraa_app\n'
  printf 'DB_PASSWORD=%s\n' "$mysql_app_password"
  printf 'DB_SSL=false\n'
  printf 'REALTIME_INTERNAL_SECRET=%s\n' "$realtime_internal_secret"
} > "$config_dir/app.env"

chmod 0600 "$config_dir/mysql.env" "$config_dir/app.env"
unset mysql_root_password mysql_app_password realtime_internal_secret
echo 'Private staging credentials created; values are not printed.'
