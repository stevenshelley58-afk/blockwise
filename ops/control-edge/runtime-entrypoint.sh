#!/bin/sh
set -eu
install -d -m 700 /run/blockwise-secrets
for name in internal-auth supabase-service-role action-executor; do
  install -o node -g node -m 600 "/run/secrets/${name}-source" "/run/blockwise-secrets/$name"
done
exec su-exec node "$@"
