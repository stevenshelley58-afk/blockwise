#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
usage: customer-ops-install.sh --env-file /etc/blockwise/customer-ops/customer-ops.env [--check|--apply] [--post-edge-tls]

--check (default) validates prerequisites and rendered Compose without starting services.
--apply additionally starts the isolated customer-ops Compose project.
--post-edge-tls validates public HTTPS/SMTP certificates after the shared edge routes exist.
--render-caddy FILE renders the hostname-safe edge snippet outside the checkout.
EOF
}

MODE=check
ENV_FILE=''
PRODUCT_MAIL_NETWORK='blockwise-customer-ops-mail'
POST_EDGE_TLS=0
CADDY_OUTPUT=''
while (($#)); do
  case "$1" in
    --env-file) [[ $# -ge 2 ]] || { usage; exit 64; }; ENV_FILE="$2"; shift 2 ;;
    --check) MODE=check; shift ;;
    --apply) MODE=apply; shift ;;
    --post-edge-tls) POST_EDGE_TLS=1; shift ;;
    --render-caddy) [[ $# -ge 2 ]] || { usage; exit 64; }; CADDY_OUTPUT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 64 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo 'customer-ops installer must run as root' >&2; exit 77; }
[[ -n "$ENV_FILE" && -f "$ENV_FILE" && ! -L "$ENV_FILE" && "$ENV_FILE" = /* ]] || { echo 'a readable absolute, regular --env-file is required' >&2; exit 64; }
[[ "$(readlink -f -- "$ENV_FILE")" == "$ENV_FILE" ]] || { echo 'env file may not contain symlinked path components' >&2; exit 64; }
[[ "$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")" == '600' ]] || { echo 'env file must have mode 0600' >&2; exit 64; }
[[ "$(stat -c '%u' "$ENV_FILE" 2>/dev/null || stat -f '%u' "$ENV_FILE")" == '0' ]] || { echo 'env file must be owned by root' >&2; exit 64; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/customer-ops/docker-compose.yml"
CADDY_TEMPLATE="$ROOT_DIR/infra/customer-ops/Caddyfile.snippets.tmpl"
SECRETS_DIR="${CUSTOMER_OPS_SECRETS_DIR:-/etc/blockwise/customer-ops/secrets}"
export COMPOSE_PROJECT_NAME=blockwise-customer-ops

command -v docker >/dev/null || { echo 'docker is required' >&2; exit 69; }
docker compose version >/dev/null || { echo 'docker compose plugin is required' >&2; exit 69; }
command -v getent >/dev/null || { echo 'getent is required for DNS validation' >&2; exit 69; }
command -v openssl >/dev/null || { echo 'openssl is required for TLS validation' >&2; exit 69; }
command -v timeout >/dev/null || { echo 'timeout is required for TLS validation' >&2; exit 69; }
command -v python3 >/dev/null || { echo 'python3 is required for URI-safe secret generation' >&2; exit 69; }
command -v readlink >/dev/null || { echo 'readlink is required for secret path validation' >&2; exit 69; }
swap_bytes="$(swapon --show=SIZE --bytes --noheadings 2>/dev/null | awk '{ total += $1 } END { print total + 0 }')"
(( swap_bytes >= 1073741824 )) || { echo "at least 1 GiB active swap is required (detected ${swap_bytes} bytes)" >&2; exit 66; }

# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a
SECRETS_DIR="${CUSTOMER_OPS_SECRETS_DIR:-$SECRETS_DIR}"
export CUSTOMER_OPS_SECRETS_DIR="$SECRETS_DIR"
[[ "$SECRETS_DIR" = /* && ! -L "$SECRETS_DIR" ]] || { echo 'CUSTOMER_OPS_SECRETS_DIR must be an absolute non-symlink path' >&2; exit 64; }
mkdir -p "$SECRETS_DIR"
[[ "$(readlink -f -- "$SECRETS_DIR")" == "$SECRETS_DIR" ]] || { echo 'CUSTOMER_OPS_SECRETS_DIR may not contain symlinked path components' >&2; exit 64; }
chmod 700 "$SECRETS_DIR"
[[ "$(stat -c '%u' "$SECRETS_DIR" 2>/dev/null || stat -f '%u' "$SECRETS_DIR")" == '0' ]] || { echo 'secret directory must be owned by root' >&2; exit 64; }
required_vars=(MAIL_PUBLIC_HOST MAUTIC_HOST CHATWOOT_HOST SNAGTIME_HOST GOOGLE_CLIENT_ID MAUTIC_SMTP_USER CHATWOOT_SMTP_USER SNAGTIME_SMTP_USER MAUTIC_EMAIL_FROM CHATWOOT_EMAIL_FROM SNAGTIME_EMAIL_FROM EMAIL_REPLY_TO CHATWOOT_INBOX_USER CHATWOOT_ACCOUNT_ID CHATWOOT_ENQUIRY_INBOX_ID CHATWOOT_SUPPORT_INBOX_ID CHATWOOT_GLOBAL_ACCOUNT_ID CHATWOOT_GLOBAL_INBOX_ID SNAGTIME_IMAGE SNAGTIME_REVISION SNAGTIME_WEBHOOK_SECRET_HOST_FILE CHATWOOT_WEBHOOK_SECRET_HOST_FILE)
for name in "${required_vars[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "missing required setting: $name" >&2; exit 64; }
done
[[ "$SNAGTIME_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'SNAGTIME_REVISION must be a full lowercase Git SHA' >&2; exit 64; }
[[ "$SNAGTIME_IMAGE" =~ @sha256:[0-9a-f]{64}$ && "$SNAGTIME_IMAGE" != *:latest@* ]] || { echo 'SNAGTIME_IMAGE must include the published immutable sha256 digest' >&2; exit 64; }
[[ "$SNAGTIME_WEBHOOK_SECRET_HOST_FILE" == "$SECRETS_DIR/blockwise_webhook_secret" ]] || { echo 'SNAGTIME_WEBHOOK_SECRET_HOST_FILE must be the same blockwise_webhook_secret source file' >&2; exit 64; }
[[ "$CHATWOOT_WEBHOOK_SECRET_HOST_FILE" == "$SECRETS_DIR/chatwoot_webhook_secret" ]] || { echo 'CHATWOOT_WEBHOOK_SECRET_HOST_FILE must be the bootstrap-created chatwoot_webhook_secret source file' >&2; exit 64; }
validate_dns_host() {
  local value="$1" label="$2"
  python3 - "$value" "$label" <<'PY'
import re
import sys

value, label = sys.argv[1:]
if len(value) > 253 or not value or value.endswith('.') or '..' in value:
    raise SystemExit(f'{label} must be a canonical DNS hostname')
labels = value.split('.')
if any(len(part) > 63 or not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?', part) for part in labels):
    raise SystemExit(f'{label} contains an invalid DNS label')
PY
}
validate_dns_host "$MAIL_PUBLIC_HOST" MAIL_PUBLIC_HOST || exit 64
validate_dns_host "$MAUTIC_HOST" MAUTIC_HOST || exit 64
validate_dns_host "$SNAGTIME_HOST" SNAGTIME_HOST || exit 64
CHATWOOT_CADDY_HOST="$(python3 - "$CHATWOOT_HOST" <<'PY'
import re
import sys
from urllib.parse import urlsplit

raw = sys.argv[1]
parsed = urlsplit(raw)
if parsed.scheme not in {'http', 'https'} or parsed.username or parsed.password or parsed.path not in {'', '/'} or parsed.query or parsed.fragment or parsed.port is not None or not parsed.hostname:
    raise SystemExit('CHATWOOT_HOST must be an http(s) DNS URL without credentials, port, or path')
host = parsed.hostname
if len(host) > 253 or host.endswith('.') or '..' in host:
    raise SystemExit('CHATWOOT_HOST contains an invalid DNS hostname')
labels = host.split('.')
if any(len(part) > 63 or not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?', part) for part in labels):
    raise SystemExit('CHATWOOT_HOST contains an invalid DNS label')
print(host.lower())
PY
)" || exit 64
[[ "${BLOCKWISE_MAIL_PUBLIC_HOST:-}" == "$MAIL_PUBLIC_HOST" ]] || { echo 'BLOCKWISE_MAIL_PUBLIC_HOST must exactly match customer MAIL_PUBLIC_HOST' >&2; exit 64; }
validate_dns_host "$BLOCKWISE_MAIL_PUBLIC_HOST" BLOCKWISE_MAIL_PUBLIC_HOST || exit 64
[[ -f "$CADDY_TEMPLATE" ]] || { echo 'Caddy snippet template is missing' >&2; exit 66; }
CADDY_RENDERED="$(mktemp /tmp/blockwise-customer-ops-caddy.XXXXXX)"
trap 'rm -f "$CADDY_RENDERED"' EXIT
sed -e "s|\${MAUTIC_HOST}|$MAUTIC_HOST|g" \
  -e "s|\${CHATWOOT_HOST}|$CHATWOOT_CADDY_HOST|g" \
  -e "s|\${SNAGTIME_HOST}|$SNAGTIME_HOST|g" "$CADDY_TEMPLATE" > "$CADDY_RENDERED"
! grep -Eq '\$\{[A-Za-z_][A-Za-z0-9_]*\}' "$CADDY_RENDERED" || { echo 'unresolved Caddy hostname placeholder' >&2; exit 64; }
grep -Fq "$MAUTIC_HOST" "$CADDY_RENDERED" && grep -Fq "$CHATWOOT_CADDY_HOST" "$CADDY_RENDERED" && grep -Fq "$SNAGTIME_HOST" "$CADDY_RENDERED" || { echo 'rendered Caddy hostnames do not match env' >&2; exit 64; }
if command -v caddy >/dev/null; then
  caddy validate --config "$CADDY_RENDERED" --adapter caddyfile >/dev/null || { echo 'rendered Caddy snippets failed validation' >&2; exit 65; }
else
  CADDY_VALIDATOR_IMAGE='caddy:2.11.3-alpine@sha256:86deaf5e3d3408a6ccec08fbb79989783dd26e206ae10bcf78a801dc8c9ab794'
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
    -v "$CADDY_RENDERED:/etc/caddy/Caddyfile:ro" "$CADDY_VALIDATOR_IMAGE" \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || { echo 'digest-pinned Caddy container validation failed' >&2; exit 65; }
fi
if [[ -n "$CADDY_OUTPUT" ]]; then
  case "$CADDY_OUTPUT" in "$ROOT_DIR"/*) echo 'Caddy output must be outside the checkout' >&2; exit 64 ;; esac
  install -m 0644 "$CADDY_RENDERED" "$CADDY_OUTPUT"
fi

secret_names=(postgres_owner_password chatwoot_db_password snagtime_db_password mautic_db_root_password mautic_db_password chatwoot_secret_key_base snagtime_auth_secret snagtime_token_encryption_key)
for secret in "${secret_names[@]}"; do
  path="$SECRETS_DIR/$secret"
  [[ ! -L "$path" ]] || { echo "secret file may not be a symlink: $path" >&2; exit 64; }
  if [[ ! -e "$path" ]]; then
    umask 077
    (set -o noclobber; openssl rand -hex 48 > "$path") 2>/dev/null || { echo "could not create secret file safely: $path" >&2; exit 64; }
  fi
  [[ -f "$path" && ! -L "$path" && "$(readlink -f -- "$path")" == "$path" && "$(stat -c '%a' "$path" 2>/dev/null || stat -f '%Lp' "$path")" == '600' && "$(stat -c '%u' "$path" 2>/dev/null || stat -f '%u' "$path")" == '0' ]] || { echo "secret file must be an absolute regular root-owned mode-0600 file: $path" >&2; exit 64; }
done
if [[ "$MAUTIC_SMTP_USER" == "$CHATWOOT_SMTP_USER" || "$MAUTIC_SMTP_USER" == "$SNAGTIME_SMTP_USER" || "$CHATWOOT_SMTP_USER" == "$SNAGTIME_SMTP_USER" ]]; then
  echo 'Mautic, Chatwoot, and SnagTime SMTP users must be distinct' >&2
  exit 64
fi
for secret in google_client_secret mautic_smtp_password chatwoot_smtp_password snagtime_smtp_password chatwoot_inbox_password app_database_url worker_database_url booking_capability_secret booking_capability_keyring snagtime_token_encryption_key email_token_secret tenant_context_secret rate_limit_hash_secret proxy_shared_secret operator_health_secret blockwise_webhook_secret blockwise_booking_action_secret; do
  path="$SECRETS_DIR/$secret"
  [[ -s "$path" && ! -L "$path" && "$(readlink -f -- "$path")" == "$path" && "$(stat -c '%a' "$path" 2>/dev/null || stat -f '%Lp' "$path")" == '600' && "$(stat -c '%u' "$path" 2>/dev/null || stat -f '%u' "$path")" == '0' ]] || { echo "provider credential must pre-exist as absolute regular root-owned mode-0600 file: $path" >&2; exit 64; }
done

write_url_secret() {
  local path="$1" user="$2" db="$3" password_file="$4"
  [[ "$path" = /* && ! -L "$path" ]] || { echo "database URL secret path must be an absolute non-symlink file: $path" >&2; exit 64; }
  password_encoded="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read().rstrip("\n"), safe=""))' < "$password_file")"
  expected="postgresql://${user}:${password_encoded}@postgres:5432/${db}?connect_timeout=3"
  if [[ ! -s "$path" ]] || ! cmp -s <(printf '%s\n' "$expected") "$path"; then
    umask 077
    (set -o noclobber; printf '%s\n' "$expected" > "$path") 2>/dev/null || { echo "could not create database URL secret safely: $path" >&2; exit 64; }
  fi
  [[ -f "$path" && ! -L "$path" && "$(readlink -f -- "$path")" == "$path" ]] || { echo "database URL secret must be a regular file: $path" >&2; exit 64; }
  chmod 600 "$path"
  [[ "$(stat -c '%u' "$path" 2>/dev/null || stat -f '%u' "$path")" == '0' ]] || { echo "database URL secret must be root-owned: $path" >&2; exit 64; }
}
write_url_secret "$SECRETS_DIR/snagtime_database_url" snagtime snagtime "$SECRETS_DIR/snagtime_db_password"

docker network inspect "$PRODUCT_MAIL_NETWORK" >/dev/null 2>&1 || { echo 'shared product-mail network is missing: create blockwise-customer-ops-mail after review' >&2; exit 66; }
docker network inspect "$PRODUCT_MAIL_NETWORK" | python3 -c '
import json
import sys
expected = sys.argv[1]
networks = json.load(sys.stdin)
containers = networks[0].get("Containers", {}) if networks else {}
if not any("product-mail" in str(item.get("Name", "")) and expected in (item.get("Aliases") or []) for item in containers.values()):
    raise SystemExit("product-mail is not attached with the configured MAIL_PUBLIC_HOST alias")
' "$MAIL_PUBLIC_HOST" || exit 66
for host in "$MAIL_PUBLIC_HOST" "$MAUTIC_HOST" "$CHATWOOT_CADDY_HOST" "$SNAGTIME_HOST"; do
  getent ahosts "$host" >/dev/null || { echo "DNS does not resolve: $host" >&2; exit 65; }
done

mail_port="${SMTP_PORT:-587}"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile smoke run --build --rm --no-deps -T --entrypoint sh smtp-client \
  -ceu 'nc -z -w 8 "$1" "$2"' sh "$MAIL_PUBLIC_HOST" "$mail_port" >/dev/null 2>&1 || {
  echo "private mail submission port is not reachable: $MAIL_PUBLIC_HOST:$mail_port" >&2
  exit 65
}
smtp_auth_check() {
  local label="$1" user="$2" secret_file="$3" config
  config="$(mktemp /tmp/blockwise-installer-swaks.XXXXXX)"
  chmod 600 "$config"
  trap 'rm -f "$config"' RETURN
  printf '%s\n' "--auth-password=$(<"$SECRETS_DIR/$secret_file")" > "$config"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile smoke \
    run --build --rm --no-deps -T -v "$config:/run/swaks.conf:ro" --entrypoint swaks smtp-client \
    --config /run/swaks.conf --server "$MAIL_PUBLIC_HOST" --port "$mail_port" \
    --tls --tls-sni-name "$MAIL_PUBLIC_HOST" --tls-verify --auth LOGIN \
    --auth-user "$user" --quit-after AUTH >/dev/null 2>&1 || { echo "$label SMTP STARTTLS/AUTH failed" >&2; exit 65; }
  rm -f "$config"
  trap - RETURN
}
smtp_auth_check Mautic "$MAUTIC_SMTP_USER" mautic_smtp_password
smtp_auth_check Chatwoot "$CHATWOOT_SMTP_USER" chatwoot_smtp_password
smtp_auth_check SnagTime "$SNAGTIME_SMTP_USER" snagtime_smtp_password

if [[ "$POST_EDGE_TLS" == 1 ]]; then
  for host in "$MAUTIC_HOST" "$CHATWOOT_CADDY_HOST" "$SNAGTIME_HOST"; do
    timeout 12 openssl s_client -connect "$host:443" -servername "$host" -verify_return_error -verify_hostname "$host" </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer >/dev/null || { echo "TLS certificate validation failed: $host" >&2; exit 65; }
  done
  mail_port="${SMTP_PORT:-587}"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile smoke run --build --rm --no-deps -T --entrypoint sh smtp-client \
    -ceu 'set -o pipefail; timeout 12 openssl s_client -starttls smtp -connect "$1:$2" -servername "$1" -verify_return_error -verify_hostname "$1" </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer >/dev/null' \
    sh "$MAIL_PUBLIC_HOST" "$mail_port" || { echo "SMTP TLS certificate validation failed: $MAIL_PUBLIC_HOST:$mail_port" >&2; exit 65; }
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
if [[ "$MODE" == apply ]]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans
fi
echo "customer-ops ${MODE} checks passed; credentials were not printed"
