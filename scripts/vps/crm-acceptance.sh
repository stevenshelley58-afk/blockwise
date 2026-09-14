#!/usr/bin/env bash
# Run the A01-A43 acceptance matrix against the live stack, from the host.
#
# Two things the matrix's own header assumes, which do not hold when running
# from the VPS host rather than from inside a container:
#
#   * PRODUCT_SUPABASE_URL must be https://blockwise.sale, not http://product-rest:3000.
#     supabase-js appends /rest/v1/ and the raw postgrest container serves at /
#     with no prefix, so a direct URL fails with "Invalid path specified in
#     request URL". The caddy front is what supplies the prefix.
#   * CRM_BASE_URL must be the CRM backend's address on the shared network. It
#     publishes no port, so this resolves the container IP.
#
# Secrets are read from the product env file and passed through the environment.
# Nothing here prints them.
#
# Usage:
#   bash scripts/vps/crm-acceptance.sh [workspace-uuid]
#
#   ACCEPTANCE_CLEANUP=1   delete the probe leads this run created
set -Eeuo pipefail

WORKTREE="${WORKTREE:-/worktrees/customer-crm-build}"
ENV_FILE="${ENV_FILE:-/srv/blockwise/product/.env}"
WS="${1:-${ACCEPTANCE_WORKSPACE:-11111111-1111-4111-8111-111111111111}}"
SITE="${ACCEPTANCE_SITE:-demo.crm.internal}"
NETWORK="${NETWORK:-blockwise-product}"
SUPABASE_URL="${PRODUCT_SUPABASE_URL:-https://blockwise.sale}"
CRM_BACKEND="${CRM_BACKEND:-blockwise-crm-backend-1}"

read_env_key() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | head -1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"
}

# CRM_BASE_URL is respected when it is already set, so the matrix can be aimed at
# the isolated test instance (127.0.0.1:8099) before the image is promoted. That
# instance is on the CRM's own network, not the product's, so it is reachable
# from the host by port and not by container name.
if [[ -z "${CRM_BASE_URL:-}" ]]; then
  CRM_IP="$(docker inspect "$CRM_BACKEND" --format "{{index .NetworkSettings.Networks \"${NETWORK}\" \"IPAddress\"}}")"
  if [[ -z "$CRM_IP" ]]; then
    echo "could not resolve ${CRM_BACKEND} on ${NETWORK}; set CRM_BASE_URL to override" >&2
    exit 2
  fi
  CRM_BASE_URL="http://${CRM_IP}:8000"
fi

cd "$WORKTREE"

PRODUCT_SUPABASE_URL="${SUPABASE_URL}" \
PRODUCT_SERVICE_ROLE_KEY="$(read_env_key SUPABASE_SERVICE_ROLE_KEY)" \
TOKEN_ENCRYPTION_KEY="$(read_env_key TOKEN_ENCRYPTION_KEY)" \
CRM_BASE_URL="${CRM_BASE_URL}" \
ACCEPTANCE_SITE="${SITE}" \
ACCEPTANCE_WORKSPACE="${WS}" \
node --import tsx scripts/vps/crm-acceptance.mjs
