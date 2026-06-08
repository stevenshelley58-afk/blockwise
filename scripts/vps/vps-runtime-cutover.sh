#!/usr/bin/env bash
# Convert /opt/blockwise from the legacy research runtime to the Hermes-owned
# runtime. Run on the VPS as root after a backup has been created.

set -euo pipefail

DEPLOY_REF="${DEPLOY_REF:-codex/research-hard-reset-live}"
BLOCKWISE_GIT_URL="${BLOCKWISE_GIT_URL:-https://github.com/stevenshelley58-afk/blockwise.git}"
HERMES_BASE_IMAGE="${HERMES_BASE_IMAGE:-ghcr.io/nousresearch/hermes-agent:v2026.5.29.2}"
BLOCKWISE_HERMES_IMAGE="${BLOCKWISE_HERMES_IMAGE:-blockwise/hermes-research:${DEPLOY_REF##*/}}"
STEEL_IMAGE="${STEEL_IMAGE:-ghcr.io/steel-dev/steel-browser@sha256:a00aab6f14689b4a873c5a581714ce8aa233956eb73f283099cb7b0345043f30}"
UPTIME_KUMA_IMAGE="${UPTIME_KUMA_IMAGE:-louislam/uptime-kuma:1.23.16}"
HERMES_DEFAULT_MODEL="${HERMES_DEFAULT_MODEL:-openai/gpt-5.5}"
HERMES_ESCALATION_MODEL="${HERMES_ESCALATION_MODEL:-openai/gpt-5.5-pro}"
HERMES_REMOTE_BROWSER_CDP_URL="${HERMES_REMOTE_BROWSER_CDP_URL:-http://blockwise-steel:9223}"

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
: "${HERMES_WEBHOOK_SECRET:?missing HERMES_WEBHOOK_SECRET in /opt/blockwise/.env}"
HERMES_API_SERVER_KEY="${HERMES_API_SERVER_KEY:-$HERMES_WEBHOOK_SECRET}"

cat > .env.next <<EOF_ENV
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
OPENROUTER_API_KEY=$OPENROUTER_API_KEY
MEM0_API_KEY=$MEM0_API_KEY
MEM0_PROJECT_ID=${MEM0_PROJECT_ID:-blockwise-research}
RESEND_API_KEY=${RESEND_API_KEY:-}
HERMES_REMOTE_BROWSER_CDP_URL=$HERMES_REMOTE_BROWSER_CDP_URL
HERMES_WEBHOOK_SECRET=$HERMES_WEBHOOK_SECRET
HERMES_API_SERVER_KEY=$HERMES_API_SERVER_KEY
HERMES_PROVIDER=openrouter
HERMES_DEFAULT_MODEL=$HERMES_DEFAULT_MODEL
HERMES_ESCALATION_MODEL=$HERMES_ESCALATION_MODEL
HERMES_GATEWAY_HOST_PORT=8642
HERMES_DASHBOARD_HOST_PORT=9119
HERMES_RESEARCH_MODE=maintain
HERMES_BUILD_CONCURRENCY=4
HERMES_MAINTAIN_CONCURRENCY=1
HERMES_COLLECTION_INTERVAL_SECONDS=900
HERMES_DAILY_SPEND_LIMIT_USD=25
HERMES_META_CAPTURE_RESULTS_LIMIT=${HERMES_META_CAPTURE_RESULTS_LIMIT:-250}
HERMES_RESEARCH_AD_CREATIVES_BUCKET=research-ad-creatives
HERMES_RESEARCH_SCREENSHOTS_BUCKET=research-screenshots
HERMES_RESEARCH_RAW_EVIDENCE_BUCKET=research-raw-evidence
HERMES_META_CAPTURE_RESULTS_LIMIT=${HERMES_META_CAPTURE_RESULTS_LIMIT:-250}
HERMES_SUPABASE_URL=$SUPABASE_URL
HERMES_SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
HERMES_BASE_IMAGE=$HERMES_BASE_IMAGE
BLOCKWISE_HERMES_IMAGE=$BLOCKWISE_HERMES_IMAGE
STEEL_IMAGE=$STEEL_IMAGE
UPTIME_KUMA_IMAGE=$UPTIME_KUMA_IMAGE
BLOCKWISE_RESEARCH_RUNTIME_OWNER=hermes
BLOCKWISE_RESEARCH_RUNTIME_ENABLED=true
HERMES_QUEUE_LOOP_INTERVAL_MS=${HERMES_QUEUE_LOOP_INTERVAL_MS:-60000}
HERMES_QUEUE_CLAIM_LIMIT=${HERMES_QUEUE_CLAIM_LIMIT:-8}
HERMES_QUEUE_MAX_JOBS_PER_TICK=${HERMES_QUEUE_MAX_JOBS_PER_TICK:-8}
HERMES_RESEARCH_SUPERVISOR_POLICY_LIMIT=${HERMES_RESEARCH_SUPERVISOR_POLICY_LIMIT:-50}
HERMES_RESEARCH_TARGET_POSTCODES=${HERMES_RESEARCH_TARGET_POSTCODES:-ALL}
HERMES_META_CAPTURE_PROVIDER=${HERMES_META_CAPTURE_PROVIDER:-hermes_browser}
HERMES_META_BROWSER_TIMEOUT_MS=${HERMES_META_BROWSER_TIMEOUT_MS:-30000}
HERMES_META_BROWSER_EXECUTABLE=${HERMES_META_BROWSER_EXECUTABLE:-chromium}
HERMES_UNRESOLVED_PAGE_RECOVERY_LIMIT=${HERMES_UNRESOLVED_PAGE_RECOVERY_LIMIT:-25}
EOF_ENV

chmod 600 .env.next
mv .env ".env.pre-hard-reset-runtime-$stamp"
mv .env.next .env

docker rm -f blockwise-orchestrator blockwise-meta-ad-library-collector blockwise-hermes blockwise-steel >/dev/null 2>&1 || true
docker compose --env-file .env -f infra/coolify/docker-compose.research.yml config --quiet
docker compose --env-file .env -f infra/coolify/docker-compose.research.yml up -d --build steel hermes uptime-kuma

echo "manual_backup=$manual_backup"
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
