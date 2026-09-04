#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
usage: customer-ops-install.sh --env-file /etc/blockwise/customer-ops/customer-ops.env [--check|--apply] [--post-edge-tls]

--check (default) validates prerequisites and rendered Compose without starting services.
--apply additionally starts the isolated customer-ops Compose project.
--post-edge-tls validates public HTTPS certificates after the shared edge routes exist.
EOF
}

MODE=check
ENV_FILE=''
POST_EDGE_TLS=0
while (($#)); do
  case "$1" in
    --env-file) [[ $# -ge 2 ]] || { usage; exit 64; }; ENV_FILE="$2"; shift 2 ;;
    --check) MODE=check; shift ;;
    --apply) MODE=apply; shift ;;
    --post-edge-tls) POST_EDGE_TLS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 64 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo 'customer-ops installer must run as root' >&2; exit 77; }
[[ -n "$ENV_FILE" && -f "$ENV_FILE" ]] || { echo 'a readable --env-file is required' >&2; exit 64; }
[[ "$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")" == '600' ]] || { echo 'env file must have mode 0600' >&2; exit 64; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/customer-ops/docker-compose.yml"
SECRETS_DIR="${CUSTOMER_OPS_SECRETS_DIR:-/etc/blockwise/customer-ops/secrets}"
export COMPOSE_PROJECT_NAME=blockwise-customer-ops

command -v docker >/dev/null || { echo 'docker is required' >&2; exit 69; }
docker compose version >/dev/null || { echo 'docker compose plugin is required' >&2; exit 69; }
command -v getent >/dev/null || { echo 'getent is required for DNS validation' >&2; exit 69; }
command -v openssl >/dev/null || { echo 'openssl is required for TLS validation' >&2; exit 69; }
command -v nc >/dev/null || { echo 'nc is required for port validation' >&2; exit 69; }
command -v ss >/dev/null || { echo 'ss is required for port validation' >&2; exit 69; }

# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a
SECRETS_DIR="${CUSTOMER_OPS_SECRETS_DIR:-$SECRETS_DIR}"
export CUSTOMER_OPS_SECRETS_DIR="$SECRETS_DIR"
required_vars=(MAIL_HOST MAUTIC_HOST CHATWOOT_HOST SNAGTIME_HOST GOOGLE_CLIENT_ID SMTP_USER EMAIL_FROM EMAIL_REPLY_TO SNAGTIME_IMAGE SNAGTIME_REVISION)
for name in "${required_vars[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "missing required setting: $name" >&2; exit 64; }
done
[[ "$SNAGTIME_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'SNAGTIME_REVISION must be a full lowercase Git SHA' >&2; exit 64; }
[[ "$SNAGTIME_IMAGE" != *:latest && ( "$SNAGTIME_IMAGE" == *@sha256:* || "$SNAGTIME_IMAGE" == *:"$SNAGTIME_REVISION" ) ]] || { echo 'SNAGTIME_IMAGE must be immutable (digest or full revision tag)' >&2; exit 64; }

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"
secret_names=(postgres_owner_password chatwoot_db_password snagtime_db_password mautic_db_root_password mautic_db_password chatwoot_secret_key_base snagtime_auth_secret snagtime_token_encryption_key stalwart_recovery_admin)
for secret in "${secret_names[@]}"; do
  path="$SECRETS_DIR/$secret"
  if [[ ! -e "$path" ]]; then
    umask 077
    if [[ "$secret" == stalwart_recovery_admin ]]; then
      printf 'admin:%s\n' "$(openssl rand -hex 32)" > "$path"
    else
      openssl rand -hex 48 > "$path"
    fi
  fi
  [[ -f "$path" && "$(stat -c '%a' "$path" 2>/dev/null || stat -f '%Lp' "$path")" == '600' ]] || { echo "secret file must be a regular mode-0600 file: $path" >&2; exit 64; }
done
for secret in google_client_secret smtp_password; do
  path="$SECRETS_DIR/$secret"
  [[ -s "$path" && "$(stat -c '%a' "$path" 2>/dev/null || stat -f '%Lp' "$path")" == '600' ]] || { echo "provider credential must pre-exist as mode-0600 file: $path" >&2; exit 64; }
done

write_url_secret() {
  local path="$1" user="$2" db="$3" password_file="$4"
  if [[ ! -e "$path" ]]; then
    umask 077
    password="$(<"$password_file")"
    password="${password//%/%25}"; password="${password//\//%2F}"; password="${password//:/%3A}"; password="${password//+/%2B}"; password="${password//=/%3D}"; password="${password//$'\n'/}"
    printf 'postgresql://%s:%s@postgres:5432/%s?connect_timeout=3\n' "$user" "$password" "$db" > "$path"
  fi
  chmod 600 "$path"
}
write_url_secret "$SECRETS_DIR/snagtime_database_url" snagtime snagtime "$SECRETS_DIR/snagtime_db_password"

for host in "$MAIL_HOST" "$MAUTIC_HOST" "${CHATWOOT_HOST#https://}" "${CHATWOOT_HOST#http://}" "$SNAGTIME_HOST"; do
  host="${host%%/*}"; host="${host%%:*}"
  getent ahosts "$host" >/dev/null || { echo "DNS does not resolve: $host" >&2; exit 65; }
done

if [[ "$POST_EDGE_TLS" == 1 ]]; then
  for url in "https://$MAIL_HOST" "https://$MAUTIC_HOST" "$CHATWOOT_HOST" "https://$SNAGTIME_HOST"; do
    host="${url#https://}"; host="${host%%/*}"; host="${host%%:*}"
    timeout 12 openssl s_client -connect "$host:443" -servername "$host" -verify_return_error </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer >/dev/null || { echo "TLS certificate validation failed: $host" >&2; exit 65; }
  done
fi

check_port_free() {
  local port="$1"
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${port}$"; then
    echo "required host TCP port is already in use: $port" >&2; exit 66
  fi
}
if [[ "$MODE" == check && "$POST_EDGE_TLS" == 0 ]]; then
  for port in "${STALWART_SMTP_PORT:-25}" "${STALWART_SUBMISSION_PORT:-587}" "${STALWART_SMTPS_PORT:-465}" "${STALWART_IMAPS_PORT:-993}"; do check_port_free "$port"; done
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
if [[ "$MODE" == apply ]]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans
fi
echo "customer-ops ${MODE} checks passed; credentials were not printed"
