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
  local body status
  body="$(mktemp)"
  status="$(
    curl -sS -o "$body" -w "%{http_code}" \
    -X POST "$SUPABASE_URL/storage/v1/bucket" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"$name\",\"name\":\"$name\",\"public\":$public}" \
    || true
  )"

  case "$status" in
    200|201|409)
      echo "[buckets] $name ok ($status)"
      rm -f "$body"
      return 0
      ;;
    400)
      if curl -fsSL \
        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
        "$SUPABASE_URL/storage/v1/bucket/$name" >/dev/null; then
        echo "[buckets] $name already exists"
        rm -f "$body"
        return 0
      fi
      ;;
  esac

  echo "[buckets] failed to create or verify $name (status=$status)" >&2
  cat "$body" >&2 || true
  rm -f "$body"
  return 1
}

create_bucket research-raw-evidence false
create_bucket research-ad-creatives  true
create_bucket research-screenshots   false

echo "[buckets] done"
