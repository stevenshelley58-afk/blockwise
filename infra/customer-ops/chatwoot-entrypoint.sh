#!/bin/sh
set -eu

# Chatwoot's Rails runtime accepts the conventional values, while this wrapper
# reads them from Docker secret files without placing them in Compose or git.
export POSTGRES_PASSWORD="$(cat /run/secrets/chatwoot_db_password)"
export SECRET_KEY_BASE="$(cat /run/secrets/chatwoot_secret_key_base)"
exec /docker/entrypoints/rails.sh "$@"
