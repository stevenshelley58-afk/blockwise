#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

PRODUCT_ROOT="${BLOCKWISE_PRODUCT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
COMPOSE_FILE="${BLOCKWISE_PRODUCT_COMPOSE_FILE:-$PRODUCT_ROOT/infra/coolify/docker-compose.product.yml}"
ENV_FILE="${BLOCKWISE_PRODUCT_ENV_FILE:-$PRODUCT_ROOT/infra/product/.env}"
BACKUP_DIR="${BLOCKWISE_BACKUP_DIR:-$PRODUCT_ROOT/.secrets/product-backups}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing product env file: $ENV_FILE" >&2
  echo "Copy infra/product/.env.example and inject values from Infisical." >&2
  exit 2
fi

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
compose_with_all_profiles() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile worker --profile realtime --profile edge --profile mail "$@"
}

stop_product_writers() {
  local running service target
  local -a active=()
  local -a targets=(product-worker product-app product-caddy product-realtime product-storage product-auth product-rest)
  # Include profile-gated services so a worker left running from a prior
  # cutover cannot be invisible to the quiescence check.
  running="$(compose_with_all_profiles ps --status running --services)"
  for service in "${targets[@]}"; do
    if grep -Fxq "$service" <<< "$running"; then
      active+=("$service")
    fi
  done
  if ((${#active[@]} > 0)); then
    compose_with_all_profiles stop "${active[@]}"
  fi
  running="$(compose_with_all_profiles ps --status running --services)"
  for target in "${targets[@]}"; do
    if grep -Fxq "$target" <<< "$running"; then
      echo "Refusing database operation: $target is still running" >&2
      return 2
    fi
  done
}

# Read one KEY=VALUE entry without evaluating the file. This is deliberately
# small: host-side scripts only need a few values and must never source a
# rendered secret file.
read_env_value() {
  local key="$1" line value
  [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || return 2
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*${key}[[:space:]]*=(.*)$ ]] || continue
    value="${BASH_REMATCH[1]}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then value="${value:1:${#value}-2}"; fi
    if [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then value="${value:1:${#value}-2}"; fi
    printf '%s' "$value"
    return 0
  done < "$ENV_FILE"
  return 1
}

load_env_values() {
  # Do not source the rendered secret file: shell evaluation would execute
  # arbitrary content and would misparse passwords containing shell syntax.
  BLOCKWISE_DB_USER="$(read_env_value BLOCKWISE_DB_USER)"
  BLOCKWISE_DB_NAME="$(read_env_value BLOCKWISE_DB_NAME)"
  BLOCKWISE_DB_PASSWORD="$(read_env_value BLOCKWISE_DB_PASSWORD)"
  : "${BLOCKWISE_DB_USER:?BLOCKWISE_DB_USER missing from env}"
  : "${BLOCKWISE_DB_NAME:?BLOCKWISE_DB_NAME missing from env}"
  : "${BLOCKWISE_DB_PASSWORD:?BLOCKWISE_DB_PASSWORD missing from env}"
  BLOCKWISE_DB_AUTHENTICATOR_PASSWORD="$(read_env_value BLOCKWISE_DB_AUTHENTICATOR_PASSWORD)"
  : "${BLOCKWISE_DB_AUTHENTICATOR_PASSWORD:?BLOCKWISE_DB_AUTHENTICATOR_PASSWORD missing from env}"
  [[ "$BLOCKWISE_DB_USER" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "BLOCKWISE_DB_USER must be a safe SQL identifier" >&2; exit 2; }
  [[ "$BLOCKWISE_DB_NAME" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "BLOCKWISE_DB_NAME must be a safe SQL identifier" >&2; exit 2; }
  [[ "$BLOCKWISE_DB_PASSWORD" =~ ^[A-Za-z0-9._~-]+$ ]] || { echo "BLOCKWISE_DB_PASSWORD must be URL-safe" >&2; exit 2; }
  [[ "$BLOCKWISE_DB_AUTHENTICATOR_PASSWORD" =~ ^[A-Za-z0-9._~-]+$ ]] || { echo "BLOCKWISE_DB_AUTHENTICATOR_PASSWORD must be URL-safe" >&2; exit 2; }
}
load_env_values
