#!/usr/bin/env bash
set -Eeuo pipefail

usage() { echo 'usage: customer-ops-backup.sh --env-file FILE --repository RESTIC_REPOSITORY --password-file FILE'; }
ENV_FILE=''; REPOSITORY=''; RESTIC_PASSWORD_FILE=''
while (($#)); do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --repository) REPOSITORY="$2"; shift 2 ;;
    --password-file) RESTIC_PASSWORD_FILE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 64 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo 'customer-ops backup must run as root' >&2; exit 77; }
command -v readlink >/dev/null || { echo 'readlink is required for secret path validation' >&2; exit 69; }
[[ -n "$REPOSITORY" && "$ENV_FILE" = /* && "$RESTIC_PASSWORD_FILE" = /* && -f "$ENV_FILE" && ! -L "$ENV_FILE" && -f "$RESTIC_PASSWORD_FILE" && ! -L "$RESTIC_PASSWORD_FILE" ]] || { echo 'absolute regular env/password files are required' >&2; exit 64; }
[[ "$(readlink -f -- "$ENV_FILE")" == "$ENV_FILE" && "$(readlink -f -- "$RESTIC_PASSWORD_FILE")" == "$RESTIC_PASSWORD_FILE" ]] || { echo 'env/password path may not contain symlinks' >&2; exit 64; }
[[ "$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")" == 600 && "$(stat -c '%u' "$ENV_FILE" 2>/dev/null || stat -f '%u' "$ENV_FILE")" == 0 ]] || { echo 'env file must be root-owned mode 0600' >&2; exit 64; }
[[ "$REPOSITORY" =~ ^(sftp|s3|rest|rclone|b2|azure|gs): ]] || { echo 'repository must be an off-host restic backend (sftp:, s3:, rest:, rclone:, b2:, azure:, or gs:)' >&2; exit 64; }
[[ "$(stat -c '%a' "$RESTIC_PASSWORD_FILE" 2>/dev/null || stat -f '%Lp' "$RESTIC_PASSWORD_FILE")" == 600 && "$(stat -c '%u' "$RESTIC_PASSWORD_FILE" 2>/dev/null || stat -f '%u' "$RESTIC_PASSWORD_FILE")" == 0 ]] || { echo 'restic password file must be root-owned mode 0600' >&2; exit 64; }
command -v restic >/dev/null || { echo 'restic is required' >&2; exit 69; }
command -v docker >/dev/null || { echo 'docker is required' >&2; exit 69; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/customer-ops/docker-compose.yml"
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
SECRETS_DIR="${CUSTOMER_OPS_SECRETS_DIR:-/etc/blockwise/customer-ops/secrets}"
[[ "$SECRETS_DIR" = /* && ! -L "$SECRETS_DIR" && -d "$SECRETS_DIR" && "$(readlink -f -- "$SECRETS_DIR")" == "$SECRETS_DIR" ]] || { echo 'customer-ops secret directory must be an absolute regular non-symlink directory' >&2; exit 64; }
[[ "$(stat -c '%a' "$SECRETS_DIR" 2>/dev/null || stat -f '%Lp' "$SECRETS_DIR")" == 700 && "$(stat -c '%u' "$SECRETS_DIR" 2>/dev/null || stat -f '%u' "$SECRETS_DIR")" == 0 ]] || { echo 'customer-ops secret directory must be root-owned mode 0700' >&2; exit 64; }
WORK_DIR="$(mktemp -d /var/tmp/blockwise-customer-ops-backup.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT
export RESTIC_REPOSITORY="$REPOSITORY" RESTIC_PASSWORD_FILE
compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# The existing product-mail backup is part of this same encrypted restic
# snapshot. It refuses a running Stalwart service because live RocksDB/queue
# tarballs are not a restore proof; stop product-mail under change control first.
mkdir -p "$WORK_DIR/product-mail"
"$ROOT_DIR/scripts/vps/stalwart-backup.sh" "$WORK_DIR/product-mail" > "$WORK_DIR/product-mail/backup-receipt.json"

compose exec -T postgres sh -c 'PGPASSWORD="$(cat /run/secrets/postgres_owner_password)" pg_dumpall -U "$POSTGRES_USER" --globals-only' > "$WORK_DIR/postgres-globals.sql"
compose exec -T postgres sh -c 'PGPASSWORD="$(cat /run/secrets/postgres_owner_password)" pg_dump -U "$POSTGRES_USER" -d chatwoot --format=custom' > "$WORK_DIR/chatwoot.dump"
compose exec -T postgres sh -c 'PGPASSWORD="$(cat /run/secrets/postgres_owner_password)" pg_dump -U "$POSTGRES_USER" -d snagtime --format=custom' > "$WORK_DIR/snagtime.dump"
compose exec -T mariadb sh -c 'MYSQL_PWD="$(cat /run/secrets/mautic_db_root_password)" mariadb-dump --all-databases --single-transaction -uroot' > "$WORK_DIR/mautic.sql"
compose exec -T mautic sh -c 'tar -C /var/www/html/config -cf - .' > "$WORK_DIR/mautic-config.tar"
compose exec -T mautic sh -c 'tar -C /var/www/html/docroot/media/files -cf - .' > "$WORK_DIR/mautic-media-files.tar"
compose exec -T mautic sh -c 'tar -C /var/www/html/docroot/media/images -cf - .' > "$WORK_DIR/mautic-media-images.tar"
compose exec -T chatwoot-web sh -c 'tar -C /app/storage -cf - .' > "$WORK_DIR/chatwoot-storage.tar"
cat > "$WORK_DIR/MANIFEST" <<'EOF'
blockwise customer-ops encrypted backup
coverage: postgres roles/chatwoot/snagtime, mariadb/mautic, mautic config/media, chatwoot storage, and existing product-mail Stalwart config/data
product-mail artifacts: product-mail/stalwart-config.tar.gz, product-mail/stalwart-data.tar.gz, product-mail/SHA256SUMS
restore target must be empty and isolated; this artifact contains no runtime env file
EOF
restic backup "$WORK_DIR" --tag blockwise-customer-ops
echo 'encrypted customer-ops backup completed; credentials were not printed'
