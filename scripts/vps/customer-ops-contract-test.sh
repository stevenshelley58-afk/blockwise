#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/customer-ops/docker-compose.yml"
PRODUCT_COMPOSE_FILE="$ROOT_DIR/infra/coolify/docker-compose.product.yml"
PRODUCT_ENV="$(mktemp)"
CUSTOMER_ENV="$(mktemp)"
CADDY_TEST="$(mktemp)"
trap 'rm -f "$PRODUCT_ENV" "$CUSTOMER_ENV" "$CADDY_TEST"' EXIT
DOCKER_BIN="${DOCKER_BIN:-docker}"
[[ -f "$COMPOSE_FILE" ]] || { echo 'customer-ops compose file missing' >&2; exit 1; }
for service in postgres mariadb redis mautic mautic-cron mautic-worker chatwoot-prepare chatwoot-web chatwoot-worker snagtime-web snagtime-worker smtp-client; do
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
grep -q '"\${BLOCKWISE_MAIL_PUBLIC_HOST:?BLOCKWISE_MAIL_PUBLIC_HOST is required}"' "$PRODUCT_COMPOSE_FILE" || { echo 'product-mail alias interpolation is not fail-closed and quoted' >&2; exit 1; }
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
SUPABASE_SERVICE_ROLE_KEY_HOST_FILE=/tmp/blockwise-service-role
BLOCKWISE_WORKER_EXPECTED_REVISION=0123456789abcdef0123456789abcdef01234567
TOKEN_ENCRYPTION_KEY=contract-token
TRUSTED_PROXY_RANGES=127.0.0.1/32
BLOCKWISE_MAIL_PUBLIC_HOST=mail.example.com
EOF
"$DOCKER_BIN" compose --env-file "$PRODUCT_ENV" -f "$PRODUCT_COMPOSE_FILE" --profile mail config --quiet || { echo 'product mail profile Compose config failed' >&2; exit 1; }
cat > "$CUSTOMER_ENV" <<'EOF'
BLOCKWISE_MAIL_PUBLIC_HOST=mail.example.com
MAIL_PUBLIC_HOST=mail.example.com
MAUTIC_HOST=crm.example.com
CHATWOOT_HOST=https://support.example.com
SNAGTIME_HOST=book.example.com
MAUTIC_EMAIL_FROM=crm@example.com
CHATWOOT_EMAIL_FROM=support@example.com
SNAGTIME_EMAIL_FROM=booking@example.com
EMAIL_REPLY_TO=support@example.com
EMAIL_SENDER_DOMAIN=example.com
MAUTIC_SMTP_USER=mautic
CHATWOOT_SMTP_USER=chatwoot
SNAGTIME_SMTP_USER=snagtime
CHATWOOT_INBOX_USER=support
GOOGLE_CLIENT_ID=contract-google-client
SNAGTIME_IMAGE=ghcr.io/example/snagtime@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
SNAGTIME_REVISION=0123456789abcdef0123456789abcdef01234567
CUSTOMER_OPS_SECRETS_DIR=/tmp/blockwise-customer-ops-contract-secrets
EOF
"$DOCKER_BIN" compose --env-file "$CUSTOMER_ENV" -f "$COMPOSE_FILE" config --quiet || { echo 'customer-ops Compose config failed' >&2; exit 1; }
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
grep -q -- '--tls-sni-name' "$ROOT_DIR/scripts/vps/customer-ops-smoke.sh" || { echo 'SMTP SNI verification missing' >&2; exit 1; }
grep -q -- '-verify_hostname' "$ROOT_DIR/scripts/vps/customer-ops-install.sh" || { echo 'OpenSSL hostname verification missing' >&2; exit 1; }
grep -q 'swapon --show=SIZE --bytes' "$ROOT_DIR/scripts/vps/customer-ops-install.sh" || { echo 'active swap-size gate missing' >&2; exit 1; }
grep -q 'urlsplit' "$ROOT_DIR/scripts/vps/customer-ops-install.sh" || { echo 'URL hostname parsing contract missing' >&2; exit 1; }
! grep -Eq '\$\{CHATWOOT_HOST[#%]|host[[:space:]]*=[[:space:]]*https' "$ROOT_DIR/scripts/vps/customer-ops-install.sh" || { echo 'literal scheme can reach DNS/TLS host checks' >&2; exit 1; }
grep -q 'readlink -f' "$ROOT_DIR/scripts/vps/customer-ops-install.sh" || { echo 'installer symlink path guard missing' >&2; exit 1; }
grep -q -- '--config "$config"' "$ROOT_DIR/scripts/vps/customer-ops-smoke.sh" || { echo 'swaks secret config-file contract missing' >&2; exit 1; }
grep -q -- 'curl --config "$config"' "$ROOT_DIR/scripts/vps/customer-ops-smoke.sh" || { echo 'curl secret config-file contract missing' >&2; exit 1; }
! grep -Eq -- 'swaks.*--auth-password|psql.*--set=[^ ]*password=|mariadb(-dump)?.*--password=' "$ROOT_DIR/scripts/vps/customer-ops-smoke.sh" "$ROOT_DIR/infra/customer-ops/postgres-init/001-roles.sh" "$ROOT_DIR/scripts/vps/customer-ops-backup.sh" "$ROOT_DIR/docs/runbooks/customer-ops-vps.md" || { echo 'secret appears in process argv contract' >&2; exit 1; }
! grep -q 'rawurlencode(\$argv' "$ROOT_DIR/infra/customer-ops/mautic-entrypoint.sh" || { echo 'Mautic SMTP secret appears in PHP argv contract' >&2; exit 1; }
grep -q 'key:file:' "$ROOT_DIR/scripts/vps/customer-ops-smoke.sh" || { echo 'webhook key-file contract missing' >&2; exit 1; }
grep -q 'fresh_until' "$ROOT_DIR/scripts/vps/customer-ops-smoke.sh" || { echo 'Frank freshness schema check missing' >&2; exit 1; }
grep -q '/api/ops/overview' "$ROOT_DIR/scripts/vps/customer-ops-smoke.sh" || { echo 'Frank real ops endpoint missing' >&2; exit 1; }
grep -q 'schema://frank.ops/v1' "$ROOT_DIR/scripts/vps/customer-ops-smoke.sh" || { echo 'Frank overview schema check missing' >&2; exit 1; }
grep -q 'publication_receipt_id' "$ROOT_DIR/scripts/vps/customer-ops-smoke.sh" || { echo 'Frank publication receipt check missing' >&2; exit 1; }
grep -q 'source_receipt_ids' "$ROOT_DIR/scripts/vps/customer-ops-smoke.sh" || { echo 'Frank source receipt check missing' >&2; exit 1; }
grep -q 'stalwart-backup.sh' "$ROOT_DIR/scripts/vps/customer-ops-backup.sh" || { echo 'product-mail backup integration missing' >&2; exit 1; }
grep -q 'product-mail' "$ROOT_DIR/scripts/vps/customer-ops-restore.sh" || { echo 'product-mail restore coverage missing' >&2; exit 1; }
grep -q 'sha256sum --check' "$ROOT_DIR/scripts/vps/customer-ops-restore.sh" || { echo 'product-mail checksum validation missing' >&2; exit 1; }
grep -q 'refusing to overwrite' "$ROOT_DIR/scripts/vps/customer-ops-restore.sh" || { echo 'restore receipt no-clobber guard missing' >&2; exit 1; }
grep -q 'mktemp.*customer-ops-restore-receipt' "$ROOT_DIR/scripts/vps/customer-ops-restore.sh" || { echo 'restore receipt temporary publication missing' >&2; exit 1; }
grep -q 'ln --.*RECEIPT' "$ROOT_DIR/scripts/vps/customer-ops-restore.sh" || { echo 'restore receipt atomic publication missing' >&2; exit 1; }
grep -q 'RESTORE_PROJECT}-mail-config:/target' "$ROOT_DIR/docs/runbooks/customer-ops-vps.md" || { echo 'isolated product-mail restore volume import missing' >&2; exit 1; }
grep -q 'BLOCKWISE_MAIL_CONFIG_VOLUME_NAME=' "$ROOT_DIR/docs/runbooks/customer-ops-vps.md" || { echo 'isolated product-mail Compose volume override missing' >&2; exit 1; }
CADDY_VALIDATOR='caddy:2.11.3-alpine@sha256:86deaf5e3d3408a6ccec08fbb79989783dd26e206ae10bcf78a801dc8c9ab794'
grep -q "$CADDY_VALIDATOR" "$ROOT_DIR/scripts/vps/customer-ops-install.sh" || { echo 'pinned Caddy validator missing' >&2; exit 1; }
grep -q "$CADDY_VALIDATOR" "$ROOT_DIR/.github/workflows/hard-reset-verification.yml" || { echo 'CI Caddy validator digest differs or is missing' >&2; exit 1; }
grep -q 'customer-ops-contract-test.sh' "$ROOT_DIR/.github/workflows/hard-reset-verification.yml" || { echo 'customer-ops contract test is not wired into CI' >&2; exit 1; }
grep -q 'BLOCKWISE_OPS_PROJECTION_WORKER' "$PRODUCT_COMPOSE_FILE" || { echo 'Blockwise projection worker feature gate missing' >&2; exit 1; }
grep -q 'WORKER_REAP_INTERVAL_MS' "$PRODUCT_COMPOSE_FILE" || { echo 'worker recovery scheduler is not configured' >&2; exit 1; }
grep -q 'healthcheck:' "$PRODUCT_COMPOSE_FILE" || { echo 'product worker healthcheck missing' >&2; exit 1; }
grep -q 'BLOCKWISE_WORKER_EXPECTED_REVISION:?BLOCKWISE_WORKER_EXPECTED_REVISION is required' "$PRODUCT_COMPOSE_FILE" || { echo 'worker expected revision guard missing' >&2; exit 1; }
grep -q 'SUPABASE_SERVICE_ROLE_KEY_FILE: /run/secrets/supabase-service-role' "$PRODUCT_COMPOSE_FILE" || { echo 'worker service-role file env missing' >&2; exit 1; }
! awk -v service='product-worker' '$0 ~ "^  " service ":" { in_service=1; next } in_service && /^  [A-Za-z0-9_-]+:/ { exit } in_service && /^    build:/ { found=1 } END { exit found ? 0 : 1 }' "$PRODUCT_COMPOSE_FILE" || { echo 'production product-worker build section remains' >&2; exit 1; }
! grep -q 'ops-projections:rw' "$ROOT_DIR/worker/docker-compose.worker.yml" || { echo 'standalone worker must not write Frank projections' >&2; exit 1; }
test "$(grep -c '/data/ops-projections:rw' "$PRODUCT_COMPOSE_FILE")" -eq 1 || { echo 'projection root must have exactly one active writer' >&2; exit 1; }
grep -q 'ops-projections:ro' "$ROOT_DIR/infra/frank/docker-compose.customer-ops.yml" || { echo 'Frank read-only projection handoff missing' >&2; exit 1; }
grep -Eq '^FROM node:[^@]+@sha256:[0-9a-f]{64}' "$ROOT_DIR/worker/Dockerfile" || { echo 'worker base image is not digest-pinned' >&2; exit 1; }
! grep -q 'contract-placeholder' "$COMPOSE_FILE" || { echo 'moving placeholder image remains' >&2; exit 1; }
grep -q 'run --rm --no-deps' "$ROOT_DIR/scripts/vps/customer-ops-smoke.sh" || { echo 'private-network IMAPS client contract missing' >&2; exit 1; }
grep -q -- '--profile smoke' "$ROOT_DIR/scripts/vps/customer-ops-smoke.sh" || { echo 'private-network SMTP client profile missing' >&2; exit 1; }
grep -q -- '--tls-sni-name' "$ROOT_DIR/scripts/vps/customer-ops-install.sh" || { echo 'installer SMTP SNI contract missing' >&2; exit 1; }
grep -q -- '--profile smoke' "$ROOT_DIR/scripts/vps/customer-ops-install.sh" || { echo 'installer private SMTP client profile missing' >&2; exit 1; }
grep -q 'CONTROL_EDGE_IMAGE' "$ROOT_DIR/ops/control-edge/docker-compose.yml" || { echo 'control-edge immutable image contract missing' >&2; exit 1; }
! grep -Eq '^    build:' "$ROOT_DIR/ops/control-edge/docker-compose.yml" || { echo 'production control-edge build section remains' >&2; exit 1; }
grep -Eq '^FROM node:[^@]+@sha256:[0-9a-f]{64}$' "$ROOT_DIR/ops/control-edge/Dockerfile" || { echo 'control-edge base image is not digest-pinned' >&2; exit 1; }
grep -q 'CONTROL_EDGE_INTERNAL_AUTH_HOST_FILE' "$ROOT_DIR/ops/control-edge/docker-compose.yml" || { echo 'control-edge strict per-file secret mount missing' >&2; exit 1; }
grep -q 'healthcheck:' "$ROOT_DIR/ops/control-edge/docker-compose.yml" || { echo 'control-edge healthcheck missing' >&2; exit 1; }
grep -q 'customer-ops-bootstrap.sh' "$ROOT_DIR/scripts/vps/customer-ops-bootstrap.sh" || { echo 'customer-ops bootstrap script missing' >&2; exit 1; }
grep -q 'MAUTIC_LIFECYCLE_FIELDS_JSON' "$ROOT_DIR/scripts/vps/customer-ops-bootstrap.sh" || { echo 'Mautic lifecycle field bootstrap contract missing' >&2; exit 1; }
grep -q 'fields/contact/new' "$ROOT_DIR/scripts/vps/customer-ops-bootstrap.sh" || { echo 'Mautic documented fields API bootstrap missing' >&2; exit 1; }
grep -q 'tags/new' "$ROOT_DIR/scripts/vps/customer-ops-bootstrap.sh" || { echo 'Mautic tag API bootstrap missing' >&2; exit 1; }
grep -q 'verify_mautic_resource segments' "$ROOT_DIR/scripts/vps/customer-ops-bootstrap.sh" || { echo 'Mautic segment verification missing' >&2; exit 1; }
grep -q 'verify_mautic_resource campaigns' "$ROOT_DIR/scripts/vps/customer-ops-bootstrap.sh" || { echo 'Mautic campaign verification missing' >&2; exit 1; }
grep -q 'api_access_token' "$ROOT_DIR/scripts/vps/customer-ops-bootstrap.sh" || { echo 'Chatwoot official auth header missing' >&2; exit 1; }
! grep -q 'chatwoot_webhook_secret' "$ROOT_DIR/scripts/vps/customer-ops-bootstrap.sh" || { echo 'undocumented webhook secret filename remains' >&2; exit 1; }
grep -q 'chatwoot_webhook_probe_secret' "$ROOT_DIR/scripts/vps/customer-ops-bootstrap.sh" || { echo 'webhook probe secret contract missing' >&2; exit 1; }
for service in mautic-cron mautic-worker snagtime-worker; do
  awk -v service="$service" '$0 ~ "^  " service ":" { in_service=1; next } in_service && /^  [A-Za-z0-9_-]+:/ { exit } in_service { print }' "$ROOT_DIR/infra/customer-ops/docker-compose.yml" | grep -q 'healthcheck:' || { echo "$service healthcheck missing" >&2; exit 1; }
done
grep -q 'SNAGTIME_WORKER_HEARTBEAT_FILE' "$ROOT_DIR/infra/customer-ops/docker-compose.yml" || { echo 'SnagTime queue heartbeat contract missing' >&2; exit 1; }
grep -Fq 'accounts/${CHATWOOT_ACCOUNT_ID}/inboxes' "$ROOT_DIR/scripts/vps/customer-ops-bootstrap.sh" || { echo 'Chatwoot email inbox API bootstrap missing' >&2; exit 1; }
grep -Fq 'accounts/${CHATWOOT_ACCOUNT_ID}/webhooks' "$ROOT_DIR/scripts/vps/customer-ops-bootstrap.sh" || { echo 'Chatwoot webhook API bootstrap missing' >&2; exit 1; }
! grep -qi 'adapter.*deferred' "$ROOT_DIR/docs/runbooks/customer-ops-vps.md" || { echo 'obsolete adapter deferred language remains' >&2; exit 1; }
grep -q 'FROM alpine:3.22.1@sha256:' "$ROOT_DIR/infra/customer-ops/smtp-client/Dockerfile" || { echo 'SMTP client base image is not digest-pinned' >&2; exit 1; }
if grep -Eq '(^|[/:])latest([@:]|$)' "$COMPOSE_FILE"; then echo 'floating latest image tag found' >&2; exit 1; fi
for script in customer-ops-install.sh customer-ops-backup.sh customer-ops-restore.sh customer-ops-smoke.sh customer-ops-bootstrap.sh customer-ops-contract-test.sh; do
  bash -n "$ROOT_DIR/scripts/vps/$script"
done
bash -n "$ROOT_DIR/infra/customer-ops/postgres-init/001-roles.sh"
echo 'customer-ops contract checks passed'
