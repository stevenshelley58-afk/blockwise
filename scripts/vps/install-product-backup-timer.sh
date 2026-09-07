#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$EUID" -eq 0 ]] || { echo "run as root" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
install -d -m 700 /etc/blockwise
if [[ ! -s /etc/blockwise/product-backup.agekey ]]; then age-keygen -o /etc/blockwise/product-backup.agekey >/dev/null; fi
chown root:root /etc/blockwise/product-backup.agekey; chmod 600 /etc/blockwise/product-backup.agekey
cat >/etc/blockwise/product-backup.env <<'EOF'
BLOCKWISE_PRODUCT_ENV_FILE=/srv/blockwise/product/.env
BLOCKWISE_ENCRYPTED_BACKUP_DIR=/srv/blockwise/product/backups/encrypted
BLOCKWISE_BACKUP_KEY_FILE=/etc/blockwise/product-backup.agekey
BLOCKWISE_BACKUP_RETENTION_DAYS=90
EOF
chown root:root /etc/blockwise/product-backup.env; chmod 600 /etc/blockwise/product-backup.env
install -d -m 700 /srv/blockwise/product/backups/encrypted
install -o root -g root -m 750 "$ROOT/scripts/vps/product-encrypted-backup.sh" /usr/local/libexec/blockwise-product-encrypted-backup
install -o root -g root -m 750 "$ROOT/scripts/vps/product-backup-verify.sh" /usr/local/libexec/blockwise-product-backup-verify
install -o root -g root -m 750 "$ROOT/scripts/vps/product-backup-verify.sh" /usr/local/libexec/product-backup-verify.sh
cat >/etc/systemd/system/blockwise-product-backup.service <<'EOF'
[Unit]
Description=Encrypted Blockwise product backup
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
User=root
EnvironmentFile=/etc/blockwise/product-backup.env
ExecStart=/usr/local/libexec/blockwise-product-encrypted-backup
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=/srv/blockwise/product/backups/encrypted
EOF
cat >/etc/systemd/system/blockwise-product-backup.timer <<'EOF'
[Unit]
Description=Daily encrypted Blockwise product backup
[Timer]
OnCalendar=*-*-* 03:15:00 UTC
Persistent=true
RandomizedDelaySec=15m
Unit=blockwise-product-backup.service
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now blockwise-product-backup.timer
