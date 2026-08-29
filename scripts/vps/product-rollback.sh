#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/product-common.sh"
echo "Rollback is reversible: restore the last verified dump/object manifest, point DNS or the upstream proxy back to the previous endpoint, and leave product volumes intact."
if [[ "${1:-}" != "--apply" ]]; then
  echo "plan only; append --apply after root review"
  exit
fi
[[ "${BLOCKWISE_ROLLBACK_APPROVED:-}" == "I_HAVE_VERIFIED_THE_ROLLBACK_PLAN" ]] || { echo "Set BLOCKWISE_ROLLBACK_APPROVED=I_HAVE_VERIFIED_THE_ROLLBACK_PLAN" >&2; exit 2; }
echo "Rollback gate passed. Run product-restore.sh with the selected verified backup, then restore the previous DNS/upstream route."
