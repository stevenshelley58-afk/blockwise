#!/bin/sh
set -eu
install -d -o worker -g worker -m 700 /run/blockwise-secrets
for name in supabase-service-role mautic-token chatwoot-api-token ops-correlation-key; do
  install -o worker -g worker -m 600 "/run/secrets/${name}-source" "/run/blockwise-secrets/$name"
done
exec gosu worker tini -- "$@"
