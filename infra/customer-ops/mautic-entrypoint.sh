#!/bin/sh
set -eu
export MAUTIC_DB_PASSWORD="$(cat /run/secrets/mautic_db_password)"
export SMTP_PASSWORD="$(cat /run/secrets/mautic_smtp_password)"
smtp_user_encoded="$(printf '%s' "$SMTP_USER" | php -r 'echo rawurlencode(stream_get_contents(STDIN));')"
smtp_password_encoded="$(php -r 'echo rawurlencode(stream_get_contents(STDIN));' < /run/secrets/mautic_smtp_password)"
export MAUTIC_MAILER_DSN="smtp://${smtp_user_encoded}:${smtp_password_encoded}@${SMTP_HOST}:${SMTP_PORT}?encryption=tls&auth_mode=login"
exec /entrypoint.sh "$@"
