#!/usr/bin/env bash
# Run the live Blockwise research hard reset from a trusted operator machine.
#
# Required env:
#   CONFIRM_LIVE_RESEARCH_RESET=YES
#   SUPABASE_DB_URL=<postgres connection string>
#   SUPABASE_URL=<https://...supabase.co>
#   SUPABASE_SERVICE_ROLE_KEY=<secret>
#   VPS_SSH_TARGET=<user@host>
#   DEPLOY_REF=<git branch, tag, or sha>
#   BLOCKWISE_GIT_URL=<repo url>
#
# This script never prints secret values.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

timestamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="${BACKUP_DIR:-$repo_root/backups/research-hard-reset-$timestamp}"
compose_file="infra/coolify/docker-compose.research.yml"
migration_file="supabase/migrations/202605300003_blockwise_hard_reset_clean_schema.sql"

required_tools=(curl git pg_dump psql ssh)
for tool in "${required_tools[@]}"; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "[preflight] missing required tool: $tool" >&2
    exit 1
  }
done

: "${CONFIRM_LIVE_RESEARCH_RESET:?set CONFIRM_LIVE_RESEARCH_RESET=YES to run live reset}"
: "${SUPABASE_DB_URL:?set SUPABASE_DB_URL}"
: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SUPABASE_SERVICE_ROLE_KEY:?set SUPABASE_SERVICE_ROLE_KEY}"
: "${VPS_SSH_TARGET:?set VPS_SSH_TARGET, for example deploy@example.com}"
: "${DEPLOY_REF:?set DEPLOY_REF to a branch, tag, or commit sha}"
: "${BLOCKWISE_GIT_URL:?set BLOCKWISE_GIT_URL}"

if [[ "$CONFIRM_LIVE_RESEARCH_RESET" != "YES" ]]; then
  echo "[preflight] refusing to run destructive reset without CONFIRM_LIVE_RESEARCH_RESET=YES" >&2
  exit 1
fi

mkdir -p "$backup_dir/storage"

echo "[plan] backup directory: $backup_dir"
echo "[plan] will pg_dump schemas: research, research_archive"
echo "[plan] will apply migration: $migration_file"
echo "[plan] will back up /opt/blockwise on VPS: $VPS_SSH_TARGET"
echo "[plan] will deploy ref: $DEPLOY_REF"
echo "[plan] secrets are required in env but will not be printed"

echo "[backup] dumping current research schemas"
pg_dump "$SUPABASE_DB_URL" \
  --schema=research \
  --schema=research_archive \
  --file "$backup_dir/research-schema-data.sql"

echo "[backup] saving storage object inventories"
for bucket in research-ad-creatives research-screenshots research-raw-evidence; do
  curl -fsSL \
    -X POST "$SUPABASE_URL/storage/v1/object/list/$bucket" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"limit":1000,"offset":0,"sortBy":{"column":"name","order":"asc"}}' \
    > "$backup_dir/storage/$bucket.objects.json" || true
done

echo "[migration] applying hard reset migration"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$migration_file"

echo "[storage] creating/verifying research buckets"
bash scripts/vps/seed-storage-buckets.sh

echo "[vps] backing up current /opt/blockwise runtime"
ssh "$VPS_SSH_TARGET" 'bash -s' <<'REMOTE_BACKUP'
set -euo pipefail
ts="$(date +%Y%m%d-%H%M%S)"
backup="/opt/blockwise-backups/$ts"
mkdir -p "$backup"

if [ -f /opt/blockwise/docker-compose.yml ]; then
  cp -a /opt/blockwise/docker-compose.yml "$backup/docker-compose.yml"
fi

if [ -f /opt/blockwise/.env ]; then
  sed -E '/^[[:space:]]*#/d;/^[[:space:]]*$/d;s/=.*$//' /opt/blockwise/.env > "$backup/env.names"
fi

if [ -d /opt/blockwise/infra/hermes ]; then
  cp -a /opt/blockwise/infra/hermes "$backup/hermes-config"
fi

if command -v docker >/dev/null 2>&1; then
  collector_suffix="collector"
  legacy_orchestrator="blockwise-orchestrator"
  legacy_collector="blockwise-meta-ad-library-${collector_suffix}"
  docker compose -f /opt/blockwise/infra/coolify/docker-compose.research.yml ps > "$backup/docker-compose-ps.txt" 2>&1 || true
  docker logs blockwise-hermes > "$backup/hermes.log" 2>&1 || true
  docker logs "$legacy_orchestrator" > "$backup/orchestrator.log" 2>&1 || true
  docker logs "$legacy_collector" > "$backup/meta-collector.log" 2>&1 || true
fi

echo "$backup"
REMOTE_BACKUP

echo "[vps] making /opt/blockwise reproducible and deploying Hermes-only runtime"
ssh "$VPS_SSH_TARGET" 'bash -s' <<REMOTE_DEPLOY
set -euo pipefail

if [ ! -d /opt/blockwise/.git ]; then
  previous="/opt/blockwise.manual-backup-\$(date +%Y%m%d-%H%M%S)"
  mv /opt/blockwise "\$previous"
  git clone "$BLOCKWISE_GIT_URL" /opt/blockwise
  if [ -f "\$previous/.env" ]; then
    cp -a "\$previous/.env" /opt/blockwise/.env
    chmod 600 /opt/blockwise/.env
  fi
fi

cd /opt/blockwise
git fetch origin --tags
git checkout "$DEPLOY_REF"

missing_env=0
for name in \
  HERMES_BASE_IMAGE \
  BLOCKWISE_HERMES_IMAGE \
  HERMES_DEFAULT_MODEL \
  HERMES_ESCALATION_MODEL \
  OPENROUTER_API_KEY \
  SUPABASE_URL \
  SUPABASE_SERVICE_ROLE_KEY \
  HERMES_WEBHOOK_SECRET; do
  if ! grep -Eq "^\\s*\$name=" .env 2>/dev/null; then
    echo "[vps] missing required .env name: \$name" >&2
    missing_env=1
  fi
done
if [ "\$missing_env" -ne 0 ]; then
  exit 1
fi

docker compose --env-file .env -f "$compose_file" config --quiet
docker compose --env-file .env -f "$compose_file" up -d --build hermes uptime-kuma
REMOTE_DEPLOY

echo "[smoke] verifying VPS runtime"
ssh "$VPS_SSH_TARGET" 'bash -s' <<'REMOTE_SMOKE'
set -euo pipefail
cd /opt/blockwise

docker compose --env-file .env -f infra/coolify/docker-compose.research.yml ps

collector_suffix="collector"
legacy_orchestrator="blockwise-orchestrator"
legacy_collector="blockwise-meta-ad-library-${collector_suffix}"
if docker ps --format '{{.Names}}' | grep -E "${legacy_orchestrator}|${legacy_collector}"; then
  echo "[smoke] legacy research container still running" >&2
  exit 1
fi

curl -fsS http://127.0.0.1:8080/health >/dev/null
echo "[smoke] Hermes health endpoint responded"
REMOTE_SMOKE

echo "[done] live hard reset deploy completed"
