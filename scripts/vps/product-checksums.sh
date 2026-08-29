#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/product-common.sh"
MANIFEST="${1:?Usage: product-checksums.sh <SHA256SUMS>}"
[[ -f "$MANIFEST" ]] || { echo "Missing checksum manifest: $MANIFEST" >&2; exit 2; }
(cd "$(dirname "$MANIFEST")" && sha256sum -c "$(basename "$MANIFEST")")
"$SCRIPT_DIR/product-row-counts.sh"
