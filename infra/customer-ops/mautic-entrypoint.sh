#!/bin/sh
set -eu
export MAUTIC_DB_PASSWORD="$(cat /run/secrets/mautic_db_password)"
export SMTP_PASSWORD="$(cat /run/secrets/mautic_smtp_password)"
smtp_user_encoded="$(php -r 'echo rawurlencode($argv[1]);' "$SMTP_USER")"
smtp_password_encoded="$(php -r 'echo rawurlencode($argv[1]);' "$SMTP_PASSWORD")"
export MAUTIC_MAILER_DSN="smtp://${smtp_user_encoded}:${smtp_password_encoded}@${SMTP_HOST}:${SMTP_PORT}?encryption=tls&auth_mode=login"
exec /entrypoint.sh "$@"
