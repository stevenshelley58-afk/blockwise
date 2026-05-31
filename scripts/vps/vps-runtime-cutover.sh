#!/usr/bin/env bash
# Convert /opt/blockwise from the legacy research runtime to the Hermes-owned
# runtime. Run on the VPS as root after a backup has been created.

set -euo pipefail

DEPLOY_REF="${DEPLOY_REF:-codex/research-hard-reset-live}"
BLOCKWISE_GIT_URL="${BLOCKWISE_GIT_URL:-https://github.com/stevenshelley58-afk/blockwise.git}"
HERMES_BASE_IMAGE="${HERMES_BASE_IMAGE:-nousresearch/hermes-agent@sha256:5b8f62a9d6675142c8db6c43681134e019e015d6bac98645381607513aba6c44}"
BLOCKWISE_HERMES_IMAGE="${BLOCKWISE_HERMES_IMAGE:-blockwise/hermes-research:0d53483}"
UPTIME_KUMA_IMAGE="${UPTIME_KUMA_IMAGE:-louislam/uptime-kuma:1.23.16}"
HERMES_DEFAULT_MODEL="${HERMES_DEFAULT_MODEL:-openai/gpt-4o-mini}"
HERMES_ESCALATION_MODEL="${HERMES_ESCALATION_MODEL:-anthropic/claude-sonnet-4}"

old=/opt/blockwise
stamp="$(date +%Y%m%d-%H%M%S)"
manual_backup=""

if [ ! -d "$old" ]; then
  echo "missing /opt/blockwise" >&2
  exit 1
fi

if [ ! -d "$old/.git" ]; then
  manual_backup="/opt/blockwise.manual-backup-$stamp"
  mv "$old" "$manual_backup"
  git clone "$BLOCKWISE_GIT_URL" "$old"
  cp -a "$manual_backup/.env" "$old/.env"
  chmod 600 "$old/.env"
fi

cd "$old"
git fetch origin
git checkout "$DEPLOY_REF"
git pull --ff-only

set -a
. ./.env
set +a

: "${SUPABASE_URL:?missing SUPABASE_URL in /opt/blockwise/.env}"
: "${SUPABASE_SERVICE_ROLE_KEY:?missing SUPABASE_SERVICE_ROLE_KEY in /opt/blockwise/.env}"
: "${OPENROUTER_API_KEY:?missing OPENROUTER_API_KEY in /opt/blockwise/.env}"
: "${MEM0_API_KEY:?missing MEM0_API_KEY in /opt/blockwise/.env}"
: "${BROWSERBASE_API_KEY:?missing BROWSERBASE_API_KEY in /opt/blockwise/.env}"
: "${BROWSERBASE_PROJECT_ID:?missing BROWSERBASE_PROJECT_ID in /opt/blockwise/.env}"
: "${HERMES_WEBHOOK_SECRET:?missing HERMES_WEBHOOK_SECRET in /opt/blockwise/.env}"

cat > .env.next <<EOF_ENV
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
OPENROUTER_API_KEY=$OPENROUTER_API_KEY
MEM0_API_KEY=$MEM0_API_KEY
MEM0_PROJECT_ID=${MEM0_PROJECT_ID:-blockwise-research}
BROWSERBASE_API_KEY=$BROWSERBASE_API_KEY
BROWSERBASE_PROJECT_ID=$BROWSERBASE_PROJECT_ID
HERMES_WEBHOOK_SECRET=$HERMES_WEBHOOK_SECRET
HERMES_PROVIDER=openrouter
HERMES_DEFAULT_MODEL=$HERMES_DEFAULT_MODEL
HERMES_ESCALATION_MODEL=$HERMES_ESCALATION_MODEL
HERMES_RESEARCH_MODE=maintain
HERMES_BUILD_CONCURRENCY=4
HERMES_MAINTAIN_CONCURRENCY=1
HERMES_COLLECTION_INTERVAL_SECONDS=900
HERMES_DAILY_SPEND_LIMIT_USD=25
HERMES_RESEARCH_AD_CREATIVES_BUCKET=research-ad-creatives
HERMES_RESEARCH_SCREENSHOTS_BUCKET=research-screenshots
HERMES_RESEARCH_RAW_EVIDENCE_BUCKET=research-raw-evidence
HERMES_SUPABASE_URL=$SUPABASE_URL
HERMES_SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
HERMES_BASE_IMAGE=$HERMES_BASE_IMAGE
BLOCKWISE_HERMES_IMAGE=$BLOCKWISE_HERMES_IMAGE
UPTIME_KUMA_IMAGE=$UPTIME_KUMA_IMAGE
BLOCKWISE_RESEARCH_RUNTIME_OWNER=hermes
BLOCKWISE_RESEARCH_RUNTIME_ENABLED=false
EOF_ENV

chmod 600 .env.next
mv .env ".env.pre-hard-reset-runtime-$stamp"
mv .env.next .env

docker rm -f blockwise-orchestrator blockwise-meta-ad-library-collector blockwise-hermes >/dev/null 2>&1 || true
docker compose --env-file .env -f infra/coolify/docker-compose.research.yml config --quiet
docker compose --env-file .env -f infra/coolify/docker-compose.research.yml up -d --build hermes uptime-kuma

echo "manual_backup=$manual_backup"
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
