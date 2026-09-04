#!/usr/bin/env bash
# Durable transactional-email scheduler entry. Install under the existing VPS
# scheduler and provide the secret through its protected environment.
set -euo pipefail

: "${BLOCKWISE_PUBLIC_URL:?BLOCKWISE_PUBLIC_URL is required}"
: "${BLOCKWISE_INTERNAL_AUTH_SECRET:?BLOCKWISE_INTERNAL_AUTH_SECRET is required}"
provider="${EMAIL_PROVIDER:-}"
case "$provider" in
  smtp)
    test -n "${SMTP_HOST:-}" || { echo "email drain blocked: SMTP_HOST missing" >&2; exit 78; }
    port="${SMTP_PORT:-587}"
    [[ "$port" =~ ^[0-9]+$ ]] && (( port >= 1 && port <= 65535 )) || { echo "email drain blocked: invalid SMTP_PORT" >&2; exit 78; }
    ;;
  resend)
    test -n "${RESEND_API_KEY:-}" || { echo "email drain blocked: explicit Resend provider lacks RESEND_API_KEY" >&2; exit 78; }
    ;;
  *)
    echo "email drain blocked: EMAIL_PROVIDER must be smtp or explicit resend" >&2
    exit 78
    ;;
esac

timestamp="$(date +%s)"
nonce="$(openssl rand -hex 16)"
scope="email.drain"
path="/api/internal/email/drain"
body_hash="$(printf '' | sha256sum | awk '{print $1}')"
canonical=$(printf "v1\n%s\n%s\n%s\nPOST\n%s\n%s" "$timestamp" "$nonce" "$scope" "$path" "$body_hash")
# Keep the HMAC secret out of process arguments; the signer reads it from stdin.
signature="$(printf '%s' "$BLOCKWISE_INTERNAL_AUTH_SECRET" | BLOCKWISE_CANONICAL="$canonical" node -e 'const crypto=require("node:crypto");let key="";process.stdin.on("data",c=>key+=c).on("end",()=>process.stdout.write(crypto.createHmac("sha256",key).update(process.env.BLOCKWISE_CANONICAL).digest("hex")))')"

curl --fail-with-body --silent --show-error --max-time 30 --retry 2 --retry-delay 2 \
  -X POST "${BLOCKWISE_PUBLIC_URL%/}$path" \
  -H 'content-type: application/json' -H "x-blockwise-timestamp: $timestamp" \
  -H "x-blockwise-nonce: $nonce" -H "x-blockwise-scope: $scope" \
  -H "x-blockwise-signature: $signature" --data ''
