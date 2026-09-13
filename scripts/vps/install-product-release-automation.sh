#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$EUID" -eq 0 ]] || { echo "run as root" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

install -o root -g root -m 0755 \
  "$ROOT/scripts/vps/blockwise-autodeploy.sh" \
  /usr/local/sbin/blockwise-autodeploy
install -o root -g root -m 0755 \
  "$ROOT/scripts/vps/prune-current-release.sh" \
  /usr/local/sbin/blockwise-prune-current-release
for unit in \
  blockwise-autodeploy.service \
  blockwise-autodeploy.timer \
  blockwise-prune-releases.service \
  blockwise-prune-releases.timer; do
  install -o root -g root -m 0644 \
    "$ROOT/infra/product/systemd/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now blockwise-autodeploy.timer blockwise-prune-releases.timer
systemctl try-restart blockwise-autodeploy.service
