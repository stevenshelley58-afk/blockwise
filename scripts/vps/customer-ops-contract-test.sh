#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/customer-ops/docker-compose.yml"
PRODUCT_COMPOSE_FILE="$ROOT_DIR/infra/coolify/docker-compose.product.yml"
[[ -f "$COMPOSE_FILE" ]] || { echo 'customer-ops compose file missing' >&2; exit 1; }
for service in postgres mariadb redis mautic mautic-cron mautic-worker chatwoot-prepare chatwoot-web chatwoot-worker snagtime-web snagtime-worker; do
  grep -Eq "^  ${service}:$" "$COMPOSE_FILE" || { echo "missing service: $service" >&2; exit 1; }
done
grep -q 'internal: true' "$COMPOSE_FILE" || { echo 'backend network is not private' >&2; exit 1; }
grep -q 'mautic/mautic:7.2.0-apache@sha256:' "$COMPOSE_FILE" || { echo 'Mautic image pin is stale or missing' >&2; exit 1; }
grep -q 'chatwoot/chatwoot:v4.17.1-ce@sha256:' "$COMPOSE_FILE" || { echo 'Chatwoot image pin is stale or missing' >&2; exit 1; }
grep -q 'mariadb:11.4@sha256:' "$COMPOSE_FILE" || { echo 'MariaDB image pin is stale or missing' >&2; exit 1; }
grep -q 'redis:7.4-alpine@sha256:' "$COMPOSE_FILE" || { echo 'Redis image pin is stale or missing' >&2; exit 1; }
grep -q 'stalwartlabs/stalwart:v0.16.20@sha256:' "$PRODUCT_COMPOSE_FILE" || { echo 'product-mail Stalwart image pin is stale or missing' >&2; exit 1; }
! grep -q '^  stalwart:' "$COMPOSE_FILE" || { echo 'duplicate customer-ops Stalwart server found' >&2; exit 1; }
grep -q 'name: blockwise-customer-ops-mail' "$COMPOSE_FILE" || { echo 'customer-ops mail network contract missing' >&2; exit 1; }
grep -q 'networks: \[blockwise-product, customer-ops-mail\]' "$PRODUCT_COMPOSE_FILE" || { echo 'product-mail is not attached to shared mail network' >&2; exit 1; }
grep -q 'POSTGRES_PASSWORD_FILE' "$COMPOSE_FILE" || { echo 'postgres secret-file contract missing' >&2; exit 1; }
grep -q 'cat /run/secrets/mautic_db_password' "$ROOT_DIR/infra/customer-ops/mautic-entrypoint.sh" || { echo 'mautic secret-reading wrapper missing' >&2; exit 1; }
grep -q 'export MAUTIC_DB_PASSWORD=' "$ROOT_DIR/infra/customer-ops/mautic-entrypoint.sh" || { echo 'mautic official password contract missing' >&2; exit 1; }
grep -q 'mautic_smtp_password' "$COMPOSE_FILE" || { echo 'Mautic SMTP secret missing' >&2; exit 1; }
grep -q 'chatwoot_smtp_password' "$COMPOSE_FILE" || { echo 'Chatwoot SMTP secret missing' >&2; exit 1; }
grep -q 'snagtime_smtp_password' "$COMPOSE_FILE" || { echo 'SnagTime SMTP secret missing' >&2; exit 1; }
grep -q 'encryption=tls&auth_mode=login' "$ROOT_DIR/infra/customer-ops/mautic-entrypoint.sh" || { echo 'Mautic STARTTLS DSN contract missing' >&2; exit 1; }
grep -q 'SECRET_KEY_BASE_FILE' "$COMPOSE_FILE" || { echo 'chatwoot secret-file contract missing' >&2; exit 1; }
grep -q 'DATABASE_URL_FILE' "$COMPOSE_FILE" || { echo 'snagtime secret-file contract missing' >&2; exit 1; }
grep -q 'db:chatwoot_prepare' "$COMPOSE_FILE" || { echo 'chatwoot prepare gate missing' >&2; exit 1; }
grep -q '/var/www/html/docroot/media/files' "$COMPOSE_FILE" || { echo 'mautic files volume contract missing' >&2; exit 1; }
grep -q '/var/www/html/docroot/media/images' "$COMPOSE_FILE" || { echo 'mautic images volume contract missing' >&2; exit 1; }
if grep -Eq '(^|[/:])latest([@:]|$)' "$COMPOSE_FILE"; then echo 'floating latest image tag found' >&2; exit 1; fi
for script in customer-ops-install.sh customer-ops-backup.sh customer-ops-restore.sh customer-ops-smoke.sh; do
  bash -n "$ROOT_DIR/scripts/vps/$script"
done
echo 'customer-ops contract checks passed'
