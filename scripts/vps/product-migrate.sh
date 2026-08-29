#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/product-common.sh"
MIGRATION_DIR="${BLOCKWISE_PRODUCT_MIGRATION_DIR:-$PRODUCT_ROOT/supabase/migrations}"
ALLOWLIST="${BLOCKWISE_PRODUCT_MIGRATION_ALLOWLIST:-$PRODUCT_ROOT/infra/product/product-migrations.txt}"

[[ -f "$ALLOWLIST" ]] || { echo "Missing product migration allowlist: $ALLOWLIST" >&2; exit 2; }
[[ -d "$MIGRATION_DIR" ]] || { echo "Missing migration directory: $MIGRATION_DIR" >&2; exit 2; }

mapfile -t MIGRATIONS < <(sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' "$ALLOWLIST")
(( ${#MIGRATIONS[@]} > 0 )) || { echo "Product migration allowlist is empty: $ALLOWLIST" >&2; exit 2; }

validate_allowlist() {
  local name migration previous=""
  declare -A seen=()
  for name in "${MIGRATIONS[@]}"; do
    [[ "$name" =~ ^[0-9]{12,}_[a-z0-9_-]+\.sql$ ]] || { echo "Invalid migration name in allowlist: $name" >&2; return 2; }
    [[ -z "${seen[$name]+x}" ]] || { echo "Duplicate migration in allowlist: $name" >&2; return 2; }
    seen["$name"]=1
    [[ -z "$previous" || "$name" > "$previous" ]] || {
      echo "Product migration allowlist must be strictly chronological; $name follows $previous" >&2
      return 2
    }
    migration="$MIGRATION_DIR/$name"
    [[ -f "$migration" ]] || { echo "Missing allowlisted migration: $migration" >&2; return 2; }
    previous="$name"
  done
}

# Run the complete validation before any database mutation. This catches a
# bad filename, missing file, duplicate, or non-monotonic dependency order up
# front (including edits added after the original list was reviewed).
validate_allowlist

if [[ "${1:---plan}" != "--apply" ]]; then
  for name in "${MIGRATIONS[@]}"; do
    echo "$MIGRATION_DIR/$name"
  done
  echo "plan only; product allowlist and compatibility rehearsal are required before apply"
  exit
fi
[[ "${BLOCKWISE_MIGRATION_APPROVED:-}" == "I_HAVE_REHEARSED_ON_A_RESTORE" ]] || { echo "Set BLOCKWISE_MIGRATION_APPROVED=I_HAVE_REHEARSED_ON_A_RESTORE" >&2; exit 2; }

compose exec -T product-db psql -v ON_ERROR_STOP=1 -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" <<'SQL'
create table if not exists public.blockwise_product_migration_ledger (
  version text primary key,
  applied_at timestamptz not null default now()
);
revoke all on table public.blockwise_product_migration_ledger from public, anon, authenticated;
  grant all on table public.blockwise_product_migration_ledger to service_role;
SQL

for name in "${MIGRATIONS[@]}"; do
  migration="$MIGRATION_DIR/$name"
  echo "applying $migration"
  # Keep the ledger check, migration, and ledger insert in one transaction.
  # pg_advisory_xact_lock serializes concurrent migration runners, while the
  # explicit list above preserves the reviewed dependency order.
  {
    printf '%s\n' 'begin;'
    printf '%s\n' "select pg_advisory_xact_lock(hashtextextended('blockwise-product-migrations', 0));"
    printf '%s\n' 'select exists (select 1 from public.blockwise_product_migration_ledger where version = :'"'"'migration'"'"') as migration_already_applied;'
    printf '%s\n' '\gset'
    printf '%s\n' '\if :migration_already_applied'
    printf '%s\n' "\echo already applied $migration"
    printf '%s\n' '\else'
    cat "$migration"
    printf '%s\n' "insert into public.blockwise_product_migration_ledger(version) values (:'migration');"
    printf '%s\n' '\endif'
    printf '%s\n' 'commit;'
  } | compose exec -T product-db psql -v ON_ERROR_STOP=1 -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" -v migration="$name"
done

# PostgREST caches the schema and configuration. Refresh both caches after the
# complete migration set, then perform a controlled restart so a missed
# notification cannot leave the API serving an old schema.
compose exec -T product-db psql -v ON_ERROR_STOP=1 -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" <<'SQL'
notify pgrst, 'reload schema';
notify pgrst, 'reload config';
SQL
compose restart product-rest
echo "product migrations applied; PostgREST schema/config reloaded"
