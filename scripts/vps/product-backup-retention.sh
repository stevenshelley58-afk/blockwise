#!/usr/bin/env bash
set -Eeuo pipefail
# The host helper owns complete-set verification and the fixed two-backup policy.
# Never fall back to age-based deletion if it is absent or verification fails.
root="${1:-}"
count="${2:-2}"
[[ "$root" == /srv/blockwise/product/backups/encrypted && -d "$root" ]] || { echo "invalid retention root" >&2; exit 2; }
[[ "$count" == 2 ]] || { echo "retention count must be 2" >&2; exit 2; }
[[ -x /usr/local/libexec/vps-backup-retention ]] || { echo "verified backup retention helper missing" >&2; exit 2; }
exec /usr/local/libexec/vps-backup-retention --apply --series product
