#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/product-common.sh"
echo "Cutover checklist:"
echo "- verify backup/SHA256SUMS and product-row-counts.sh against the managed export"
echo "- verify auth.users UUIDs, identities, recovery links, and workspace memberships"
echo "- verify storage object manifest checksums and private bucket policies"
echo "- set DNS/TLS only after read-only smoke tests pass"
echo "- keep the old Supabase project and volumes untouched for rollback"
if [[ "${1:-}" != "--apply" ]]; then
  echo "plan only; append --apply after root review"
  exit
fi
[[ "${BLOCKWISE_CUTOVER_APPROVED:-}" == "I_HAVE_VERIFIED_BACKUPS_AND_ROLLBACK" ]] || { echo "Set BLOCKWISE_CUTOVER_APPROVED=I_HAVE_VERIFIED_BACKUPS_AND_ROLLBACK" >&2; exit 2; }
echo "Cutover gate passed. This script intentionally does not delete old volumes; perform DNS/provider changes as a separately reviewed operation."
