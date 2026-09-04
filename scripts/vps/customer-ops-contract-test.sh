#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/customer-ops/docker-compose.yml"
PRODUCT_COMPOSE_FILE="$ROOT_DIR/infra/coolify/docker-compose.product.yml"
PRODUCT_ENV="$(mktemp)"
CADDY_TEST="$(mktemp)"
trap 'rm -f "$PRODUCT_ENV" "$CADDY_TEST"' EXIT
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
grep -q 'customer-ops-mail:' "$PRODUCT_COMPOSE_FILE" || { echo 'product-mail is not attached to shared mail network' >&2; exit 1; }
grep -q '"\${BLOCKWISE_MAIL_PUBLIC_HOST:-mail.example.com}"' "$PRODUCT_COMPOSE_FILE" || { echo 'product-mail alias interpolation is not quoted' >&2; exit 1; }
grep -q 'aliases:' "$PRODUCT_COMPOSE_FILE" || { echo 'product-mail TLS identity alias missing' >&2; exit 1; }
cat > "$PRODUCT_ENV" <<'EOF'
BLOCKWISE_APP_IMAGE=ghcr.io/example/blockwise:contract
BLOCKWISE_WORKER_IMAGE=ghcr.io/example/blockwise-worker:contract
BLOCKWISE_AUTH_ANON_KEY=contract-anon
BLOCKWISE_AUTH_API_EXTERNAL_URL=https://auth.example.com
BLOCKWISE_AUTH_JWT_SECRET=contract-jwt
BLOCKWISE_AUTH_SITE_URL=https://example.com
BLOCKWISE_BACKUP_DIR=/tmp/blockwise-backups
BLOCKWISE_DB_AUTHENTICATOR_PASSWORD=contract-db-auth
BLOCKWISE_DB_AUTHENTICATOR=contract-authenticator
BLOCKWISE_DB_NAME=blockwise
BLOCKWISE_DB_PASSWORD=contract-db-password
BLOCKWISE_DB_USER=blockwise
BLOCKWISE_MAIL_PUBLIC_URL=https://mail.example.com
BLOCKWISE_PRODUCT_DOMAIN=example.com
BLOCKWISE_PUBLIC_URL=https://example.com
BLOCKWISE_REALTIME_DB_ENC_KEY=contract-realtime-db
BLOCKWISE_REALTIME_SECRET_KEY_BASE=contract-realtime-secret
BLOCKWISE_STORAGE_SERVICE_KEY=contract-storage
BLOCKWISE_WORKER_IMAGE=ghcr.io/example/blockwise-worker:contract
BOOKING_PROVIDER=snagtime
NEXT_PUBLIC_APP_URL=https://example.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=contract-anon
NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.com
SUPABASE_SERVICE_ROLE_KEY=contract-service
TOKEN_ENCRYPTION_KEY=contract-token
TRUSTED_PROXY_RANGES=127.0.0.1/32
BLOCKWISE_MAIL_PUBLIC_HOST=mail.example.com
EOF
docker compose --env-file "$PRODUCT_ENV" -f "$PRODUCT_COMPOSE_FILE" --profile mail config --quiet || { echo 'product mail profile Compose config failed' >&2; exit 1; }
sed -e 's|\${MAUTIC_HOST}|crm.example.com|g' -e 's|\${CHATWOOT_HOST}|support.example.com|g' -e 's|\${SNAGTIME_HOST}|book.example.com|g' "$ROOT_DIR/infra/customer-ops/Caddyfile.snippets.tmpl" > "$CADDY_TEST"
! grep -Eq '\$\{[A-Za-z_][A-Za-z0-9_]*\}' "$CADDY_TEST" || { echo 'Caddy template render left placeholders' >&2; exit 1; }
grep -q '^crm.example.com {' "$CADDY_TEST" && grep -q '^support.example.com {' "$CADDY_TEST" && grep -q '^book.example.com {' "$CADDY_TEST" || { echo 'Caddy template host render failed' >&2; exit 1; }
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
grep -q '/var/www/html/var$' "$COMPOSE_FILE" || { echo 'mautic writable var volume contract missing' >&2; exit 1; }
grep -q -- '--tls-verify' "$ROOT_DIR/scripts/vps/customer-ops-smoke.sh" || { echo 'SMTP certificate verification missing' >&2; exit 1; }
grep -q -- '-verify_hostname' "$ROOT_DIR/scripts/vps/customer-ops-install.sh" || { echo 'OpenSSL hostname verification missing' >&2; exit 1; }
grep -q 'swapon --show=SIZE --bytes' "$ROOT_DIR/scripts/vps/customer-ops-install.sh" || { echo 'active swap-size gate missing' >&2; exit 1; }
grep -q 'fresh_until' "$ROOT_DIR/scripts/vps/customer-ops-smoke.sh" || { echo 'Frank freshness schema check missing' >&2; exit 1; }
grep -q 'run --rm --no-deps' "$ROOT_DIR/scripts/vps/customer-ops-smoke.sh" || { echo 'private-network IMAPS client contract missing' >&2; exit 1; }
if grep -Eq '(^|[/:])latest([@:]|$)' "$COMPOSE_FILE"; then echo 'floating latest image tag found' >&2; exit 1; fi
for script in customer-ops-install.sh customer-ops-backup.sh customer-ops-restore.sh customer-ops-smoke.sh; do
  bash -n "$ROOT_DIR/scripts/vps/$script"
done
echo 'customer-ops contract checks passed'
