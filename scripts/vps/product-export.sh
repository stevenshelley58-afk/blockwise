#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/product-common.sh"
OUT="${1:?Usage: product-export.sh <output-directory> [schema ...]}"
shift
mkdir -p "$OUT"
SCHEMAS=("$@")
if ((${#SCHEMAS[@]} == 0)); then SCHEMAS=(public auth storage); fi
SCHEMA_ARGS=()
for schema in "${SCHEMAS[@]}"; do
  [[ "$schema" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "Invalid schema: $schema" >&2; exit 2; }
  SCHEMA_ARGS+=(--schema="$schema")
done
compose exec -T product-db pg_dump --format=custom --no-owner --no-privileges "${SCHEMA_ARGS[@]}" -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" > "$OUT/scoped.dump"
for schema in "${SCHEMAS[@]}"; do
  # These named archives are the phased data imports. Keep them data-only so
  # they cannot accidentally replay schema ownership or DDL on the target.
  compose exec -T product-db pg_dump --format=custom --data-only --no-owner --no-privileges --schema="$schema" -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" > "$OUT/${schema}-data.dump"
done
"$SCRIPT_DIR/product-row-counts.sh" > "$OUT/row-counts.json"
sha256sum "$OUT/scoped.dump" "$OUT"/*-data.dump "$OUT/row-counts.json" > "$OUT/SHA256SUMS"
echo "export=$OUT"
