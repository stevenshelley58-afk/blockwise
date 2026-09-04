#!/bin/sh
set -eu
install -d -o nextjs -g nodejs -m 700 /run/blockwise-secrets
install -o nextjs -g nodejs -m 600 /run/secrets/supabase-service-role-source /run/blockwise-secrets/supabase-service-role
install -o nextjs -g nodejs -m 600 /run/secrets/snagtime-webhook-source /run/blockwise-secrets/snagtime-webhook
install -o nextjs -g nodejs -m 600 /run/secrets/chatwoot-webhook-source /run/blockwise-secrets/chatwoot-webhook
exec gosu nextjs "$@"
