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
[[ -f "$ENV_FILE" && -f "$RESTIC_PASSWORD_FILE" && -n "$REPOSITORY" ]] || { usage >&2; exit 64; }
[[ "$REPOSITORY" =~ ^(sftp|s3|rest|rclone|b2|azure|gs): ]] || { echo 'repository must be an off-host restic backend (sftp:, s3:, rest:, rclone:, b2:, azure:, or gs:)' >&2; exit 64; }
[[ "$(stat -c '%a' "$RESTIC_PASSWORD_FILE" 2>/dev/null || stat -f '%Lp' "$RESTIC_PASSWORD_FILE")" == 600 ]] || { echo 'restic password file must be mode 0600' >&2; exit 64; }
command -v restic >/dev/null || { echo 'restic is required' >&2; exit 69; }
command -v docker >/dev/null || { echo 'docker is required' >&2; exit 69; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/customer-ops/docker-compose.yml"
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
WORK_DIR="$(mktemp -d /var/tmp/blockwise-customer-ops-backup.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT
export RESTIC_REPOSITORY="$REPOSITORY" RESTIC_PASSWORD_FILE
compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

compose exec -T postgres sh -c 'PGPASSWORD="$(cat /run/secrets/postgres_owner_password)" pg_dumpall -U "$POSTGRES_USER" --globals-only' > "$WORK_DIR/postgres-globals.sql"
compose exec -T postgres sh -c 'PGPASSWORD="$(cat /run/secrets/postgres_owner_password)" pg_dump -U "$POSTGRES_USER" -d chatwoot --format=custom' > "$WORK_DIR/chatwoot.dump"
compose exec -T postgres sh -c 'PGPASSWORD="$(cat /run/secrets/postgres_owner_password)" pg_dump -U "$POSTGRES_USER" -d snagtime --format=custom' > "$WORK_DIR/snagtime.dump"
compose exec -T postgres sh -c 'PGPASSWORD="$(cat /run/secrets/postgres_owner_password)" pg_dump -U "$POSTGRES_USER" -d frank_projection --format=custom' > "$WORK_DIR/frank_projection.dump"
compose exec -T mariadb sh -c 'mariadb-dump --all-databases --single-transaction -uroot --password="$(cat /run/secrets/mautic_db_root_password)"' > "$WORK_DIR/mautic.sql"
compose exec -T stalwart sh -c 'tar -C /etc/stalwart -cf - .' > "$WORK_DIR/stalwart-etc.tar"
compose exec -T stalwart sh -c 'tar -C /var/lib/stalwart -cf - .' > "$WORK_DIR/stalwart-data.tar"
compose exec -T mautic sh -c 'tar -C /var/www/html/config -cf - .' > "$WORK_DIR/mautic-config.tar"
compose exec -T mautic sh -c 'tar -C /var/www/html/docroot/media -cf - .' > "$WORK_DIR/mautic-media.tar"
compose exec -T chatwoot-web sh -c 'tar -C /app/storage -cf - .' > "$WORK_DIR/chatwoot-storage.tar"
cat > "$WORK_DIR/MANIFEST" <<'EOF'
blockwise customer-ops encrypted backup
coverage: postgres roles/chatwoot/snagtime/frank_projection, mariadb/mautic, stalwart config/data, mautic config/media, chatwoot storage
restore target must be empty and isolated; this artifact contains no runtime env file
EOF
restic backup "$WORK_DIR" --tag blockwise-customer-ops
echo 'encrypted customer-ops backup completed; credentials were not printed'
