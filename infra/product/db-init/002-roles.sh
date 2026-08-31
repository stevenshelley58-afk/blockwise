#!/usr/bin/env bash
set -Eeuo pipefail
: "${BLOCKWISE_DB_AUTHENTICATOR_PASSWORD:?BLOCKWISE_DB_AUTHENTICATOR_PASSWORD is required}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v authenticator_password="$BLOCKWISE_DB_AUTHENTICATOR_PASSWORD" <<'SQL'
ALTER ROLE authenticator PASSWORD :'authenticator_password';
SQL
