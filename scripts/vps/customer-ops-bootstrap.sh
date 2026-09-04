#!/usr/bin/env bash
# Idempotent customer-operations bootstrap. Provider mutations happen only in
# --apply mode and every credential is read from an operator-owned file.
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
usage: customer-ops-bootstrap.sh --env-file FILE [--check|--apply]

--check validates the complete provider/API and shared-mail contract.
--apply creates/updates configured Mautic and Chatwoot resources through their
documented APIs, then writes a credential-free bootstrap receipt.
EOF
}

MODE=check
ENV_FILE=''
while (($#)); do
  case "$1" in
    --env-file) [[ $# -ge 2 ]] || { usage; exit 64; }; ENV_FILE="$2"; shift 2 ;;
    --check) MODE=check; shift ;;
    --apply) MODE=apply; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 64 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo 'customer-ops bootstrap must run as root' >&2; exit 77; }
[[ "$ENV_FILE" = /* && -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || { echo 'an absolute regular env file is required' >&2; exit 64; }
[[ "$(readlink -f -- "$ENV_FILE")" == "$ENV_FILE" ]] || { echo 'env file may not contain symlinked path components' >&2; exit 64; }
[[ "$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")" == 600 ]] || { echo 'env file must be mode 0600' >&2; exit 64; }
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

SECRETS_DIR="${CUSTOMER_OPS_SECRETS_DIR:?CUSTOMER_OPS_SECRETS_DIR is required}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ "$SECRETS_DIR" = /* && -d "$SECRETS_DIR" && ! -L "$SECRETS_DIR" ]] || { echo 'secret directory must be an absolute regular directory' >&2; exit 64; }
[[ "$(readlink -f -- "$SECRETS_DIR")" == "$SECRETS_DIR" && "$(stat -c '%u' "$SECRETS_DIR" 2>/dev/null || stat -f '%u' "$SECRETS_DIR")" == 0 ]] || { echo 'secret directory must be root-owned without symlink components' >&2; exit 64; }

require_secret() {
  local name="$1" path="$SECRETS_DIR/$1"
  [[ -f "$path" && ! -L "$path" && "$(readlink -f -- "$path")" == "$path" ]] || { echo "missing regular secret file: $name" >&2; exit 64; }
  [[ "$(stat -c '%a' "$path" 2>/dev/null || stat -f '%Lp' "$path")" == 600 && "$(stat -c '%u' "$path" 2>/dev/null || stat -f '%u' "$path")" == 0 && -s "$path" ]] || { echo "secret must be root-owned, non-empty, mode 0600: $name" >&2; exit 64; }
}
for name in mautic_api_token chatwoot_api_token mautic_smtp_password chatwoot_smtp_password snagtime_smtp_password chatwoot_inbox_password google_client_secret; do require_secret "$name"; done
require_value() { [[ -n "${!1:-}" ]] || { echo "missing required setting: $1" >&2; exit 64; }; }
for name in MAIL_PUBLIC_HOST MAUTIC_SMTP_USER CHATWOOT_SMTP_USER SNAGTIME_SMTP_USER MAUTIC_API_URL CHATWOOT_API_URL CHATWOOT_ACCOUNT_ID CHATWOOT_INBOX_USER SNAGTIME_HOST; do require_value "$name"; done
[[ "$MAUTIC_API_URL" == https://* && "$CHATWOOT_API_URL" == https://* ]] || { echo 'provider API URLs must use HTTPS' >&2; exit 64; }
[[ "$MAUTIC_SMTP_USER" != "$CHATWOOT_SMTP_USER" && "$MAUTIC_SMTP_USER" != "$SNAGTIME_SMTP_USER" && "$CHATWOOT_SMTP_USER" != "$SNAGTIME_SMTP_USER" ]] || { echo 'Stalwart identities must be distinct' >&2; exit 64; }
command -v curl >/dev/null || { echo 'curl is required' >&2; exit 69; }
command -v python3 >/dev/null || { echo 'python3 is required' >&2; exit 69; }

validate_json_mapping() {
  local name="$1" value="${!1:-}"
  [[ -n "$value" ]] || { echo "$name is required for lifecycle routing" >&2; exit 64; }
  python3 - "$name" "$value" <<'PY'
import json,sys
name,value=sys.argv[1:]
try: parsed=json.loads(value)
except json.JSONDecodeError as exc: raise SystemExit(f'{name} must be valid JSON: {exc.msg}')
if not isinstance(parsed,dict) or not parsed or any(not isinstance(k,str) or not k.strip() or not isinstance(v,(str,int)) or not str(v).strip() for k,v in parsed.items()):
    raise SystemExit(f'{name} must be a non-empty object of stage to provider id')
if 'SEGMENTS' in name or 'CAMPAIGNS' in name:
    for key, value in parsed.items():
        if not str(value).isdigit() or int(value) <= 0:
            raise SystemExit(f'{name} must contain real positive numeric provider IDs; placeholder values are not accepted ({key})')
PY
}
validate_json_mapping MAUTIC_LIFECYCLE_FIELDS_JSON
validate_json_mapping MAUTIC_LIFECYCLE_SEGMENTS_JSON
validate_json_mapping MAUTIC_LIFECYCLE_CAMPAIGNS_JSON
require_value MAUTIC_CONTACT_TAG
require_value MAUTIC_LIFECYCLE_TAG
[[ "$MAUTIC_CONTACT_TAG" =~ ^[A-Za-z0-9._:-]{1,128}$ && "$MAUTIC_LIFECYCLE_TAG" =~ ^[A-Za-z0-9._:-]{1,128}$ ]] || { echo 'Mautic tags contain unsupported characters' >&2; exit 64; }

# GoTrue and the existing transactional outbox must use the same Stalwart
# submission service. Only routing names are inspected; passwords stay in the
# product service's protected configuration and are never read here.
PRODUCT_ENV_FILE="${BLOCKWISE_PRODUCT_ENV_FILE:-/srv/blockwise/product/.env}"
[[ -f "$PRODUCT_ENV_FILE" && ! -L "$PRODUCT_ENV_FILE" ]] || { echo 'BLOCKWISE_PRODUCT_ENV_FILE must point to the product env' >&2; exit 64; }
grep -Eq '^BLOCKWISE_AUTH_SMTP_HOST=(product-mail|[^[:space:]]+)$' "$PRODUCT_ENV_FILE" || { echo 'GoTrue SMTP host is not configured' >&2; exit 64; }
grep -Eq '^SMTP_HOST=(product-mail|[^[:space:]]+)$' "$PRODUCT_ENV_FILE" || { echo 'transactional outbox SMTP host is not configured' >&2; exit 64; }
grep -Eq "^BLOCKWISE_AUTH_SMTP_HOST=(${MAIL_PUBLIC_HOST//./\\.}|product-mail)$" "$PRODUCT_ENV_FILE" || { echo 'GoTrue SMTP host is not the shared Stalwart service' >&2; exit 64; }
grep -Eq "^SMTP_HOST=(${MAIL_PUBLIC_HOST//./\\.}|product-mail)$" "$PRODUCT_ENV_FILE" || { echo 'transactional outbox SMTP host is not the shared Stalwart service' >&2; exit 64; }

# Execute one documented provider API call without placing the bearer token on
# argv or in ordinary process environment. The response body is discarded.
api_request() {
  local token_name="$1" method="$2" url="$3" body_file="${4:-}" response_file="${5:-/dev/null}" config code
  config="$(mktemp /tmp/blockwise-customer-ops-api.XXXXXX)"; chmod 600 "$config"
  {
    printf 'silent\nshow-error\nrequest = "%s"\nurl = "%s"\nheader = "' "$method" "$url"
    if [[ "$token_name" == chatwoot_api_token ]]; then
      printf 'api_access_token: '
    else
      printf 'Authorization: Bearer '
    fi
    tr -d '\r\n' < "$SECRETS_DIR/$token_name"
    printf '"\n'
    [[ -z "$body_file" ]] || printf 'header = "Content-Type: application/json"\ndata-binary = "@%s"\n' "$body_file"
  } > "$config"
  code="$(curl --config "$config" --output "$response_file" --write-out '%{http_code}')" || code=000
  rm -f "$config"
  printf '%s' "$code"
}

verify_mautic_tag() {
  local tag="$1" response code
  response="$(mktemp /tmp/blockwise-mautic-tags.XXXXXX)"; chmod 600 "$response"
  code="$(api_request mautic_api_token GET "${MAUTIC_API_URL%/}/tags?search=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$tag")" '' "$response")"
  [[ "$code" == 2* ]] || { rm -f "$response"; echo "Mautic tag lookup failed (HTTP $code): $tag" >&2; exit 65; }
  python3 - "$tag" "$response" <<'PY'
import json,sys
tag,path=sys.argv[1:]
with open(path,encoding='utf-8') as fh: data=json.load(fh)
def found(value):
    if isinstance(value,dict):
        if any(value.get(k)==tag for k in ('tag','name','label')): return True
        return any(found(v) for v in value.values())
    if isinstance(value,list): return any(found(v) for v in value)
    return False
if not found(data): raise SystemExit(f'Mautic tag is absent: {tag}')
PY
  rm -f "$response"
}

verify_mautic_resource() {
  local kind="$1" id="$2" code
  [[ "$id" =~ ^[0-9]+$ && "$id" -gt 0 ]] || { echo "invalid Mautic $kind id: $id" >&2; exit 64; }
  code="$(api_request mautic_api_token GET "${MAUTIC_API_URL%/}/${kind}/${id}")"
  [[ "$code" == 2* ]] || { echo "Mautic $kind $id is not available (HTTP $code)" >&2; exit 65; }
}

if [[ "$MODE" == apply ]]; then
  require_value CHATWOOT_INBOX_PAYLOAD_FILE
  require_value CHATWOOT_WEBHOOK_URL
  require_secret chatwoot_webhook_probe_secret
  [[ "$CHATWOOT_INBOX_PAYLOAD_FILE" = /* && -f "$CHATWOOT_INBOX_PAYLOAD_FILE" && ! -L "$CHATWOOT_INBOX_PAYLOAD_FILE" ]] || { echo 'CHATWOOT_INBOX_PAYLOAD_FILE must be an absolute regular file' >&2; exit 64; }
  [[ "$(readlink -f -- "$CHATWOOT_INBOX_PAYLOAD_FILE")" == "$CHATWOOT_INBOX_PAYLOAD_FILE" ]] || { echo 'CHATWOOT_INBOX_PAYLOAD_FILE may not contain symlinked path components' >&2; exit 64; }
  [[ "$(stat -c '%a' "$CHATWOOT_INBOX_PAYLOAD_FILE" 2>/dev/null || stat -f '%Lp' "$CHATWOOT_INBOX_PAYLOAD_FILE")" == 600 && "$(stat -c '%u' "$CHATWOOT_INBOX_PAYLOAD_FILE" 2>/dev/null || stat -f '%u' "$CHATWOOT_INBOX_PAYLOAD_FILE")" == 0 ]] || { echo 'CHATWOOT_INBOX_PAYLOAD_FILE must be root-owned, mode 0600' >&2; exit 64; }
  payload_dir="$(dirname "$CHATWOOT_INBOX_PAYLOAD_FILE")"
  while [[ "$payload_dir" != / ]]; do
    payload_dir_stat="$(stat -c '%a %u' "$payload_dir" 2>/dev/null || stat -f '%Lp %u' "$payload_dir")"
    [[ "${payload_dir_stat##* }" == 0 && $((8#${payload_dir_stat%% *} & 18)) -eq 0 ]] || { echo 'CHATWOOT_INBOX_PAYLOAD_FILE has an unsafe parent directory' >&2; exit 64; }
    payload_dir="$(dirname "$payload_dir")"
  done
  while IFS=$'\t' read -r alias field_type; do
    existing="$(api_request mautic_api_token GET "${MAUTIC_API_URL%/}/fields/contact/${alias}")"
    if [[ "$existing" == 2* ]]; then continue; fi
    [[ "$existing" == 404 ]] || { echo "Mautic lifecycle field lookup failed (HTTP $existing)" >&2; exit 65; }
    fields_file="$(mktemp /tmp/blockwise-mautic-field.XXXXXX)"; chmod 600 "$fields_file"
    python3 - "$alias" "$field_type" > "$fields_file" <<'PY'
import json,sys
alias,field_type=sys.argv[1:]
print(json.dumps({'label': 'Blockwise '+alias.replace('_',' '), 'alias': alias, 'type': field_type}))
PY
    code="$(api_request mautic_api_token POST "${MAUTIC_API_URL%/}/fields/contact/new" "$fields_file")"; rm -f "$fields_file"
    [[ "$code" == 2* || "$code" == 409 ]] || { echo "Mautic lifecycle field bootstrap failed (HTTP $code)" >&2; exit 65; }
  done < <(python3 - "${MAUTIC_LIFECYCLE_FIELDS_JSON}" <<'PY'
import json,sys
for alias,field_type in json.loads(sys.argv[1]).items(): print(alias+'\t'+str(field_type))
PY
  )
  for tag in "$MAUTIC_CONTACT_TAG" "$MAUTIC_LIFECYCLE_TAG"; do
    tag_file="$(mktemp /tmp/blockwise-mautic-tag.XXXXXX)"; chmod 600 "$tag_file"
    python3 - "$tag" > "$tag_file" <<'PY'
import json,sys
print(json.dumps({'tag':sys.argv[1]}))
PY
    code="$(api_request mautic_api_token POST "${MAUTIC_API_URL%/}/tags/new" "$tag_file")"; rm -f "$tag_file"
    [[ "$code" == 2* || "$code" == 409 ]] || { echo "Mautic tag bootstrap failed (HTTP $code)" >&2; exit 65; }
  done
  if [[ -n "${CHATWOOT_INBOX_PAYLOAD_FILE:-}" ]]; then
    payload="$CHATWOOT_INBOX_PAYLOAD_FILE"
    code="$(api_request chatwoot_api_token POST "${CHATWOOT_API_URL%/}/accounts/${CHATWOOT_ACCOUNT_ID}/inboxes" "$payload")"
    [[ "$code" == 2* || "$code" == 409 ]] || { echo "Chatwoot inbox bootstrap failed (HTTP $code)" >&2; exit 65; }
  fi
  if [[ -n "${CHATWOOT_WEBHOOK_URL:-}" ]]; then
    hook_file="$(mktemp /tmp/blockwise-chatwoot-webhook.XXXXXX)"; chmod 600 "$hook_file"
    python3 - "$CHATWOOT_WEBHOOK_URL" > "$hook_file" <<'PY'
import json,sys
print(json.dumps({'url':sys.argv[1],'subscriptions':['conversation_created','conversation_updated','message_created']}))
PY
    code="$(api_request chatwoot_api_token POST "${CHATWOOT_API_URL%/}/accounts/${CHATWOOT_ACCOUNT_ID}/webhooks" "$hook_file")"; rm -f "$hook_file"
    [[ "$code" == 2* || "$code" == 409 ]] || { echo "Chatwoot webhook bootstrap failed (HTTP $code)" >&2; exit 65; }
  fi
fi

# Verify every configured provider object through its documented API. Contact
# membership is deliberately not created here: the projection worker applies
# lifecycle tags/segments per contact after durable receipt processing.
while IFS=$'\t' read -r alias _; do
  code="$(api_request mautic_api_token GET "${MAUTIC_API_URL%/}/fields/contact/${alias}")"
  [[ "$code" == 2* ]] || { echo "Mautic lifecycle field ${alias} is unavailable (HTTP $code)" >&2; exit 65; }
done < <(python3 - "${MAUTIC_LIFECYCLE_FIELDS_JSON}" <<'PY'
import json,sys
for key in json.loads(sys.argv[1]): print(key+'\tfield')
PY
)
for tag in "$MAUTIC_CONTACT_TAG" "$MAUTIC_LIFECYCLE_TAG"; do verify_mautic_tag "$tag"; done
while IFS=$'\t' read -r _ id; do verify_mautic_resource segments "$id"; done < <(python3 - "${MAUTIC_LIFECYCLE_SEGMENTS_JSON}" <<'PY'
import json,sys
for key,value in json.loads(sys.argv[1]).items(): print(key+'\t'+str(value))
PY
)
while IFS=$'\t' read -r _ id; do verify_mautic_resource campaigns "$id"; done < <(python3 - "${MAUTIC_LIFECYCLE_CAMPAIGNS_JSON}" <<'PY'
import json,sys
for key,value in json.loads(sys.argv[1]).items(): print(key+'\t'+str(value))
PY
)

# Readiness is a real request; no live success is synthesized when credentials
# or DNS are absent. Response bodies are discarded and never logged.
code="$(api_request mautic_api_token GET "${MAUTIC_API_URL%/}/contacts?limit=1")"; [[ "$code" == 2* ]] || { echo "Mautic API readiness failed (HTTP $code)" >&2; exit 65; }
code="$(api_request chatwoot_api_token GET "${CHATWOOT_API_URL%/}/accounts/${CHATWOOT_ACCOUNT_ID}/inboxes")"; [[ "$code" == 2* ]] || { echo "Chatwoot API readiness failed (HTTP $code)" >&2; exit 65; }
curl --fail --silent --show-error --output /dev/null "https://${SNAGTIME_HOST}/api/health/ready" || { echo 'SnagTime readiness failed' >&2; exit 65; }

receipt="${CUSTOMER_OPS_BOOTSTRAP_RECEIPT:-$SECRETS_DIR/bootstrap-receipt.json}"
[[ "$receipt" = /* && "$receipt" != "$ROOT_DIR"/* ]] || { echo 'bootstrap receipt must be outside the checkout' >&2; exit 64; }
tmp_receipt="$(mktemp "${receipt}.XXXXXX")"; chmod 600 "$tmp_receipt"
python3 - "$MODE" "$tmp_receipt" <<'PY'
import json,sys
from datetime import datetime,timezone
mode,path=sys.argv[1:]
with open(path,'w',encoding='utf-8') as fh:
    json.dump({'schema':'schema://blockwise.customer-ops-bootstrap-receipt/v1','mode':mode,'status':'verified','verified_at':datetime.now(timezone.utc).isoformat(),'mail_identities':'distinct','providers':['gotrue','transactional_outbox','mautic','chatwoot','snagtime']},fh,sort_keys=True)
    fh.write('\n')
PY
mv -f -- "$tmp_receipt" "$receipt"; chmod 600 "$receipt"
echo "customer-ops bootstrap $MODE checks passed; receipt written without credentials"
