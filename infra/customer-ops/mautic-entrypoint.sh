#!/bin/sh
set -eu
export MAUTIC_DB_PASSWORD="$(cat /run/secrets/mautic_db_password)"
exec /entrypoint.sh "$@"
