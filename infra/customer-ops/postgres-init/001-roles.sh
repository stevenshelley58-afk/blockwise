#!/bin/sh
set -eu

read_secret() {
  value="$(cat "$1")"
  test -n "$value"
  printf '%s' "$value"
}

owner_password="$(read_secret /run/secrets/postgres_owner_password)"

# Keep role passwords out of psql arguments and process listings.  The SQL file
# is mode 0600 and is removed as soon as the initial database setup completes.
role_sql="$(mktemp /tmp/customer-ops-postgres-init.XXXXXX)"
chmod 600 "$role_sql"
trap 'rm -f "$role_sql"' EXIT

append_sql_literal() {
  printf "'"
  awk '{ gsub(/\047/, "\047\047"); printf "%s", $0 }' "$1"
  printf "'"
}

{
  cat <<'SQL'
CREATE DATABASE chatwoot;
CREATE DATABASE snagtime;
CREATE ROLE chatwoot LOGIN PASSWORD
SQL
  append_sql_literal /run/secrets/chatwoot_db_password
  printf '%s\n' ';'
  printf '%s' 'CREATE ROLE snagtime LOGIN PASSWORD '
  append_sql_literal /run/secrets/snagtime_db_password
  printf '%s\n' ';'
  cat <<'SQL'
GRANT ALL PRIVILEGES ON DATABASE chatwoot TO chatwoot;
GRANT ALL PRIVILEGES ON DATABASE snagtime TO snagtime;
SQL
} > "$role_sql"

export PGPASSWORD="$owner_password"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --file "$role_sql"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname chatwoot -c \
  'GRANT USAGE, CREATE ON SCHEMA public TO chatwoot;'
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname snagtime -c \
  'GRANT USAGE, CREATE ON SCHEMA public TO snagtime;'
unset PGPASSWORD owner_password
