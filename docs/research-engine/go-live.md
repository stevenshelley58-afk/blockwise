# Research Engine Go-Live Runbook

Deploy the hosted-provider orchestrator and the self-hosted collector verifier
on the VPS. Use `searchapi_meta` as the primary source when the key is present.

## Required VPS Env

```bash
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
AD_COLLECTOR_PROVIDER=searchapi_meta
SELF_HOSTED_META_COLLECTOR_URL=http://meta-ad-library-collector:9100
META_AD_LIBRARY_COLLECTOR_URL=http://meta-ad-library-collector:9100
SEARCHAPI_API_KEY=<key>
META_AD_LIBRARY_API_TOKEN=<optional-official-meta-token>
AD_COLLECTOR_DAILY_SPEND_LIMIT_USD=0
OPENROUTER_API_KEY=<key>
MEM0_API_KEY=<key>
BROWSERBASE_API_KEY=<key>
BROWSERBASE_PROJECT_ID=<project-id>
HERMES_WEBHOOK_SECRET=<secret>
META_COLLECTOR_COOKIE_JSON=
```

## Deploy

```bash
cd /opt/blockwise
docker compose config --quiet
docker compose up -d --build meta-ad-library-collector hermes
```

The old collection services must stay stopped unless explicitly run under the
manual profile.

## Verify

```bash
curl -s http://127.0.0.1:9100/health
docker exec blockwise-hermes /usr/bin/python3 \
  /opt/data/skills/blockwise-ad-collector/scripts/collector_client.py health
docker compose ps
```

Expected:

- collector is healthy
- Hermes can call the collector
- `blockwise-orchestrator` is not running by default
- routine runs record the configured `source_provider`; failed runs never mark
  ads absent
