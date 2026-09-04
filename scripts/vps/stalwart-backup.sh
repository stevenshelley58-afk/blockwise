#!/usr/bin/env bash
set -euo pipefail

destination="${1:?usage: stalwart-backup.sh /srv/blockwise/backups/mail}"
config_volume="${BLOCKWISE_MAIL_CONFIG_VOLUME_NAME:-blockwise-product-mail-config}"
data_volume="${BLOCKWISE_MAIL_DATA_VOLUME_NAME:-blockwise-product-mail-data}"
mkdir -p "$destination"

# RocksDB and settings are not safely captured by a live tar. Refuse rather
# than producing a receipt that looks restorable. The operator must stop the
# Compose service and run this script again.
if docker ps --filter label=com.docker.compose.service=product-mail --filter status=running --format '{{.ID}}' | grep -q .; then
  printf '%s\n' 'mail backup blocked: stop product-mail before backing up its volumes' >&2
  exit 75
fi

for volume in "$config_volume" "$data_volume"; do
  docker volume inspect "$volume" >/dev/null
done

for pair in "config:$config_volume" "data:$data_volume"; do
  name="${pair%%:*}"
  volume="${pair#*:}"
  archive="$destination/stalwart-${name}.tar.gz"
  archive_name="$(basename -- "$archive")"
  # Tar runs in an ephemeral container and mounts the source read-only. The
  # archive is written only to the operator-selected backup directory.
  docker run --rm \
    -e "ARCHIVE_NAME=$archive_name" \
    -v "${volume}:/source:ro" \
    -v "${destination}:/backup" \
    alpine:3.22.1@sha256:eafc1edb577d2e9b458664a15f23ea1c370214193226069eb22921169fc7e43f sh -ceu 'tar -C /source -czf "/backup/$ARCHIVE_NAME" .'
done

(cd "$destination" && sha256sum stalwart-config.tar.gz stalwart-data.tar.gz > SHA256SUMS)
chmod 0600 "$destination"/stalwart-*.tar.gz "$destination"/SHA256SUMS
printf '%s\n' "{\"status\":\"backed_up\",\"destination\":\"$destination\",\"artifacts\":[\"stalwart-config.tar.gz\",\"stalwart-data.tar.gz\",\"SHA256SUMS\"]}"
