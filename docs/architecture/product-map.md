# Product Map

Blockwise is organized around a few shared primitives rather than separate products with separate backends.

## Surfaces

- Operator Console: workspace oversight, AI spend, agent queue, approval queue, blocked outputs, sync failures, and managed-service tasks.
- Monitor: connected account health, reporting snapshots, CPL, lead quality, competitor snapshots, recommendations, and alerts.
- Self-Serve: research, idea mine, campaign builder, creative studio, ad previews, lead magnets, leads, and reports.
- Agent Workforce: agent definitions, runs, steps, artifacts, schedules, permissions, and reviews.
- Model Control: grouped model profile dropdowns, OpenRouter-routed model selection, fallbacks, spend policies, kill switches, and usage ledger.

## Data Flow

1. A workspace is created with a mode, plan, region, members, and provider connections.
2. VPS queue jobs sync provider data into reporting snapshots and lead tables.
3. Research and agent jobs write observed ads, source evidence, classifications, artifacts, and reviews.
4. Self-Serve workflows create ideas, lead magnets, campaign drafts, creative files, and approval requests.
5. AI work resolves a model profile, records usage in `ai_runs` and `ai_usage_ledger`, and blocks expensive or unsafe outputs.
6. Publishing checks provider health, compliance status, draft payloads, and human approval before any provider write.
7. Lead ingestion dedupes identities, labels quality, attributes sources, and audits exports.

## Runtime Boundaries

- Vercel handles Next.js pages and request/response route handlers.
- Supabase handles Auth, Postgres, RLS, Storage, and workspace isolation.
- Supabase `job_queue` and the VPS worker handle durable jobs, retries, and provider syncs; Vercel Cron enqueues schedules.
- External agent runtimes are adapters and must use scoped Blockwise APIs.

