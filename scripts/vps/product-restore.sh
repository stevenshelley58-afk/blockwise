#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/product-common.sh"
DUMP="${1:?Usage: product-restore.sh <database.dump> [globals.sql] --apply}"
shift
GLOBALS=""
APPLY=false
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --globals=*) GLOBALS="${arg#--globals=}" ;;
    *) [[ -z "$GLOBALS" && -f "$arg" ]] || { echo "Unknown option: $arg" >&2; exit 2; }; GLOBALS="$arg" ;;
  esac
done
[[ "$APPLY" == true ]] || { echo "Restore is guarded; append --apply after review." >&2; exit 2; }
[[ "${BLOCKWISE_RESTORE_APPROVED:-}" == "I_HAVE_VERIFIED_THE_BACKUP" ]] || { echo "Set BLOCKWISE_RESTORE_APPROVED=I_HAVE_VERIFIED_THE_BACKUP" >&2; exit 2; }
[[ -f "$DUMP" ]] || { echo "Missing dump: $DUMP" >&2; exit 2; }
[[ -z "$GLOBALS" || -f "$GLOBALS" ]] || { echo "Missing globals file: $GLOBALS" >&2; exit 2; }

echo "Stopping API/worker services before restore; PostgreSQL remains available for the restore."
stop_product_writers

if [[ -n "$GLOBALS" ]]; then
  echo "Applying reviewed role globals before restoring database objects."
  compose exec -T product-db psql -v ON_ERROR_STOP=1 -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" < "$GLOBALS"
fi
compose exec -T product-db pg_restore --clean --if-exists --single-transaction --exit-on-error --no-owner --no-privileges -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" < "$DUMP"
echo "restore complete; re-run product-migrate.sh (ledger-aware), restore Storage/Auth by their compatibility procedures, then product-row-counts.sh and smoke tests before restart"
