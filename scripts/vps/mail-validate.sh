#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${BLOCKWISE_PRODUCT_ENV_FILE:-}"
if [[ -z "${BLOCKWISE_MAIL_ENABLED+x}" && -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  # Read the small validation contract without sourcing the env file. This
  # keeps passwords from being evaluated as shell syntax.
  read_env_value() {
    local key="$1" line value
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
  for key in BLOCKWISE_MAIL_ENABLED BLOCKWISE_MAIL_HOSTNAME BLOCKWISE_MAIL_DOMAIN BLOCKWISE_MAIL_PUBLIC_URL \
    BLOCKWISE_AUTH_SMTP_HOST BLOCKWISE_AUTH_SMTP_PORT BLOCKWISE_AUTH_SMTP_USER BLOCKWISE_AUTH_SMTP_PASS \
    BLOCKWISE_AUTH_SMTP_ADMIN_EMAIL SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD STALWART_WEBHOOK_SECRET EMAIL_PROVIDER; do
    if [[ -z "${!key+x}" ]]; then
      value="$(read_env_value "$key" || true)"
      export "$key=$value"
    fi
  done
fi

# Validate the production mail contract without printing any value. This is
# intentionally separate from Compose config: local/preview stacks may omit
# mail, while an enabled production stack must fail before rollout.
if [[ "${BLOCKWISE_MAIL_ENABLED:-false}" != "true" ]]; then
  printf '%s\n' '{"status":"disabled","ok":true}'
  exit 0
fi

missing=()
for key in BLOCKWISE_MAIL_HOSTNAME BLOCKWISE_MAIL_DOMAIN BLOCKWISE_MAIL_PUBLIC_URL \
  BLOCKWISE_AUTH_SMTP_HOST BLOCKWISE_AUTH_SMTP_USER BLOCKWISE_AUTH_SMTP_PASS \
  BLOCKWISE_AUTH_SMTP_ADMIN_EMAIL SMTP_HOST SMTP_USER SMTP_PASSWORD STALWART_WEBHOOK_SECRET EMAIL_PROVIDER; do
  [[ -n "${!key:-}" ]] || missing+=("$key")
done
if (( ${#missing[@]} > 0 )); then
  printf 'mail validation blocked: missing %s\n' "${missing[*]}" >&2
  exit 78
fi

[[ "${EMAIL_PROVIDER,,}" == smtp ]] || { printf '%s\n' 'mail validation blocked: EMAIL_PROVIDER must be smtp (Resend is compatibility-only)' >&2; exit 78; }
if ! node "$SCRIPT_DIR/external-target.mjs" "$BLOCKWISE_MAIL_PUBLIC_URL"; then
  printf '%s\n' 'mail validation blocked: public URL must be an external HTTPS hostname' >&2
  exit 78
fi

for key in SMTP_PORT BLOCKWISE_AUTH_SMTP_PORT; do
  value="${!key:-587}"
  [[ "$value" =~ ^[0-9]+$ ]] && (( value >= 1 && value <= 65535 )) || { printf 'mail validation blocked: invalid %s\n' "$key" >&2; exit 78; }
done

if ! node "$SCRIPT_DIR/smtp-validate.mjs"; then
  printf '%s\n' 'mail validation blocked: both SMTP identities must authenticate over TLS' >&2
  exit 78
fi

printf '%s\n' '{"status":"configured","ok":true,"provider":"smtp","transport":"stalwart","gotrueCredentialCheck":true}'
