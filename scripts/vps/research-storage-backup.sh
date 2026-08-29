#!/bin/sh
set -eu

backup_dir="${RESEARCH_STORAGE_BACKUP_DIR:-/backups}"
retention_days="${RESEARCH_STORAGE_BACKUP_RETENTION_DAYS:-14}"
interval_seconds="${RESEARCH_STORAGE_BACKUP_INTERVAL_SECONDS:-86400}"

mkdir -p "$backup_dir"

while :; do
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  destination="$backup_dir/blockwise-research-storage-$stamp.dump"
  temporary="$destination.incomplete"

  pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$temporary"
  mv "$temporary" "$destination"
  sha256sum "$destination" > "$destination.sha256"

  find "$backup_dir" -type f -name 'blockwise-research-storage-*.dump' -mtime "+$retention_days" -delete
  find "$backup_dir" -type f -name 'blockwise-research-storage-*.dump.sha256' -mtime "+$retention_days" -delete

  sleep "$interval_seconds"
done
