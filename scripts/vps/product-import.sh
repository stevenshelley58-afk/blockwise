#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/product-common.sh"
DUMP=""
AUTH_RECEIPT=""
[[ "$#" -gt 0 ]] || { echo "Usage: product-import.sh <public-data.dump> --public-only --auth-import-receipt=FILE --apply" >&2; exit 2; }
DUMP="$1"
shift
PUBLIC_ONLY=false
APPLY=false
for arg in "$@"; do
  case "$arg" in
    --public-only) PUBLIC_ONLY=true ;;
    --apply) APPLY=true ;;
    --auth-import-receipt=*) AUTH_RECEIPT="${arg#--auth-import-receipt=}" ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done
[[ "$PUBLIC_ONLY" == true ]] || { echo "Import accepts a public data-only dump only; Auth/GoTrue and Storage use their phased procedures." >&2; exit 2; }
[[ "$APPLY" == true ]] || { echo "Import is guarded; append --public-only --auth-import-receipt=FILE --apply after review." >&2; exit 2; }
[[ "${BLOCKWISE_IMPORT_APPROVED:-}" == "I_HAVE_VERIFIED_THE_BACKUP" ]] || { echo "Set BLOCKWISE_IMPORT_APPROVED=I_HAVE_VERIFIED_THE_BACKUP" >&2; exit 2; }
[[ -f "$DUMP" ]] || { echo "Missing dump: $DUMP" >&2; exit 2; }
[[ -n "$AUTH_RECEIPT" && -f "$AUTH_RECEIPT" ]] || { echo "Missing GoTrue/Auth import receipt; import users with the reviewed compatibility procedure first" >&2; exit 2; }
grep -Fxq "blockwise-auth-import: complete" "$AUTH_RECEIPT" || { echo "Auth receipt is not marked complete" >&2; exit 2; }

echo "Stopping API/worker services before import; PostgreSQL remains available for the restore."
stop_product_writers

SCHEMA_READY="$(compose exec -T product-db psql -At -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" -c "select (to_regclass('auth.users') is not null and to_regclass('storage.objects') is not null and to_regclass('public.profiles') is not null)")"
[[ "$SCHEMA_READY" == "t" ]] || { echo "Target schema is not ready; start GoTrue/Storage and apply the product schema migrations first" >&2; exit 2; }

# pg_restore --disable-triggers is required for the known circular public
# foreign-key groups. It is safe here only because the restore is a single
# transaction and the restore role is verified to be a superuser: an abort
# rolls back both data and every trigger state change.
RESTORE_IS_SUPERUSER="$(compose exec -T product-db psql -qAt -v ON_ERROR_STOP=1 -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" -c "select rolsuper from pg_roles where rolname = current_user")"
[[ "$RESTORE_IS_SUPERUSER" == "t" ]] || { echo "Refusing public import: BLOCKWISE_DB_USER must be a superuser for --disable-triggers" >&2; exit 2; }

TARGET_ROWS="$(compose exec -T product-db psql -qAt -v ON_ERROR_STOP=1 -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" <<'SQL'
begin;
create temp table _blockwise_import_counts (row_count bigint) on commit drop;
do $$
declare
  r record;
  n bigint;
begin
  for r in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
      and tablename not like '%migration%'
  loop
    execute format('select count(*) from %I.%I', r.schemaname, r.tablename) into n;
    insert into _blockwise_import_counts values (n);
  end loop;
end $$;
select coalesce(sum(row_count), 0) from _blockwise_import_counts;
commit;
SQL
)"
if [[ "$TARGET_ROWS" != "0" && "${BLOCKWISE_ALLOW_NONEMPTY_IMPORT:-false}" != "true" ]]; then
  echo "Refusing import into a target containing $TARGET_ROWS data row(s); set BLOCKWISE_ALLOW_NONEMPTY_IMPORT=true only after review." >&2
  exit 2
fi

compose exec -T product-db pg_restore --data-only --schema=public --disable-triggers --single-transaction --exit-on-error --no-owner --no-privileges -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" < "$DUMP"

# pg_restore re-enables triggers before committing. Fail closed if the target
# still has a disabled user trigger after the successful transaction.
DISABLED_PUBLIC_TRIGGERS="$(compose exec -T product-db psql -qAt -v ON_ERROR_STOP=1 -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" -c "select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal and t.tgenabled = 'D'")"
[[ "$DISABLED_PUBLIC_TRIGGERS" == "0" ]] || { echo "Refusing completed public import: $DISABLED_PUBLIC_TRIGGERS public trigger(s) remain disabled" >&2; exit 2; }
echo "public data import complete after verified Auth phase; copy Storage metadata/objects with its API-aware procedure, reconcile exact row counts, and smoke-test before restart"
