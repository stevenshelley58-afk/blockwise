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
for name in chatwoot_smtp_password google_client_secret mautic_api_token chatwoot_api_token; do
  [[ -s "$SECRETS_DIR/$name" ]] || { echo "missing secret file: $name" >&2; exit 64; }
done
command -v curl >/dev/null || { echo 'curl is required' >&2; exit 69; }
command -v openssl >/dev/null || { echo 'openssl is required' >&2; exit 69; }
command -v swaks >/dev/null || { echo 'swaks is required for the SMTP STARTTLS/AUTH acceptance gate' >&2; exit 69; }

quiet_http() { curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}' "$@"; }
smtp_host="${SMTP_PUBLIC_HOST:-${MAIL_PUBLIC_HOST:?MAIL_PUBLIC_HOST is required}}"
smtp_port="${SMTP_PORT:-587}"
swaks --server "$smtp_host" --port "$smtp_port" --tls --auth LOGIN \
  --auth-user "${CHATWOOT_SMTP_USER:?CHATWOOT_SMTP_USER is required}" --auth-password "$(<"$SECRETS_DIR/chatwoot_smtp_password")" \
  --quit-after AUTH >/dev/null 2>&1 || { echo 'SMTP STARTTLS/AUTH failed' >&2; exit 65; }

mautic_code="$(quiet_http -H "Authorization: Bearer $(<"$SECRETS_DIR/mautic_api_token")" "${MAUTIC_API_URL:?MAUTIC_API_URL is required}/contacts?limit=1")"
[[ "$mautic_code" == 2* ]] || { echo "Mautic API failed (HTTP $mautic_code)" >&2; exit 65; }
chatwoot_code="$(quiet_http -H "api_access_token: $(<"$SECRETS_DIR/chatwoot_api_token")" "${CHATWOOT_API_URL:?CHATWOOT_API_URL is required}/accounts/${CHATWOOT_ACCOUNT_ID:?CHATWOOT_ACCOUNT_ID is required}/inboxes")"
[[ "$chatwoot_code" == 2* ]] || { echo "Chatwoot API failed (HTTP $chatwoot_code)" >&2; exit 65; }
if [[ -n "${CHATWOOT_WEBHOOK_PROBE_URL:-}" ]]; then
  [[ -s "$SECRETS_DIR/chatwoot_webhook_probe_secret" ]] || { echo 'missing signed webhook probe secret file' >&2; exit 64; }
  payload="customer-ops-smoke-$(date +%s)"
  signature="$(printf '%s' "$payload" | openssl dgst -sha256 -hmac "$(<"$SECRETS_DIR/chatwoot_webhook_probe_secret")" -binary | base64 -w0)"
  webhook_code="$(quiet_http -X POST -H "Content-Type: text/plain" -H "X-Blockwise-Signature: sha256=$signature" --data "$payload" "$CHATWOOT_WEBHOOK_PROBE_URL")"
  [[ "$webhook_code" == 2* ]] || { echo "signed Chatwoot webhook roundtrip failed (HTTP $webhook_code)" >&2; exit 65; }
else
  echo 'Chatwoot signed webhook roundtrip deferred: set CHATWOOT_WEBHOOK_PROBE_URL and its secret after the adapter contract exists' >&2
fi
snagtime_body="$(curl --fail --silent --show-error "https://${SNAGTIME_HOST:?SNAGTIME_HOST is required}/api/health/ready")" || { echo 'SnagTime readiness failed' >&2; exit 65; }
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"|"ready"[[:space:]]*:[[:space:]]*true' <<<"$snagtime_body" || { echo 'SnagTime is not ready' >&2; exit 65; }
grep -Eiq 'google|calendar' <<<"$snagtime_body" || { echo 'SnagTime Google configuration is not reported' >&2; exit 65; }
projection_code="$(quiet_http "${FRANK_PROJECTION_HEALTH_URL:?FRANK_PROJECTION_HEALTH_URL is required}")"
[[ "$projection_code" == 2* ]] || { echo "Frank projection freshness failed (HTTP $projection_code)" >&2; exit 65; }
echo 'customer-ops smoke passed: SMTP TLS/AUTH, Mautic API, Chatwoot API, SnagTime Google readiness, Frank projection freshness (webhook signed roundtrip optional/deferred)'
