# Blockwise

Blockwise is a multi-tenant real-estate lead-generation platform. One Next.js app
exposes three permission surfaces — **monitor-only client**, **self-serve
client**, and **operator** — over shared, workspace-isolated data.

New here? Read `CLAUDE.md` (conventions + module map), then
`docs/architecture/ARCHITECTURE.md`.

## Stack

- Next.js App Router hosted on Vercel
- Supabase Auth, Postgres, RLS, and Storage
- Trigger.dev for durable jobs and schedules
- OpenAI direct and OpenRouter-routed model profiles with operator-controlled swapping

## Local Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and fill in local or hosted service credentials.
3. Run `npm run dev`.
4. Open `http://localhost:3000`.

## Verification

- `npm test` runs the Node test suite for model resolution, agent permissions, and provider mocks.
- `npm run typecheck` runs TypeScript checks.
- `npm run build` verifies the Vercel/Next.js production build.

Production-live paths now use Supabase-backed workspace data, live provider sync helpers, OpenAI/OpenRouter provider adapters, and approval-gated provider publish requests. Keep `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` until Meta/Google app review, provider account IDs, token vault entries, and human approval flows have been verified in production.

Security hardening docs live in `docs/security/ai-workforce-safety.md` and `docs/security/client-data-isolation.md`.

## Documentation

- `CLAUDE.md` — developer conventions, module map, the "agent" naming rule
- `docs/architecture/ARCHITECTURE.md` — system design & runtime boundaries
- `docs/architecture/capability-model.md` — the three surfaces & capabilities
- `docs/architecture/DATABASE_SCHEMA.md` — data dictionary
- `docs/api/API_REFERENCE.md` — HTTP route inventory
- `docs/research-engine/` — Hermes research engine
- `docs/archive/` — superseded/historical docs

## Implemented Product Routes

- `/operator` workspace oversight and approval queues
- `/monitor` provider reporting and sync health
- `/self-serve` idea mine and builder workflow
- `/research` competitor signals and compliance classifier
- `/campaigns` publishing readiness and blockers
- `/leads` lead inbox, quality labels, and dedupe state
- `/approvals` human approval gates
- `/ai-workforce` AI Workforce automation runs and permissions (was `/agents`)
- `/model-control` grouped model profile dropdowns, OpenRouter readiness, and AI ledger
