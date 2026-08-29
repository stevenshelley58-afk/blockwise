#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/product-common.sh"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET_DIR="${1:-$BACKUP_DIR/$STAMP}"
mkdir -p "$TARGET_DIR"
chmod 700 "$TARGET_DIR"
compose exec -T product-db pg_dump --format=custom --no-owner --no-privileges -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" > "$TARGET_DIR/database.dump"
compose exec -T product-db pg_dumpall --globals-only -U "$BLOCKWISE_DB_USER" > "$TARGET_DIR/globals.sql"
"$SCRIPT_DIR/product-row-counts.sh" > "$TARGET_DIR/row-counts.json"
sha256sum "$TARGET_DIR/database.dump" "$TARGET_DIR/globals.sql" "$TARGET_DIR/row-counts.json" > "$TARGET_DIR/SHA256SUMS"
printf 'backup=%s\n' "$TARGET_DIR"
