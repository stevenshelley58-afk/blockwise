# Research Engine — environment variables

These are NOT in `.env.example` (deliberately — main `.env.example` is for
Blockwise app vars). Add them to `.env.local` for local development and to
Coolify env vars on the VPS deployment. Never commit real values.

```bash
# ---------------------------------------------------------------------------
# Apify — primary ad data source for Meta Ad Library
# ---------------------------------------------------------------------------
APIFY_API_TOKEN=
APIFY_DEFAULT_ACTOR=apify/facebook-ads-scraper
APIFY_DAILY_SPEND_LIMIT_USD=50

# ---------------------------------------------------------------------------
# Hermes agent runtime (deployed on VPS, called via signed webhook from app)
# ---------------------------------------------------------------------------
HERMES_BASE_URL=https://hermes.blockwise.sale
HERMES_API_TOKEN=
HERMES_WEBHOOK_SECRET=

# ---------------------------------------------------------------------------
# OpenRouter — Hermes model gateway
# ---------------------------------------------------------------------------
OPENROUTER_API_KEY=

# ---------------------------------------------------------------------------
# OpenAI — embeddings only (search-by-style, similarity)
# ---------------------------------------------------------------------------
# Already in main env if other Blockwise features need it. We reuse it.

# ---------------------------------------------------------------------------
# mem0 — fuzzy memory layer
# ---------------------------------------------------------------------------
MEM0_API_KEY=
MEM0_PROJECT_ID=blockwise-research

# ---------------------------------------------------------------------------
# Browserbase — managed headless browser fallback for Hermes
# ---------------------------------------------------------------------------
BROWSERBASE_API_KEY=
BROWSERBASE_PROJECT_ID=

# ---------------------------------------------------------------------------
# Storage bucket names (created in Supabase Storage)
# ---------------------------------------------------------------------------
RESEARCH_RAW_EVIDENCE_BUCKET=research-raw-evidence
RESEARCH_AD_CREATIVES_BUCKET=research-ad-creatives
RESEARCH_SCREENSHOTS_BUCKET=research-screenshots
```

## Where each lives

| Variable                  | Local `.env.local` | Coolify VPS env | Vercel env |
| ------------------------- | ------------------ | --------------- | ---------- |
| APIFY_API_TOKEN           | yes                | yes (Hermes)    | no         |
| HERMES_BASE_URL           | yes                | no              | yes        |
| HERMES_API_TOKEN          | yes                | no              | yes        |
| HERMES_WEBHOOK_SECRET     | yes                | yes (Hermes)    | yes        |
| OPENROUTER_API_KEY        | yes                | yes (Hermes)    | no         |
| MEM0_API_KEY              | yes                | yes (Hermes)    | no         |
| BROWSERBASE_API_KEY       | yes                | yes (Hermes)    | no         |
| RESEARCH_*_BUCKET         | yes                | yes (Hermes)    | yes        |
| SUPABASE_SERVICE_ROLE_KEY | yes                | yes (Hermes)    | yes        |

The signed webhook secret is the only secret shared between Hermes (server)
and Blockwise (client of Hermes). Everything else is consumed only on the
VPS side.
