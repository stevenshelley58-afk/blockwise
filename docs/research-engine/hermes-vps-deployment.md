# Hermes VPS Deployment

Date: 2026-06-07

This is the deployment contract for the hard-reset research runtime. This agent
did not run these commands.

## Runtime Shape

The active compose stack contains:

| Service | Container name | Port binding |
| --- | --- | --- |
| `hermes` | `blockwise-hermes` | `127.0.0.1:8642:8642`, `127.0.0.1:9119:9119` |
| `steel` | `blockwise-steel` | none; exposes `3000` and `9223` on the internal `research` network only |
| `uptime-kuma` | `blockwise-uptime-kuma` | `127.0.0.1:3001:3001` |

The stack does not include `research-orchestrator` or
`meta-ad-library-collector`.

## Required Image Pins

Set these before deploying:

```bash
HERMES_BASE_IMAGE=ghcr.io/nousresearch/hermes-agent:v2026.5.29.2
BLOCKWISE_HERMES_IMAGE=blockwise/hermes-research:2026-06-02
STEEL_IMAGE=ghcr.io/steel-dev/steel-browser@sha256:a00aab6f14689b4a873c5a581714ce8aa233956eb73f283099cb7b0345043f30
UPTIME_KUMA_IMAGE=louislam/uptime-kuma:1.23.16
```

`HERMES_BASE_IMAGE` must be a concrete version tag or digest. Do not use
`:latest`. `v2026.5.29.2` is Hermes Agent v0.15.2. `STEEL_IMAGE` must be a
concrete digest or pinned tag. Steel needs about 4 GB of host RAM headroom;
confirm VPS capacity before raising the compose memory limit.

## Required Environment

```bash
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
OPENROUTER_API_KEY=<key>
HERMES_PROVIDER=openrouter
HERMES_API_SERVER_KEY=<secret>
HERMES_GATEWAY_HOST_PORT=8642
HERMES_DASHBOARD_HOST_PORT=9119
HERMES_DEFAULT_MODEL=openai/gpt-5.5
HERMES_ESCALATION_MODEL=openai/gpt-5.5-pro
HERMES_RESEARCH_MODE=maintain
HERMES_BUILD_CONCURRENCY=4
HERMES_MAINTAIN_CONCURRENCY=1
HERMES_COLLECTION_INTERVAL_SECONDS=900
HERMES_DAILY_SPEND_LIMIT_USD=25
HERMES_RESEARCH_RAW_EVIDENCE_BUCKET=research-raw-evidence
HERMES_RESEARCH_AD_CREATIVES_BUCKET=research-ad-creatives
HERMES_RESEARCH_SCREENSHOTS_BUCKET=research-screenshots
HERMES_META_CAPTURE_RESULTS_LIMIT=250
MEM0_API_KEY=<key>
MEM0_PROJECT_ID=blockwise-research
HERMES_REMOTE_BROWSER_CDP_URL=http://blockwise-steel:9223
HERMES_WEBHOOK_SECRET=<secret>
BLOCKWISE_RESEARCH_RUNTIME_ENABLED=false
```

Do not configure legacy worker variables such as `ORCHESTRATOR_*`,
`AD_COLLECTOR_PROVIDER`, `SELF_HOSTED_META_COLLECTOR_URL`,
`META_AD_LIBRARY_COLLECTOR_URL`, `META_COLLECTOR_*`, `SEARCHAPI_*`, or
`META_AD_LIBRARY_API_TOKEN` in the active runtime.

## Deploy

Operator-only sequence:

```bash
cd /opt/blockwise
docker compose -f infra/coolify/docker-compose.research.yml config --quiet
docker compose -f infra/coolify/docker-compose.research.yml up -d --build steel hermes uptime-kuma
```

The end-to-end helper script is:

```bash
CONFIRM_LIVE_RESEARCH_RESET=YES \
SUPABASE_DB_URL='<postgres-url>' \
SUPABASE_URL='https://<ref>.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='<service-role-key>' \
VPS_SSH_TARGET='<user>@<host>' \
DEPLOY_REF='<approved-branch-tag-or-sha>' \
BLOCKWISE_GIT_URL='<repo-url>' \
bash scripts/vps/research-hard-reset-deploy.sh
```

It backs up Supabase research schemas, inventories research storage buckets,
applies the hard-reset migration, backs up `/opt/blockwise`, deploys the
Hermes-only compose stack, and runs the smoke checks. It does not print secret
values.

## Verify

Operator-only checks:

```bash
docker compose -f infra/coolify/docker-compose.research.yml ps
curl -fsS http://127.0.0.1:8642/health
curl -fsSI http://127.0.0.1:9119/
curl -fsS http://127.0.0.1:3001
```

Expected:

1. `blockwise-hermes` is running.
2. `blockwise-steel` is running with no public port binding for `3000` or
   `9223`.
3. `blockwise-uptime-kuma` is running.
4. No active container named `research-orchestrator`.
5. No active container named `meta-ad-library-collector`.
6. No active container bind-mounts `workers/**`.
