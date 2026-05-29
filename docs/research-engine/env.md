# Research Engine Environment Variables

The ad collector is self-hosted on the VPS. There are no actor-marketplace variables in the
active runtime.

```bash
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

AD_COLLECTOR_PROVIDER=searchapi_meta
SELF_HOSTED_META_COLLECTOR_URL=http://meta-ad-library-collector:9100
META_AD_LIBRARY_COLLECTOR_URL=http://meta-ad-library-collector:9100
SEARCHAPI_API_KEY=
SEARCHAPI_BASE_URL=https://www.searchapi.io/api/v1/search
SEARCHAPI_ESTIMATED_COST_PER_RUN_USD=0
META_AD_LIBRARY_API_TOKEN=
META_GRAPH_VERSION=v20.0
AD_COLLECTOR_COUNTRY=AU
AD_COLLECTOR_ACTIVE_STATUS=active
AD_COLLECTOR_RESULTS_LIMIT_PER_PAGE=50
AD_COLLECTOR_DAILY_SPEND_LIMIT_USD=0
META_COLLECTOR_COOKIE_JSON=
META_COLLECTOR_PROFILE_DIR=/data/profile

HERMES_BASE_URL=https://hermes.blockwise.sale
HERMES_API_TOKEN=
HERMES_WEBHOOK_SECRET=
OPENROUTER_API_KEY=
MEM0_API_KEY=
MEM0_PROJECT_ID=blockwise-research
BROWSERBASE_API_KEY=
BROWSERBASE_PROJECT_ID=

RESEARCH_RAW_EVIDENCE_BUCKET=research-raw-evidence
RESEARCH_AD_CREATIVES_BUCKET=research-ad-creatives
RESEARCH_SCREENSHOTS_BUCKET=research-screenshots
```

`META_COLLECTOR_COOKIE_JSON` is optional and must only contain cookies from an
operator-controlled session. Login walls and checkpoints are failed runs, not
zero-ad results.
