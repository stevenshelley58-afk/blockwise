#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
BACKUP_ROOT="${BLOCKWISE_ENCRYPTED_BACKUP_DIR:-/srv/blockwise/product/backups/encrypted}"
KEY_FILE="${BLOCKWISE_BACKUP_KEY_FILE:-/etc/blockwise/product-backup.agekey}"
DB_CONTAINER=${BLOCKWISE_DB_CONTAINER:-blockwise-product-product-db-1}
TARGET="${1:-}"
[[ "$BACKUP_ROOT" == /srv/blockwise/product/backups/encrypted && -f "$KEY_FILE" ]] || { echo "backup verification prerequisites missing" >&2; exit 2; }
if [[ -z "$TARGET" ]]; then TARGET="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20?????????????Z' -printf '%T@ %p
' | sort -nr | head -1 | cut -d' ' -f2-)"; fi
[[ "$TARGET" == "$BACKUP_ROOT"/20?????????????Z && -d "$TARGET" ]] || { echo "invalid backup target" >&2; exit 2; }
for name in database.dump.age globals.sql.age row-counts.json.age storage.tar.gz.age METADATA SHA256SUMS; do [[ -f "$TARGET/$name" ]] || { echo "backup member missing" >&2; exit 2; }; done
(cd "$TARGET" && sha256sum -c SHA256SUMS >/dev/null)
tmp="$(mktemp -d)"; cleanup() { rm -rf -- "$tmp"; }; trap cleanup EXIT
for name in database.dump globals.sql row-counts.json storage.tar.gz; do age -d -i "$KEY_FILE" -o "$tmp/$name" "$TARGET/$name.age"; done
docker exec -i "$DB_CONTAINER" pg_restore --list < "$tmp/database.dump" >/dev/null
tar -tzf "$tmp/storage.tar.gz" >/dev/null
test -s "$tmp/row-counts.json"
printf 'backup=%s verified=checksums,decryption,pg_restore,storage_archive
' "$TARGET"
