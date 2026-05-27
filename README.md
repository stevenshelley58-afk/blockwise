# Blockwise

Blockwise is a real estate lead-generation platform with Monitor, Self-Serve, Operator Console, Agent Workforce, and Model Control surfaces.

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

The current implementation uses deterministic provider mocks so the first release can prove tenancy, operator control, model governance, and agent safety before live Meta/Google publishing.

Security hardening docs live in `docs/security/agent-safety.md` and `docs/security/client-data-isolation.md`.

## Implemented Product Routes

- `/operator` workspace oversight and agent/approval queues
- `/monitor` provider reporting and sync health
- `/self-serve` idea mine and builder workflow
- `/research` competitor signals and compliance classifier
- `/campaigns` publishing readiness and blockers
- `/leads` lead inbox, quality labels, and dedupe state
- `/approvals` human approval gates
- `/agents` agent workforce runs and permissions
- `/model-control` grouped model profile dropdowns, OpenRouter readiness, and AI ledger
