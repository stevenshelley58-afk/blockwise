#!/usr/bin/env bash
set -euo pipefail

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
[[ "${BLOCKWISE_MAIL_PUBLIC_URL}" == https://* ]] || { printf '%s\n' 'mail validation blocked: BLOCKWISE_MAIL_PUBLIC_URL must use https' >&2; exit 78; }
[[ "${BLOCKWISE_MAIL_PUBLIC_URL,,}" != *localhost* && "${BLOCKWISE_MAIL_PUBLIC_URL}" != *127.0.0.1* && "${BLOCKWISE_MAIL_PUBLIC_URL,,}" != *.vercel.app* ]] || { printf '%s\n' 'mail validation blocked: public URL must be an external VPS hostname' >&2; exit 78; }

for key in SMTP_PORT BLOCKWISE_AUTH_SMTP_PORT; do
  value="${!key:-587}"
  [[ "$value" =~ ^[0-9]+$ ]] && (( value >= 1 && value <= 65535 )) || { printf 'mail validation blocked: invalid %s\n' "$key" >&2; exit 78; }
done

printf '%s\n' '{"status":"configured","ok":true,"provider":"smtp","transport":"stalwart","gotrueCredentialCheck":true}'
