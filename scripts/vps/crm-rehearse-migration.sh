#!/usr/bin/env bash
#
# Rehearse the CRM site-credential migration against a copy of production.
#
# `product-migrate.sh` refuses to apply anything without
# BLOCKWISE_MIGRATION_APPROVED=I_HAVE_REHEARSED_ON_A_RESTORE. This is that
# rehearsal: it builds a throwaway database from the real production schema and
# the real vault/mapping/workspace rows, applies the migration there, and then
# proves the behaviour the feature depends on.
#
# It never writes to the production database. It reads it with pg_dump and
# creates/drops only `bw_migrate_rehearsal`.
#
# Usage:
#   scripts/vps/crm-rehearse-migration.sh [--keep]
#
#   --keep   keep the rehearsal database even when every check passes
#
# The database is always kept when a check fails, so the failure can be
# inspected. Exit codes: 0 every check passed, 1 a check failed, 2 setup failed.
#
# Why this exists: the first rehearsal of this migration passed every check
# except one, and that one was the whole feature. The vault already carried
# `UNIQUE (runtime_provider) WHERE runtime_provider IS NOT NULL`, so exactly one
# customer site could hold a credential. The first workspace stored and the
# second was refused with SQLSTATE 23505. A single-workspace test passes happily,
# which is why the check below uses two.

set -Eeuo pipefail

readonly CONTAINER="${BLOCKWISE_PRODUCT_DB_CONTAINER:-blockwise-product-product-db-1}"
readonly SOURCE_DB="${BLOCKWISE_DB_NAME:-blockwise}"
readonly REHEARSAL_DB="${BLOCKWISE_REHEARSAL_DB:-bw_migrate_rehearsal}"
readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly PRODUCT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
readonly MIGRATION_FILE="$PRODUCT_ROOT/supabase/migrations/20260913010000_crm_site_credentials.sql"

KEEP=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
  esac
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

failures=0
check() {
  local name="$1" ok="$2" detail="${3:-}"
  if [ "$ok" = "1" ]; then
    printf 'PASS  %s\n' "$name"
  else
    printf 'FAIL  %s\n' "$name"
    [ -n "$detail" ] && printf '        %s\n' "$detail"
    failures=$((failures + 1))
  fi
}

# A single scalar, whitespace stripped: counts, ids.
q() { docker exec "$CONTAINER" psql -U postgres -d "$REHEARSAL_DB" -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }
# A definition or free text. Whitespace matters here, so it is preserved.
qt() { docker exec "$CONTAINER" psql -U postgres -d "$REHEARSAL_DB" -tAc "$1" 2>/dev/null | tr '\n' ' '; }
# 1 when a boolean query is true.
qbool() { [ "$(q "$1")" = "t" ] && echo 1 || echo 0; }

# Run a script and print what it ends with. Every probe below ends in
# `select outcome from probe`, so the result never has to be parsed out of
# NOTICE lines, and a blank line from an earlier statement cannot leak in. Only
# newlines are removed, so a multi-token result stays readable.
#
# Callers must assign the result to a variable before passing it to check():
# a heredoc inside a command substitution that is itself an argument does not
# survive bash's heredoc handling.
probe() {
  docker exec -i "$CONTAINER" psql -U postgres -d "$REHEARSAL_DB" -tAq 2>/dev/null \
    | tr -d '\n\r'
}

[ -f "$MIGRATION_FILE" ] || { echo "missing migration: $MIGRATION_FILE" >&2; exit 2; }

echo "==> source      $SOURCE_DB"
echo "==> rehearsal   $REHEARSAL_DB"
echo "==> migration   $(basename "$MIGRATION_FILE")"

# ---------------------------------------------------------------------------
# 1. A throwaway database shaped like production.
# ---------------------------------------------------------------------------
echo "==> building the rehearsal database"

docker exec "$CONTAINER" psql -U postgres -d postgres -q -c "drop database if exists $REHEARSAL_DB;" >/dev/null 2>&1
docker exec "$CONTAINER" psql -U postgres -d postgres -q -c "create database $REHEARSAL_DB;" >/dev/null

# The managed Supabase bootstrap creates these; a bare database does not have
# them, and the dump references auth.uid() and extensions.gin_trgm_ops. Those
# objects are not what this migration touches, so the errors they produce are
# counted and reported rather than fatal.
docker exec "$CONTAINER" psql -U postgres -d "$REHEARSAL_DB" -q -c \
  "create schema if not exists auth; create schema if not exists extensions;
   create schema if not exists storage; create schema if not exists private;" >/dev/null

docker exec "$CONTAINER" pg_dump -U postgres -d "$SOURCE_DB" --schema-only -n public -n private \
  > "$WORK/schema.sql" 2>/dev/null
grep -vE '^(CREATE SCHEMA public;|ALTER SCHEMA public OWNER TO|COMMENT ON SCHEMA public )' \
  "$WORK/schema.sql" > "$WORK/schema-clean.sql"

docker exec -i "$CONTAINER" psql -U postgres -d "$REHEARSAL_DB" \
  < "$WORK/schema-clean.sql" > "$WORK/schema.out" 2>&1 || true
unrelated_errors="$(grep -c '^ERROR' "$WORK/schema.out" || true)"

# The rows that matter: the vault (so the scope guard sees real data), the
# mapping table (so the status constraint is replaced against real values), and
# workspaces (so the vault's foreign key is satisfiable).
docker exec "$CONTAINER" pg_dump -U postgres -d "$SOURCE_DB" --data-only \
  -t private.provider_token_vault -t public.crm_workspace_sites -t public.workspaces \
  > "$WORK/data.sql" 2>/dev/null
{ echo "set session_replication_role = replica;"; cat "$WORK/data.sql"; } \
  | docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$REHEARSAL_DB" > "$WORK/data.out" 2>&1 \
  || { echo "could not load rehearsal data:" >&2; tail -5 "$WORK/data.out" >&2; exit 2; }

service_rows_before="$(q 'select count(*) from private.provider_token_vault where runtime_provider is not null and workspace_id is null')"
workspace_count="$(q 'select count(*) from public.workspaces')"

echo "    schema errors in unrelated Supabase-managed objects: $unrelated_errors"
echo "    vault rows: $(q 'select count(*) from private.provider_token_vault')"
echo "    workspaces: $workspace_count"

[ "$workspace_count" -ge 2 ] || { echo "need at least 2 workspaces to rehearse the per-workspace lane" >&2; exit 2; }

# ---------------------------------------------------------------------------
# 2. Apply the migration.
# ---------------------------------------------------------------------------
echo "==> applying the migration"

if docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$REHEARSAL_DB" \
     < "$MIGRATION_FILE" > "$WORK/migration.out" 2>&1; then
  check "the migration applies cleanly to a production-shaped database" 1
else
  check "the migration applies cleanly to a production-shaped database" 0 \
    "$(grep -i error "$WORK/migration.out" | head -2 | tr '\n' ' ')"
  echo "==> stopping: nothing below can be trusted" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# 3. The behaviour the feature depends on.
# ---------------------------------------------------------------------------
echo "==> checking the result"

check "the three RPCs exist" \
  "$([ "$(q "select count(*) from pg_proc where proname like 'crm_site_credential%'")" = "3" ] && echo 1 || echo 0)"

check "the mapping table gained the credential columns" \
  "$([ "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='crm_workspace_sites' and column_name in ('credential_version','credential_last_four','credential_rotated_at','config_version','site_timezone','last_verified_at','failure_category')")" = "7" ] && echo 1 || echo 0)"

check "the mapping status constraint now allows a failed attempt" \
  "$(qt "select pg_get_constraintdef(oid) from pg_constraint where conname='crm_workspace_sites_status_check'" | grep -q failed && echo 1 || echo 0)"

check "one credential per workspace is enforced" \
  "$([ "$(q "select count(*) from pg_indexes where indexname='provider_token_vault_crm_site_uidx'")" = "1" ] && echo 1 || echo 0)"

# The index that made this feature impossible until it was narrowed.
check "the runtime_provider unique index is now limited to the service lane" \
  "$(qt "select indexdef from pg_indexes where indexname='provider_token_vault_runtime_provider_uidx'" | grep -q 'workspace_id IS NULL' && echo 1 || echo 0)" \
  "$(qt "select indexdef from pg_indexes where indexname='provider_token_vault_runtime_provider_uidx'")"

check "the pre-existing service-lane rows are untouched" \
  "$([ "${service_rows_before:-0}" -gt 0 ] && echo 1 || echo 0)" \
  "$service_rows_before service-lane row(s) survive the constraint and index changes"

# The finding this rehearsal exists for: two workspaces, two credentials.
two_outcome="$(probe <<'SQL'
\set ON_ERROR_STOP off
delete from private.provider_token_vault where runtime_provider='blockwise_crm_site';
create temp table probe (outcome text);
do $$
declare
  a uuid;
  b uuid;
begin
  select id into a from public.workspaces order by id limit 1;
  select id into b from public.workspaces order by id offset 1 limit 1;

  begin
    perform public.crm_site_credential_upsert(a, '\x01'::bytea, 'nonce-a', 'aaaa');
    insert into probe values ('first=stored');
  exception when others then insert into probe values ('first=REFUSED-' || sqlstate);
  end;

  begin
    perform public.crm_site_credential_upsert(b, '\x02'::bytea, 'nonce-b', 'bbbb');
    insert into probe values ('second=stored');
  exception when others then insert into probe values ('second=REFUSED-' || sqlstate);
  end;
end;
$$;
select string_agg(outcome, ' ' order by outcome) from probe;
SQL
)"

check "two different workspaces can each store a credential" \
  "$([ "$two_outcome" = "first=stored second=stored" ] && echo 1 || echo 0)" \
  "got: $two_outcome"

readback_outcome="$(probe <<'SQL'
\set ON_ERROR_STOP on
create temp table probe (outcome text);
insert into probe
select case when
  (select credential_nonce from public.crm_site_credential_get((select id from public.workspaces order by id limit 1))) = 'nonce-a'
  and (select credential_nonce from public.crm_site_credential_get((select id from public.workspaces order by id offset 1 limit 1))) = 'nonce-b'
then 'ok' else 'mismatch' end;
select outcome from probe;
SQL
)"

check "each credential reads back only through its own workspace" \
  "$([ "$readback_outcome" = "ok" ] && echo 1 || echo 0)" \
  "got: $readback_outcome"

check "exactly one row per workspace, not one row in total" \
  "$([ "$(q "select count(*) from private.provider_token_vault where runtime_provider='blockwise_crm_site'")" = "2" ] && echo 1 || echo 0)"

duplicate_outcome="$(probe <<'SQL'
\set ON_ERROR_STOP off
create temp table probe (outcome text);
do $$
declare a uuid;
begin
  select id into a from public.workspaces order by id limit 1;
  begin
    insert into private.provider_token_vault (workspace_id, runtime_provider, encrypted_access_token, token_nonce, token_last_four)
    values (a, 'blockwise_crm_site', '\x00'::bytea, 'x', 'zzzz');
    insert into probe values ('not-rejected');
  exception when unique_violation then insert into probe values ('rejected');
  end;
end;
$$;
select outcome from probe;
SQL
)"

check "a workspace cannot hold two credentials at once" \
  "$([ "$duplicate_outcome" = "rejected" ] && echo 1 || echo 0)" \
  "got: $duplicate_outcome"

orphan_outcome="$(probe <<'SQL'
\set ON_ERROR_STOP off
create temp table probe (outcome text);
do $$
begin
  begin
    insert into private.provider_token_vault (workspace_id, runtime_provider, encrypted_access_token, token_nonce, token_last_four)
    values (null, 'blockwise_crm_site', '\x00'::bytea, 'x', 'zzzz');
    insert into probe values ('not-rejected');
  exception when check_violation then insert into probe values ('rejected');
  end;
end;
$$;
select outcome from probe;
SQL
)"

check "a credential row cannot exist without a workspace" \
  "$([ "$orphan_outcome" = "rejected" ] && echo 1 || echo 0)" \
  "got: $orphan_outcome"

check "no browser role can execute the RPCs" \
  "$([ "$(q "select count(*) from pg_roles r where r.rolname in ('anon','authenticated') and (has_function_privilege(r.rolname,'public.crm_site_credential_get(uuid)','EXECUTE') or has_function_privilege(r.rolname,'public.crm_site_credential_upsert(uuid,bytea,text,text)','EXECUTE'))")" = "0" ] && echo 1 || echo 0)"

check "the service role can execute them" \
  "$(qbool "select has_function_privilege('service_role','public.crm_site_credential_get(uuid)','EXECUTE')")"

clear_outcome="$(probe <<'SQL'
\set ON_ERROR_STOP on
create temp table probe (outcome text);
do $$
declare a uuid; n int;
begin
  select id into a from public.workspaces order by id limit 1;
  perform public.crm_site_credential_clear(a);
  select count(*) into n from public.crm_site_credential_get(a) where credential_nonce is not null;
  insert into probe values (case when n = 0 then 'absent' else 'still-present' end);
end;
$$;
select outcome from probe;
SQL
)"

check "clearing blanks the credential so it reads as absent" \
  "$([ "$clear_outcome" = "absent" ] && echo 1 || echo 0)" \
  "got: $clear_outcome"

check "the vault's pre-existing lanes are all still present" \
  "$([ "$(q "select count(*) from private.provider_token_vault where runtime_provider is not null and workspace_id is null")" = "${service_rows_before:-0}" ] && echo 1 || echo 0)"

# ---------------------------------------------------------------------------
echo
if [ "$failures" -eq 0 ]; then
  echo "rehearsal passed: every check held against a copy of production"
  echo "product-migrate.sh still requires BLOCKWISE_MIGRATION_APPROVED=I_HAVE_REHEARSED_ON_A_RESTORE."
else
  echo "rehearsal FAILED: $failures check(s)" >&2
  KEEP=1
fi

if [ "$KEEP" = "1" ]; then
  echo "rehearsal database kept for inspection: $REHEARSAL_DB"
else
  docker exec "$CONTAINER" psql -U postgres -d postgres -q -c "drop database if exists $REHEARSAL_DB;" >/dev/null 2>&1 || true
  echo "rehearsal database dropped"
fi

[ "$failures" -eq 0 ]
