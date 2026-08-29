#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/product-common.sh"
# The shared SQL manifest uses exact count(*) queries; it can also be run
# read-only against the managed source during a migration rehearsal.
compose exec -T product-db psql -qAt -v ON_ERROR_STOP=1 -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" \
  < "$SCRIPT_DIR/product-row-counts.sql"
