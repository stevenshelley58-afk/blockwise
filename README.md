# Blockwise

Blockwise is the customer product for turning Frank-built template packs into editable real-estate ads. A customer selects a template, supplies brand and property inputs, edits the result, saves Feed and Story renders, reviews the publish setup, and submits a gated Meta campaign workflow. Operator tools cover workspace support, approvals, provider health, leads, and model controls.

Frank owns template generation and layered packs. Blockwise consumes those packs; the old flat-clone system is not part of the product.

## Product surfaces

- Customer routes: `/ad-studio`, `/leads`, `/results`, `/settings`, and `/connect-meta`
- Restricted operator routes: `/operator`, `/workforce`, and `/model-control`
- Monitor/reporting: `/results` (`/monitor` redirects there)

## Stack and runtime

Production is the self-hosted VPS Compose stack: Next standalone app, PostgreSQL, PostgREST, GoTrue, Storage API, Caddy, and a separately gated durable worker. Supabase client packages remain protocol clients; they do not mean a managed Supabase runtime is required. Frank generation artifacts and Hermes research runtime remain separate systems.

Current release evidence belongs in the [production runbook](docs/runbooks/production-readiness.md), rather than being repeated across docs. The main branch currently contains divergent customer-ops work; do not infer that it is the deployed revision or deploy it automatically.

## Development and verification

All project work runs on the VPS via `ssh vps`, in an isolated Git worktree based on the verified deployed release. Run `npm ci --ignore-scripts` there, not on the laptop. Use `npm run dev` and an ignored VPS-only `.env.local` for development when needed. Production acceptance uses the controlled VPS/Caddy target, not a dev server or Vercel Preview. Before handoff run `npm run check:nul`, `npm run test`, `npm run typecheck`, and `npm run build`.

`npm test` is the repository test suite; `npm run test:e2e` runs Playwright. The production acceptance path, backup rules, rollback, SSH access, and extension guidance are indexed in [docs/README.md](docs/README.md).
