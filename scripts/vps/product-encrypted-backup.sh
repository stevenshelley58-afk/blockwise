#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PRODUCT_ENV_FILE="${BLOCKWISE_PRODUCT_ENV_FILE:-/srv/blockwise/product/.env}"
BACKUP_ROOT="${BLOCKWISE_ENCRYPTED_BACKUP_DIR:-/srv/blockwise/product/backups/encrypted}"
KEY_FILE="${BLOCKWISE_BACKUP_KEY_FILE:-/etc/blockwise/product-backup.agekey}"
STORAGE_VOLUME="${BLOCKWISE_STORAGE_VOLUME:-blockwise-product-storage-data}"
RETENTION_DAYS="${BLOCKWISE_BACKUP_RETENTION_DAYS:-90}"
[[ -f "$PRODUCT_ENV_FILE" && -f "$KEY_FILE" ]] || { echo "backup prerequisites missing" >&2; exit 2; }
[[ "$BACKUP_ROOT" == /srv/blockwise/product/backups/encrypted ]] || { echo "refusing backup root" >&2; exit 2; }
[[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || { echo "invalid retention days" >&2; exit 2; }
command -v age >/dev/null || { echo "age is required" >&2; exit 2; }
read_env_value() {
  local key="$1" line value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*$key[[:space:]]*=(.*)$ ]] || continue
    value="${BASH_REMATCH[1]}"
    value="${value//$'\r'/}"
    value="${value#\"}"; value="${value%\"}"
    printf '%s' "$value"; return 0
  done < "$PRODUCT_ENV_FILE"
  return 1
}
DB_USER="$(read_env_value BLOCKWISE_DB_USER || printf postgres)"
DB_NAME="$(read_env_value BLOCKWISE_DB_NAME || printf blockwise)"
COMPOSE_FILE="${BLOCKWISE_PRODUCT_COMPOSE_FILE:-/root/work/ad-radar-canonical-20260907/infra/coolify/docker-compose.product.yml}"
[[ -f "$COMPOSE_FILE" ]] || COMPOSE_FILE=/projects/blockwise/infra/coolify/docker-compose.product.yml
[[ -f "$COMPOSE_FILE" ]] || { echo "missing compose file" >&2; exit 2; }
compose() { docker compose --env-file "$PRODUCT_ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
mkdir -p "$BACKUP_ROOT"; chmod 700 "$BACKUP_ROOT"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"; final="$BACKUP_ROOT/$stamp"
work="$(mktemp -d "$BACKUP_ROOT/.incomplete-$stamp.XXXXXX")"
cleanup() { rm -rf -- "$work"; }; trap cleanup EXIT
mountpoint="$(docker volume inspect "$STORAGE_VOLUME" --format '{{.Mountpoint}}' 2>/dev/null || true)"
[[ -d "$mountpoint" ]] || { echo "storage volume unavailable" >&2; exit 2; }
compose exec -T product-db pg_dump --format=custom --no-owner --no-privileges -U "$DB_USER" -d "$DB_NAME" > "$work/database.dump"
compose exec -T product-db pg_dumpall --globals-only -U "$DB_USER" > "$work/globals.sql"
compose exec -T product-db psql -U "$DB_USER" -d "$DB_NAME" -Atc "select json_build_object('checked_at',now(),'workspaces',(select count(*) from public.workspaces),'job_queue',(select count(*) from public.job_queue),'email_outbox',(select count(*) from public.email_outbox));" > "$work/row-counts.json"
tar -C "$mountpoint" -czf "$work/storage.tar.gz" .
recipient="$(age-keygen -y "$KEY_FILE")"
for name in database.dump globals.sql row-counts.json storage.tar.gz; do
  age -r "$recipient" -o "$work/$name.age" "$work/$name"; shred -u "$work/$name"
done
printf 'created_at=%s\nasset_consistency=filesystem-read-no-snapshot\nretention_days=%s\n' "$stamp" "$RETENTION_DAYS" > "$work/METADATA"
(cd "$work" && sha256sum *.age METADATA > SHA256SUMS)
mv "$work" "$final"; work=""
"$SCRIPT_DIR/product-backup-verify.sh" "$final"
deleted=0
while IFS= read -r -d '' old; do rm -rf -- "$old"; deleted=$((deleted + 1)); done < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20?????????????Z' -mtime +"$RETENTION_DAYS" -print0)
printf 'backup=%s encrypted=true verified=true retention_deleted=%s\n' "$final" "$deleted"
