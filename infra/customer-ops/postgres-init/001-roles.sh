#!/bin/sh
set -eu

read_secret() {
  value="$(cat "$1")"
  test -n "$value"
  printf '%s' "$value"
}

owner_password="$(read_secret /run/secrets/postgres_owner_password)"
chatwoot_password="$(read_secret /run/secrets/chatwoot_db_password)"
snagtime_password="$(read_secret /run/secrets/snagtime_db_password)"

export PGPASSWORD="$owner_password"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=chatwoot_password="$chatwoot_password" \
  --set=snagtime_password="$snagtime_password" \
  <<'SQL'
CREATE DATABASE chatwoot;
CREATE DATABASE snagtime;
CREATE ROLE chatwoot LOGIN PASSWORD :'chatwoot_password';
CREATE ROLE snagtime LOGIN PASSWORD :'snagtime_password';
GRANT ALL PRIVILEGES ON DATABASE chatwoot TO chatwoot;
GRANT ALL PRIVILEGES ON DATABASE snagtime TO snagtime;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname chatwoot -c \
  'GRANT USAGE, CREATE ON SCHEMA public TO chatwoot;'
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname snagtime -c \
  'GRANT USAGE, CREATE ON SCHEMA public TO snagtime;'
unset PGPASSWORD owner_password chatwoot_password snagtime_password
