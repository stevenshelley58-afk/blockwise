#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/product-common.sh"

[[ "$#" -ge 4 ]] || {
  echo "Usage: product-object-copy.sh <manifest.tsv> <source-root> <receipt.log> --apply" >&2
  exit 2
}
MANIFEST="$1"
SOURCE_ROOT="$2"
RECEIPT="$3"
shift 3
[[ "$#" == 1 && "$1" == "--apply" ]] || { echo "Storage import is guarded; append --apply after review." >&2; exit 2; }
[[ "${BLOCKWISE_STORAGE_IMPORT_APPROVED:-}" == "I_HAVE_VERIFIED_THE_OBJECT_MANIFEST" ]] || {
  echo "Set BLOCKWISE_STORAGE_IMPORT_APPROVED=I_HAVE_VERIFIED_THE_OBJECT_MANIFEST" >&2
  exit 2
}
[[ -f "$MANIFEST" && -d "$SOURCE_ROOT" ]] || { echo "Manifest or source root is missing" >&2; exit 2; }

MANIFEST="$(realpath -- "$MANIFEST")"
SOURCE_ROOT="$(realpath -- "$SOURCE_ROOT")"
RECEIPT="$(realpath -m -- "$RECEIPT")"
[[ "$SOURCE_ROOT" != "/" && "$SOURCE_ROOT" != "$(realpath -- "$PRODUCT_ROOT")" ]] || { echo "Refusing a broad object source root" >&2; exit 2; }
mkdir -p "$(dirname "$RECEIPT")"
[[ ! -L "$RECEIPT" ]] || { echo "Refusing a symlinked Storage receipt" >&2; exit 2; }
: > "$RECEIPT"
chmod 600 "$RECEIPT"

BLOCKWISE_STORAGE_SERVICE_KEY="$(read_env_value BLOCKWISE_STORAGE_SERVICE_KEY)"
BLOCKWISE_APP_IMAGE="$(read_env_value BLOCKWISE_APP_IMAGE)"
BLOCKWISE_STORAGE_FILE_SIZE_LIMIT="$(read_env_value BLOCKWISE_STORAGE_FILE_SIZE_LIMIT || printf '10485760')"
: "${BLOCKWISE_STORAGE_SERVICE_KEY:?BLOCKWISE_STORAGE_SERVICE_KEY missing from env}"
: "${BLOCKWISE_APP_IMAGE:?BLOCKWISE_APP_IMAGE missing from env}"
[[ "$BLOCKWISE_STORAGE_SERVICE_KEY" != *$'\n'* && "$BLOCKWISE_STORAGE_SERVICE_KEY" != *$'\r'* ]] || { echo "Storage service key contains an unsafe newline" >&2; exit 2; }
[[ "$BLOCKWISE_APP_IMAGE" =~ ^[A-Za-z0-9._/@:-]+$ ]] || { echo "BLOCKWISE_APP_IMAGE is not a safe image reference" >&2; exit 2; }
[[ "$BLOCKWISE_STORAGE_FILE_SIZE_LIMIT" =~ ^[1-9][0-9]*$ ]] || { echo "BLOCKWISE_STORAGE_FILE_SIZE_LIMIT must be a positive integer" >&2; exit 2; }
docker image inspect "$BLOCKWISE_APP_IMAGE" >/dev/null 2>&1 || { echo "Application image is not present locally: $BLOCKWISE_APP_IMAGE" >&2; exit 2; }

# Only the DB, REST compatibility service, and Storage API may run during the
# transfer. The customer app, edge, Realtime, and worker remain quiesced.
stop_product_writers
compose up -d --wait --wait-timeout 180 --no-build --pull never product-db product-rest product-storage
running="$(compose_with_all_profiles ps --status running --services)"
for forbidden in product-app product-worker product-caddy product-realtime product-auth; do
  grep -Fxq "$forbidden" <<< "$running" && { echo "Refusing Storage import while $forbidden is running" >&2; exit 2; }
done

export BLOCKWISE_STORAGE_SERVICE_KEY
export BLOCKWISE_STORAGE_URL="http://product-storage:5000"
export BLOCKWISE_STORAGE_FILE_SIZE_LIMIT
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"
[[ "$HOST_UID" =~ ^[0-9]+$ && "$HOST_GID" =~ ^[0-9]+$ ]] || { echo "Unable to resolve a safe host UID/GID" >&2; exit 2; }
docker run --rm \
  --network blockwise-product \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --user "$HOST_UID:$HOST_GID" \
  -e BLOCKWISE_STORAGE_SERVICE_KEY \
  -e BLOCKWISE_STORAGE_URL \
  -e BLOCKWISE_STORAGE_FILE_SIZE_LIMIT \
  -v "$MANIFEST:/migration/manifest.tsv:ro" \
  -v "$SOURCE_ROOT:/migration/objects:ro" \
  -v "$SCRIPT_DIR/product-storage-api-import.mjs:/migration/import.mjs:ro" \
  --entrypoint node \
  "$BLOCKWISE_APP_IMAGE" \
  /migration/import.mjs --manifest /migration/manifest.tsv --source-root /migration/objects \
  | tee "$RECEIPT"

chmod 600 "$RECEIPT"
grep -q '^blockwise-storage-import: complete ' "$RECEIPT" || { echo "Storage import did not produce a completion receipt" >&2; exit 3; }
echo "Storage API import verified; receipt=$RECEIPT"
