#!/command/with-contenv sh
# shellcheck shell=sh
set -e

export HOME=/opt/data

if [ -n "${HERMES_DEFAULT_MODEL:-}" ]; then
  mkdir -p "${HERMES_HOME:-/opt/data}"
  cat > "${HERMES_HOME:-/opt/data}/config.yaml" <<EOF
model:
  provider: "${HERMES_PROVIDER:-openrouter}"
  default: "${HERMES_DEFAULT_MODEL}"
  base_url: "${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}"
hooks_auto_accept: true
EOF
  chown hermes:hermes "${HERMES_HOME:-/opt/data}/config.yaml" 2>/dev/null || true
fi

if [ "${BLOCKWISE_RESEARCH_RUNTIME_ENABLED:-true}" = "true" ]; then
  (
    set +e
    while :; do
      printf '%s\n' "[blockwise-research-runtime] starting supervisor" >&2
      s6-setuidgid hermes node /app/research-runtime/bin/supabase-supervisor.mjs
      status=$?
      printf '%s\n' "[blockwise-research-runtime] supervisor exited with status ${status}; restarting in 15s" >&2
      sleep 15
    done
  ) &
fi

cd /opt/data
. /opt/hermes/.venv/bin/activate

if [ $# -eq 0 ]; then
  exec s6-setuidgid hermes hermes
fi

if command -v "$1" >/dev/null 2>&1; then
  exec s6-setuidgid hermes "$@"
fi

exec s6-setuidgid hermes hermes "$@"
