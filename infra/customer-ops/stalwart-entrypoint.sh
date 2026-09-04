#!/bin/sh
set -eu
export STALWART_RECOVERY_ADMIN="$(cat /run/secrets/stalwart_recovery_admin)"
exec /usr/local/bin/stalwart "$@"
