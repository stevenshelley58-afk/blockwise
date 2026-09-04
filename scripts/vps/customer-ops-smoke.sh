#!/usr/bin/env bash
set -Eeuo pipefail

usage() { echo 'usage: customer-ops-smoke.sh --env-file FILE'; }
ENV_FILE=''
while (($#)); do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 64 ;;
  esac
done
[[ -f "$ENV_FILE" ]] || { usage >&2; exit 64; }
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
SECRETS_DIR="${CUSTOMER_OPS_SECRETS_DIR:-/etc/blockwise/customer-ops/secrets}"
for name in smtp_password google_client_secret mautic_api_token chatwoot_api_token; do
  [[ -s "$SECRETS_DIR/$name" ]] || { echo "missing secret file: $name" >&2; exit 64; }
done
command -v curl >/dev/null || { echo 'curl is required' >&2; exit 69; }
command -v openssl >/dev/null || { echo 'openssl is required' >&2; exit 69; }

quiet_http() { curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}' "$@"; }
smtp_host="${MAIL_HOST:?MAIL_HOST is required}"
smtp_port="${SMTP_PORT:-587}"
if command -v swaks >/dev/null; then
  swaks --server "$smtp_host" --port "$smtp_port" --tls --auth LOGIN \
    --auth-user "$SMTP_USER" --auth-password "$(<"$SECRETS_DIR/smtp_password")" \
    --quit-after AUTH >/dev/null 2>&1 || { echo 'SMTP STARTTLS/AUTH failed' >&2; exit 65; }
else
  timeout 15 openssl s_client -starttls smtp -connect "$smtp_host:$smtp_port" -servername "$smtp_host" </dev/null >/dev/null 2>&1 || { echo 'SMTP STARTTLS failed (install swaks for AUTH assertion)' >&2; exit 65; }
fi

mautic_code="$(quiet_http -H "Authorization: Bearer $(<"$SECRETS_DIR/mautic_api_token")" "${MAUTIC_API_URL:?MAUTIC_API_URL is required}/contacts?limit=1")"
[[ "$mautic_code" == 2* ]] || { echo "Mautic API failed (HTTP $mautic_code)" >&2; exit 65; }
chatwoot_code="$(quiet_http -H "api_access_token: $(<"$SECRETS_DIR/chatwoot_api_token")" "${CHATWOOT_API_URL:?CHATWOOT_API_URL is required}/accounts/${CHATWOOT_ACCOUNT_ID:?CHATWOOT_ACCOUNT_ID is required}/inboxes")"
[[ "$chatwoot_code" == 2* ]] || { echo "Chatwoot API failed (HTTP $chatwoot_code)" >&2; exit 65; }
webhook_code="$(quiet_http -X OPTIONS "${CHATWOOT_WEBHOOK_URL:?CHATWOOT_WEBHOOK_URL is required}")"
[[ "$webhook_code" == 2* || "$webhook_code" == 3* || "$webhook_code" == 4* ]] || { echo "Chatwoot webhook endpoint unavailable (HTTP $webhook_code)" >&2; exit 65; }
snagtime_body="$(curl --fail --silent --show-error "https://${SNAGTIME_HOST:?SNAGTIME_HOST is required}/api/health/ready")" || { echo 'SnagTime readiness failed' >&2; exit 65; }
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"|"ready"[[:space:]]*:[[:space:]]*true' <<<"$snagtime_body" || { echo 'SnagTime is not ready' >&2; exit 65; }
grep -Eiq 'google|calendar' <<<"$snagtime_body" || { echo 'SnagTime Google configuration is not reported' >&2; exit 65; }
projection_code="$(quiet_http "${FRANK_PROJECTION_HEALTH_URL:?FRANK_PROJECTION_HEALTH_URL is required}")"
[[ "$projection_code" == 2* ]] || { echo "Frank projection freshness failed (HTTP $projection_code)" >&2; exit 65; }
echo 'customer-ops smoke passed: SMTP TLS/AUTH, Mautic API, Chatwoot API/webhook, SnagTime Google readiness, Frank projection freshness'
