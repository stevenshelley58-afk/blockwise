#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/product-common.sh"

DUMP="${1:-}"
RECEIPT=""
EXPECTED_USERS=""
EXPECTED_IDENTITIES=""
APPLY=false
shift $(( $# > 0 ? 1 : 0 ))
for arg in "$@"; do
  case "$arg" in
    --receipt=*) RECEIPT="${arg#--receipt=}" ;;
    --expect-users=*) EXPECTED_USERS="${arg#--expect-users=}" ;;
    --expect-identities=*) EXPECTED_IDENTITIES="${arg#--expect-identities=}" ;;
    --apply) APPLY=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

[[ -n "$DUMP" && -f "$DUMP" ]] || {
  echo "Usage: product-auth-import.sh <auth-data.dump> --receipt=FILE --expect-users=N --expect-identities=N --apply" >&2
  exit 2
}
[[ "$APPLY" == true ]] || { echo "Auth import is guarded; append --apply after review." >&2; exit 2; }
[[ "${BLOCKWISE_AUTH_IMPORT_APPROVED:-}" == "I_HAVE_ACCEPTED_FORCED_REAUTHENTICATION" ]] || {
  echo "Set BLOCKWISE_AUTH_IMPORT_APPROVED=I_HAVE_ACCEPTED_FORCED_REAUTHENTICATION" >&2
  exit 2
}
[[ -n "$RECEIPT" ]] || { echo "A restricted Auth import receipt path is required" >&2; exit 2; }
[[ "$EXPECTED_USERS" =~ ^[0-9]+$ && "$EXPECTED_IDENTITIES" =~ ^[0-9]+$ ]] || {
  echo "Expected Auth counts must be non-negative integers" >&2
  exit 2
}

DUMP="$(realpath -- "$DUMP")"
RECEIPT="$(realpath -m -- "$RECEIPT")"
mkdir -p "$(dirname "$RECEIPT")"

# Only durable login identities are imported. Sessions, refresh tokens, MFA
# session claims, flow state, audit entries, instances, and source
# schema_migrations are deliberately excluded because the self-hosted target
# uses a fresh JWT secret and its own GoTrue schema ledger.
TOC="$(compose exec -T product-db pg_restore --list < "$DUMP")"
grep -Eq 'TABLE DATA auth users ' <<< "$TOC" || { echo "Auth dump has no auth.users table data" >&2; exit 2; }
grep -Eq 'TABLE DATA auth identities ' <<< "$TOC" || { echo "Auth dump has no auth.identities table data" >&2; exit 2; }

stop_product_writers
SCHEMA_READY="$(compose exec -T product-db psql -qAt -v ON_ERROR_STOP=1 -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" -c "select (to_regclass('auth.users') is not null and to_regclass('auth.identities') is not null)")"
[[ "$SCHEMA_READY" == "t" ]] || { echo "GoTrue has not created the target Auth schema" >&2; exit 2; }

RESTORE_IS_SUPERUSER="$(compose exec -T product-db psql -qAt -v ON_ERROR_STOP=1 -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" -c "select rolsuper from pg_roles where rolname = current_user")"
[[ "$RESTORE_IS_SUPERUSER" == "t" ]] || { echo "Refusing Auth import: restore role must be a superuser for --disable-triggers" >&2; exit 2; }

TARGET_COUNTS="$(compose exec -T product-db psql -qAt -F $'\t' -v ON_ERROR_STOP=1 -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" -c "select (select count(*) from auth.users), (select count(*) from auth.identities)")"
[[ "$TARGET_COUNTS" == $'0\t0' ]] || { echo "Refusing Auth import into non-empty users/identities tables: $TARGET_COUNTS" >&2; exit 2; }

compose exec -T product-db pg_restore \
  --data-only \
  --strict-names \
  --table=auth.users \
  --table=auth.identities \
  --disable-triggers \
  --single-transaction \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  -U "$BLOCKWISE_DB_USER" \
  -d "$BLOCKWISE_DB_NAME" \
  < "$DUMP"

RESULT="$(compose exec -T product-db psql -qAt -F $'\t' -v ON_ERROR_STOP=1 -U "$BLOCKWISE_DB_USER" -d "$BLOCKWISE_DB_NAME" <<'SQL'
select
  (select count(*) from auth.users),
  (select count(*) from auth.identities),
  (select count(*) from auth.identities i left join auth.users u on u.id = i.user_id where u.id is null),
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'auth' and not t.tgisinternal and t.tgenabled = 'D');
SQL
)"
IFS=$'\t' read -r ACTUAL_USERS ACTUAL_IDENTITIES ORPHAN_IDENTITIES DISABLED_TRIGGERS <<< "$RESULT"
[[ "$ACTUAL_USERS" == "$EXPECTED_USERS" ]] || { echo "Auth user count mismatch: expected $EXPECTED_USERS, received $ACTUAL_USERS" >&2; exit 3; }
[[ "$ACTUAL_IDENTITIES" == "$EXPECTED_IDENTITIES" ]] || { echo "Auth identity count mismatch: expected $EXPECTED_IDENTITIES, received $ACTUAL_IDENTITIES" >&2; exit 3; }
[[ "$ORPHAN_IDENTITIES" == "0" ]] || { echo "Auth import contains $ORPHAN_IDENTITIES orphan identities" >&2; exit 3; }
[[ "$DISABLED_TRIGGERS" == "0" ]] || { echo "Auth import left $DISABLED_TRIGGERS user trigger(s) disabled" >&2; exit 3; }

printf 'blockwise-auth-import: complete\nusers=%s identities=%s forced_reauthentication=true\n' \
  "$ACTUAL_USERS" "$ACTUAL_IDENTITIES" > "$RECEIPT"
chmod 600 "$RECEIPT"
echo "Durable Auth identities imported; all users must sign in again; receipt=$RECEIPT"
