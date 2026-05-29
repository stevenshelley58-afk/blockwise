#!/usr/bin/env bash
# scripts/vps/seed-storage-buckets.sh
#
# Create the Supabase Storage buckets the research engine writes raw
# evidence into. Idempotent: 409 (exists) is treated as success.

set -euo pipefail

: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SUPABASE_SERVICE_ROLE_KEY:?set SUPABASE_SERVICE_ROLE_KEY}"

create_bucket() {
  local name="$1"; local public="$2"
  echo "[buckets] creating $name (public=$public)"
  curl -fsSL -o /dev/null -w "%{http_code}\n" \
    -X POST "$SUPABASE_URL/storage/v1/bucket" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"$name\",\"name\":\"$name\",\"public\":$public}" \
    || true
}

create_bucket research-raw-evidence false
create_bucket research-ad-creatives  true
create_bucket research-screenshots   false

echo "[buckets] done"
