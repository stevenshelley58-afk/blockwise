#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/customer-ops/docker-compose.yml"
[[ -f "$COMPOSE_FILE" ]] || { echo 'customer-ops compose file missing' >&2; exit 1; }
for service in postgres mariadb redis stalwart mautic mautic-cron chatwoot-web chatwoot-worker snagtime-web snagtime-worker; do
  grep -Eq "^  ${service}:$" "$COMPOSE_FILE" || { echo "missing service: $service" >&2; exit 1; }
done
grep -q 'internal: true' "$COMPOSE_FILE" || { echo 'backend network is not private' >&2; exit 1; }
grep -q 'POSTGRES_PASSWORD_FILE' "$COMPOSE_FILE" || { echo 'postgres secret-file contract missing' >&2; exit 1; }
grep -q 'MAUTIC_DB_PASSWORD_FILE' "$COMPOSE_FILE" || { echo 'mautic secret-file contract missing' >&2; exit 1; }
grep -q 'SECRET_KEY_BASE_FILE' "$COMPOSE_FILE" || { echo 'chatwoot secret-file contract missing' >&2; exit 1; }
grep -q 'DATABASE_URL_FILE' "$COMPOSE_FILE" || { echo 'snagtime secret-file contract missing' >&2; exit 1; }
if grep -Eq '(^|[/:])latest([@:]|$)' "$COMPOSE_FILE"; then echo 'floating latest image tag found' >&2; exit 1; fi
for script in customer-ops-install.sh customer-ops-backup.sh customer-ops-restore.sh customer-ops-smoke.sh; do
  bash -n "$ROOT_DIR/scripts/vps/$script"
done
echo 'customer-ops contract checks passed'
