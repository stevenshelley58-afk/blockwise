#!/bin/sh
set -eu
install -d -o nextjs -g nodejs -m 700 /run/blockwise-secrets
install -o nextjs -g nodejs -m 600 /run/secrets/supabase-service-role-source /run/blockwise-secrets/supabase-service-role
exec gosu nextjs "$@"
