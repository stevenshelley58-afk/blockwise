#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
BACKUP_ROOT="${BLOCKWISE_ENCRYPTED_BACKUP_DIR:-/srv/blockwise/product/backups/encrypted}"
KEY_FILE="${BLOCKWISE_BACKUP_KEY_FILE:-/etc/blockwise/product-backup.agekey}"
DB_CONTAINER="${BLOCKWISE_DB_CONTAINER:-blockwise-product-product-db-1}"
TARGET="${1:-}"
[[ "$BACKUP_ROOT" == /srv/blockwise/product/backups/encrypted && -f "$KEY_FILE" ]] || { echo "backup verification prerequisites missing" >&2; exit 2; }
if [[ -z "$TARGET" ]]; then TARGET="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20?????????????Z' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"; fi
[[ "$TARGET" =~ ^/srv/blockwise/product/backups/encrypted/[0-9]{8}T[0-9]{6}Z$ ]] && [[ -d "$TARGET" ]] || { echo "invalid backup target" >&2; exit 2; }
for name in database.dump.age globals.sql.age row-counts.json.age storage.tar.gz.age storage.sha256.age METADATA SHA256SUMS; do [[ -f "$TARGET/$name" ]] || { echo "backup member missing" >&2; exit 2; }; done
(cd "$TARGET" && sha256sum -c SHA256SUMS >/dev/null)
tmp="$(mktemp -d)"; cleanup() { rm -rf -- "$tmp"; [[ -n "${restore_name:-}" ]] && docker rm -f "$restore_name" >/dev/null 2>&1 || true; }; trap cleanup EXIT
for name in database.dump globals.sql row-counts.json storage.tar.gz storage.sha256; do age -d -i "$KEY_FILE" -o "$tmp/$name" "$TARGET/$name.age"; done
extract="$tmp/storage"; mkdir -p "$extract"; tar -xzf "$tmp/storage.tar.gz" -C "$extract"
(cd "$extract" && sha256sum -c "$tmp/storage.sha256" >/dev/null)
restore_name="beta-backup-verify-$$"; docker rm -f "$restore_name" >/dev/null 2>&1 || true
docker run -d --name "$restore_name" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=restore postgres:17.6-alpine >/dev/null
for attempt in $(seq 1 60); do docker exec "$restore_name" pg_isready -U postgres -d restore >/dev/null 2>&1 && break; sleep 1; done
docker exec "$restore_name" pg_isready -U postgres -d restore >/dev/null
for role in anon authenticated service_role authenticator; do
  docker exec "$restore_name" psql -U postgres -d restore -v ON_ERROR_STOP=1 -c "create role $role;" >/dev/null 2>&1 || true
done
docker exec -i "$restore_name" pg_restore --clean --if-exists --single-transaction --exit-on-error --no-owner --no-privileges -U postgres -d restore < "$tmp/database.dump" >/dev/null
expected="$(jq -r '[.workspaces,.job_queue,.email_outbox] | join(",")' "$tmp/row-counts.json")"
actual="$(docker exec "$restore_name" psql -U postgres -d restore -At --field-separator=, -c "select (select count(*) from public.workspaces),(select count(*) from public.job_queue),(select count(*) from public.email_outbox);" | tr -d '\r\n' | sed 's/,/,/g')"
[[ "$expected" == "$actual" ]] || { echo "restored representative counts differ expected=$expected actual=$actual" >&2; exit 1; }
printf 'backup=%s verified=checksums,decryption,storage_checksums,isolated_postgres_restore,representative_counts\n' "$TARGET"
