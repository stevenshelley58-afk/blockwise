# Blockwise

Blockwise is the customer product for frustrated, nontechnical real-estate agents who want more leads without Ads Manager or agency complexity. It turns Frank-built template packs into editable real-estate ads: a customer selects a template, supplies brand and property inputs, edits the result in AdStudio, saves Feed and Story renders, reviews the publish setup, and submits a gated Meta workflow. Consistent, useful ads support more lead opportunities; no linear volume or sales outcome is guaranteed.

Frank supplies the template-generation interface; Hermes executes generation and produces layered templates. Blockwise consumes those packs; the old flat-clone system is not part of the product.

## Product surfaces

- Customer routes: `/ad-studio`, `/leads`, `/results`, `/settings`, and `/connect-meta`
- Restricted operator routes: `/operator`, `/workforce`, and `/model-control`
- Monitor/reporting: `/results` (`/monitor` redirects there)

The ordinary customer flow uses plain language and keeps campaigns, ad sets,
placements, provider IDs, and latitude/longitude details out of the way. Exact
Meta or other-provider labels remain where an external connection screen requires
them. Advanced controls, explicit budget/location choices, approvals, and legal
details remain available and are not silently changed.

## Stack and runtime

Production is the self-hosted VPS Compose stack: Next standalone app, PostgreSQL, PostgREST, GoTrue, Storage API, Caddy, and a separately gated durable worker. Provider and lead-delivery activation are separate evidence-backed gates. Supabase client packages remain protocol clients; they do not mean a managed Supabase runtime is required. Frank generation artifacts and Hermes research runtime remain separate systems.

Current release evidence belongs in the [production runbook](docs/runbooks/production-readiness.md), rather than being repeated across docs. Do not infer that the default branch is the deployed revision or deploy it automatically; verify the intended revision against live evidence.

## Development and verification

Follow the shared engineering rules and [project entry](AGENTS.md).
[Production readiness](docs/runbooks/production-readiness.md) owns the required
checks and live acceptance; this README does not duplicate them.
Development-server output is not production acceptance.

`npm test` is the repository test suite; `npm run test:e2e` runs Playwright. The production acceptance path, backup rules, rollback, SSH access, and extension guidance are indexed in [docs/README.md](docs/README.md).
