# Research Engine Environment Variables

Date: 2026-06-02

These variables describe the hard-reset runtime in
`infra/coolify/docker-compose.research.yml`. Do not print real secret values in
logs or docs.

## Image Pins

```bash
HERMES_BASE_IMAGE=ghcr.io/nousresearch/hermes-agent:v2026.5.29.2
BLOCKWISE_HERMES_IMAGE=blockwise/hermes-research:2026-06-02
UPTIME_KUMA_IMAGE=louislam/uptime-kuma:1.23.16
```

`HERMES_BASE_IMAGE` must not be `:latest`. `v2026.5.29.2` is the Hermes
Agent v0.15.2 release.

## Hermes Runtime

```bash
HERMES_CONFIG=/app/hermes.toml
HERMES_HOME=/opt/data
HERMES_WEBHOOK_SECRET=<secret>
HERMES_API_SERVER_KEY=<secret>
HERMES_GATEWAY_HOST_PORT=8642
HERMES_DASHBOARD_HOST_PORT=9119
HERMES_PROVIDER=openrouter
HERMES_DEFAULT_MODEL=<cheap-openrouter-model>
HERMES_ESCALATION_MODEL=<stronger-openrouter-model>
HERMES_RESEARCH_MODE=maintain
HERMES_BUILD_CONCURRENCY=4
HERMES_MAINTAIN_CONCURRENCY=1
HERMES_COLLECTION_INTERVAL_SECONDS=900
HERMES_DAILY_SPEND_LIMIT_USD=25
HERMES_META_CAPTURE_RESULTS_LIMIT=250
OPENROUTER_API_KEY=<key>
MEM0_API_KEY=<key>
MEM0_PROJECT_ID=blockwise-research
BROWSERBASE_API_KEY=<key>
BROWSERBASE_PROJECT_ID=<project-id>
```

## Research Runtime Placeholders

```bash
BLOCKWISE_RESEARCH_RUNTIME_OWNER=hermes
BLOCKWISE_RESEARCH_RUNTIME_ENABLED=false
```

`BLOCKWISE_RESEARCH_RUNTIME_ENABLED=false` is the safe deploy default.

## Supabase And Storage

```bash
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
HERMES_SUPABASE_URL=https://<ref>.supabase.co
HERMES_SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
HERMES_RESEARCH_RAW_EVIDENCE_BUCKET=research-raw-evidence
HERMES_RESEARCH_AD_CREATIVES_BUCKET=research-ad-creatives
HERMES_RESEARCH_SCREENSHOTS_BUCKET=research-screenshots
```

## Removed From Active Runtime

Do not configure these for the active reset runtime:

1. `ORCHESTRATOR_*`
2. `AD_COLLECTOR_PROVIDER`
3. `SELF_HOSTED_META_COLLECTOR_URL`
4. `META_AD_LIBRARY_COLLECTOR_URL`
5. `META_COLLECTOR_*`
6. `SEARCHAPI_*`
7. `META_AD_LIBRARY_API_TOKEN`
8. `META_GRAPH_VERSION`
9. `AD_COLLECTOR_*`
