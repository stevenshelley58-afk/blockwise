#!/bin/sh
set -eu

if [ -n "${HERMES_DEFAULT_MODEL:-}" ]; then
  mkdir -p "${HERMES_HOME:-/opt/data}"
  cat > "${HERMES_HOME:-/opt/data}/config.yaml" <<EOF
model:
  provider: "${HERMES_PROVIDER:-openrouter}"
  default: "${HERMES_DEFAULT_MODEL}"
  base_url: "${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}"
hooks_auto_accept: true
EOF
fi

if [ "${BLOCKWISE_RESEARCH_RUNTIME_ENABLED:-true}" = "true" ]; then
  node /app/research-runtime/bin/supabase-supervisor.mjs &
fi

exec /opt/hermes/docker/main-wrapper.sh "$@"
