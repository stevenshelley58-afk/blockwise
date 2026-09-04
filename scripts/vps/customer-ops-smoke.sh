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
[[ $EUID -eq 0 ]] || { echo 'customer-ops smoke must run as root' >&2; exit 77; }
[[ -n "$ENV_FILE" && "$ENV_FILE" = /* && -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || { echo 'an absolute, regular --env-file is required' >&2; exit 64; }
[[ "$(readlink -f -- "$ENV_FILE")" == "$ENV_FILE" ]] || { echo 'env file may not contain symlinked path components' >&2; exit 64; }
[[ "$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")" == '600' && "$(stat -c '%u' "$ENV_FILE" 2>/dev/null || stat -f '%u' "$ENV_FILE")" == '0' ]] || { echo 'env file must be root-owned mode 0600' >&2; exit 64; }
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
SECRETS_DIR="${CUSTOMER_OPS_SECRETS_DIR:-/etc/blockwise/customer-ops/secrets}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ "$SECRETS_DIR" = /* && ! -L "$SECRETS_DIR" && -d "$SECRETS_DIR" ]] || { echo 'secret directory must be an absolute regular directory' >&2; exit 64; }
[[ "$(readlink -f -- "$SECRETS_DIR")" == "$SECRETS_DIR" && "$(stat -c '%u' "$SECRETS_DIR" 2>/dev/null || stat -f '%u' "$SECRETS_DIR")" == '0' ]] || { echo 'secret directory must be root-owned without symlinked path components' >&2; exit 64; }
require_secret_file() {
  local name="$1" path="$SECRETS_DIR/$1"
  [[ "$path" = /* && ! -L "$path" && -f "$path" && "$(readlink -f -- "$path")" == "$path" ]] || { echo "secret must be an absolute regular non-symlink file: $name" >&2; exit 64; }
  [[ "$(stat -c '%a' "$path" 2>/dev/null || stat -f '%Lp' "$path")" == '600' && "$(stat -c '%u' "$path" 2>/dev/null || stat -f '%u' "$path")" == '0' && -s "$path" ]] || { echo "secret must be root-owned, non-empty, mode 0600: $name" >&2; exit 64; }
}
for name in mautic_smtp_password chatwoot_smtp_password snagtime_smtp_password chatwoot_inbox_password google_client_secret mautic_api_token chatwoot_api_token chatwoot_webhook_probe_secret blockwise_webhook_secret blockwise_booking_action_secret; do
  require_secret_file "$name"
done
command -v curl >/dev/null || { echo 'curl is required' >&2; exit 69; }
command -v docker >/dev/null || { echo 'docker is required for private-network IMAPS acceptance' >&2; exit 69; }
command -v openssl >/dev/null || { echo 'openssl is required' >&2; exit 69; }
command -v xxd >/dev/null || { echo 'xxd is required for signed SnagTime probe' >&2; exit 69; }
command -v python3 >/dev/null || { echo 'python3 is required for projection freshness validation' >&2; exit 69; }

quiet_http() { curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}' "$@"; }
smtp_host="${MAIL_PUBLIC_HOST:?MAIL_PUBLIC_HOST is required}"
smtp_port="${SMTP_PORT:-587}"
smtp_auth_check() {
  local label="$1" user="$2" secret_file="$3"
  local config
  config="$(mktemp /tmp/blockwise-swaks.XXXXXX)"
  chmod 600 "$config"
  trap 'rm -f "$config"' RETURN
  printf '%s\n' "--auth-password=$(<"$SECRETS_DIR/$secret_file")" > "$config"
  docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/infra/customer-ops/docker-compose.yml" --profile smoke \
    run --build --rm --no-deps -T -v "$config:/run/swaks.conf:ro" --entrypoint swaks smtp-client \
    --config /run/swaks.conf --server "$smtp_host" --port "$smtp_port" --tls --tls-sni-name "$smtp_host" --tls-verify --auth LOGIN \
    --auth-user "$user" --quit-after AUTH >/dev/null 2>&1 || { echo "$label SMTP STARTTLS/AUTH failed" >&2; exit 65; }
  rm -f "$config"
  trap - RETURN
}
smtp_auth_check 'Mautic' "${MAUTIC_SMTP_USER:?MAUTIC_SMTP_USER is required}" mautic_smtp_password
smtp_auth_check 'Chatwoot' "${CHATWOOT_SMTP_USER:?CHATWOOT_SMTP_USER is required}" chatwoot_smtp_password
smtp_auth_check 'SnagTime' "${SNAGTIME_SMTP_USER:?SNAGTIME_SMTP_USER is required}" snagtime_smtp_password

inbox_user="${CHATWOOT_INBOX_USER:?CHATWOOT_INBOX_USER is required}"
docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/infra/customer-ops/docker-compose.yml" \
  run --rm --no-deps -T --entrypoint sh chatwoot-web -c \
  'curl --fail --silent --show-error --output /dev/null --user "$${1}:$$(cat /run/secrets/chatwoot_inbox_password)" "imaps://$${2}/INBOX"' \
  sh "$inbox_user" "$smtp_host" || { echo 'Chatwoot support inbox IMAPS authentication failed' >&2; exit 65; }

api_http_with_secret() {
  local header_name="$1" secret_file="$2" url="$3" config
  config="$(mktemp /tmp/blockwise-curl.XXXXXX)"
  chmod 600 "$config"
  trap 'rm -f "$config"' RETURN
  printf 'fail\nsilent\nshow-error\noutput = /dev/null\nwrite-out = "%%{http_code}"\nurl = "%s"\nheader = "%s: %s"\n' \
    "$url" "$header_name" "$(<"$SECRETS_DIR/$secret_file")" > "$config"
  curl --config "$config"
  rm -f "$config"
  trap - RETURN
}
mautic_code="$(api_http_with_secret 'Authorization' mautic_api_token "${MAUTIC_API_URL:?MAUTIC_API_URL is required}/contacts?limit=1")"
[[ "$mautic_code" == 2* ]] || { echo "Mautic API failed (HTTP $mautic_code)" >&2; exit 65; }
chatwoot_code="$(api_http_with_secret 'api_access_token' chatwoot_api_token "${CHATWOOT_API_URL:?CHATWOOT_API_URL is required}/accounts/${CHATWOOT_ACCOUNT_ID:?CHATWOOT_ACCOUNT_ID is required}/inboxes")"
[[ "$chatwoot_code" == 2* ]] || { echo "Chatwoot API failed (HTTP $chatwoot_code)" >&2; exit 65; }
[[ -n "${CHATWOOT_WEBHOOK_PROBE_URL:-}" ]] || { echo 'CHATWOOT_WEBHOOK_PROBE_URL is required for signed webhook acceptance' >&2; exit 64; }
payload="customer-ops-smoke-$(date +%s)"
signature="$(printf '%s' "$payload" | openssl dgst -sha256 -mac HMAC -macopt "key:file:$SECRETS_DIR/chatwoot_webhook_probe_secret" -binary | base64 -w0)"
webhook_code="$(quiet_http -X POST -H "Content-Type: text/plain" -H "X-Blockwise-Signature: sha256=$signature" --data "$payload" "$CHATWOOT_WEBHOOK_PROBE_URL")"
[[ "$webhook_code" == 2* ]] || { echo "signed Chatwoot webhook roundtrip failed (HTTP $webhook_code)" >&2; exit 65; }
snagtime_timestamp="$(date +%s)"
snagtime_probe_body='{"spec":"customer-ops.smoke.v1","id":"00000000-0000-4000-8000-000000000001","type":"booking.created","occurredAt":"2025-01-01T00:00:00.000Z","data":{}}'
snagtime_signature="$(printf '%s.%s' "$snagtime_timestamp" "$snagtime_probe_body" | openssl dgst -sha256 -mac HMAC -macopt "key:file:$SECRETS_DIR/blockwise_webhook_secret" -binary | xxd -p -c 256)"
snagtime_webhook_code="$(quiet_http -X POST -H 'Content-Type: application/json' -H "x-snagtime-timestamp: $snagtime_timestamp" -H "x-snagtime-signature: sha256=$snagtime_signature" --data "$snagtime_probe_body" "${BLOCKWISE_WEBHOOK_URL:?BLOCKWISE_WEBHOOK_URL is required}")"
[[ "$snagtime_webhook_code" == 2* ]] || { echo "signed SnagTime webhook roundtrip failed (HTTP $snagtime_webhook_code)" >&2; exit 65; }
snagtime_body="$(curl --fail --silent --show-error "https://${SNAGTIME_HOST:?SNAGTIME_HOST is required}/api/health/ready")" || { echo 'SnagTime readiness failed' >&2; exit 65; }
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"|"ready"[[:space:]]*:[[:space:]]*true' <<<"$snagtime_body" || { echo 'SnagTime is not ready' >&2; exit 65; }
grep -Eiq 'google|calendar' <<<"$snagtime_body" || { echo 'SnagTime Google configuration is not reported' >&2; exit 65; }
projection_body="$(curl --fail --silent --show-error "${FRANK_OPS_OVERVIEW_URL:?FRANK_OPS_OVERVIEW_URL is required}")" || { echo 'Frank /api/ops/overview endpoint unavailable' >&2; exit 65; }
python3 -c 'import json,sys,re
from datetime import datetime,timezone
RECEIPT=re.compile(r"receipt:[a-z0-9][a-z0-9/_-]{2,127}$")
PROJECTIONS={"customers","email","flows","mautic","enquiries","bookings","billing","activity","members"}
SCHEMAS={
 "customers":"schema://frank.ops.customer-summary/v1",
 "email":"schema://frank.ops.transactional-email/v1",
 "flows":"schema://frank.ops.email-flows/v1",
 "mautic":"schema://frank.ops.mautic-lifecycle/v1",
 "enquiries":"schema://frank.ops.chatwoot-enquiries/v1",
 "bookings":"schema://frank.ops.snagtime-bookings/v1",
 "billing":"schema://frank.ops.stripe-billing/v1",
 "activity":"schema://frank.ops.activity/v1",
 "members":"schema://frank.ops.members/v1",
}
def parse_time(value,name):
    if not isinstance(value,str): raise ValueError(name+" is missing")
    parsed=datetime.fromisoformat(value.replace("Z","+00:00"))
    if parsed.tzinfo is None: raise ValueError(name+" lacks timezone")
    return parsed.astimezone(timezone.utc)
try:
    value=json.load(sys.stdin)
    if not isinstance(value,dict) or set(value)!={"schema","version","status","customers","projections"}: raise ValueError("overview shape is invalid")
    if value["schema"]!="schema://frank.ops/v1" or value["version"]!=1 or value["status"]!="ready": raise ValueError("overview schema/status is invalid")
    if not isinstance(value["customers"],list) or not isinstance(value["projections"],dict) or set(value["projections"])!=PROJECTIONS: raise ValueError("overview projections are incomplete")
    revisions=set(); publication_receipts=set(); source_receipts=None; now=datetime.now(timezone.utc)
    for name,meta in value["projections"].items():
        required={"schema","version","projection","status","published_at","fresh_until","source_revision","source_receipt_ids","publication_receipt_id"}
        if not isinstance(meta,dict) or not required.issubset(meta) or set(meta)-required-{"message"}: raise ValueError(name+" metadata shape is invalid")
        if meta["version"]!=1 or meta["projection"]!=name or meta["status"]!="ready": raise ValueError(name+" metadata status is invalid")
        if meta["schema"] != SCHEMAS[name]: raise ValueError(name+" schema is invalid")
        if parse_time(meta["fresh_until"],name+" fresh_until")<=now: raise ValueError(name+" is expired")
        parse_time(meta["published_at"],name+" published_at")
        revision=meta["source_revision"]
        if not isinstance(revision,str) or not revision or len(revision)>256: raise ValueError(name+" source revision is invalid")
        receipts=meta["source_receipt_ids"]
        if not isinstance(receipts,list) or not receipts or any(not isinstance(item,str) or not RECEIPT.fullmatch(item) for item in receipts): raise ValueError(name+" source receipts are invalid")
        publication=meta["publication_receipt_id"]
        if not isinstance(publication,str) or not RECEIPT.fullmatch(publication): raise ValueError(name+" publication receipt is invalid")
        revisions.add(revision); publication_receipts.add(publication)
        source_receipts=frozenset(receipts) if source_receipts is None else source_receipts
        if frozenset(receipts)!=source_receipts: raise ValueError("source receipt provenance changed")
    if len(revisions)!=1 or len(publication_receipts)!=1: raise ValueError("publication provenance is inconsistent")
except (ValueError,TypeError,KeyError,OverflowError) as error:
    raise SystemExit(f"invalid Frank /api/ops/overview contract: {error}")' <<<"$projection_body" || exit 65
echo 'customer-ops smoke passed: SMTP TLS/AUTH, private IMAPS, Mautic API, Chatwoot API, signed Chatwoot and SnagTime probes, SnagTime Google readiness, Frank /api/ops/overview provenance'
