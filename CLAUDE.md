# CLAUDE.md — Blockwise developer guide

Conventions and orientation for anyone (human or AI) working in this repo. Read
this before making changes.

## What Blockwise is

A multi-tenant SaaS for Australian real-estate lead generation. One Next.js app
exposes **three permission surfaces** over shared workspaces:

| Surface | Who | Can do |
| --- | --- | --- |
| **Monitor-only client** | `mode = monitor` members | View campaigns, spend, leads, reporting |
| **Self-serve client** | `mode = self_serve` members | Monitor + create/edit/submit ads, manage brand kits (owners/admins also approve & publish) |
| **Operator** | `profiles.is_operator = true` | Everything, across all workspaces: run-for-client, approvals, Hermes research, API & model controls |

It is **one app with permission surfaces**, not three apps. See
`docs/architecture/capability-model.md`.

## Stack

- Next.js 16 App Router (React 19) on Vercel — `src/app/`
- Supabase: Auth, Postgres, RLS, Storage — `src/lib/supabase/`, `supabase/migrations/`
- Trigger.dev durable jobs & schedules — `trigger/`
- OpenAI direct + OpenRouter-routed model profiles — `src/lib/ai/`
- Hermes: a remote research supervisor (separate deploy) — `hermes/`

## Commands

```bash
npm run dev          # local dev server on :3000
npm test             # node:test suite (tests/**/*.test.ts)
npm run typecheck    # tsc --noEmit
npm run build        # next build (Vercel parity)
npm run check        # test + typecheck
npm run test:e2e     # Playwright
npm run trigger:dev  # Trigger.dev local
```

Always run `npm run check` before considering a change done.

## The "agent" naming rule (IMPORTANT)

The word "agent" is overloaded. Use these precise terms instead:

- **AI Workforce** — the AI automation agents (research/compliance/reporting
  bots). Code lives in `src/lib/ai-workforce/` (formerly `src/lib/agents/`);
  route is `/ai-workforce`. **Do not call this "agents."**
- **Real-estate agents / agencies** — domain entities (the people we research).
  They live in the Postgres `research` schema: `research.agents`,
  `research.agencies`.
- **Hermes** — the remote research supervisor that runs Claude skills.

The database keeps the legacy `public.agent_*` table names (`agent_definitions`,
`agent_runs`, `agent_steps`, …) for the AI Workforce. These were intentionally
**not** renamed (RLS, views, and in-flight Trigger runs depend on them). They are
disambiguated from `research.agents` purely by Postgres schema. When in doubt:
`public.agent_*` = AI Workforce; `research.agents` = real-estate people.

## Access control (capabilities)

Access is **capability-based**, derived in code from `(role, workspaceMode,
isOperator)` — never stored in the DB. The source of truth is
`src/lib/auth/capabilities.ts`.

- **Server is the gate.** Route handlers call `requireCapability(cap, …)`
  (`src/lib/auth/require-capability.ts`). Jobs call `assertJobCapability(…)`
  (`src/lib/auth/job-capability.ts`) because they bypass RLS with the
  service-role key.
- UI may hide actions for UX, but that is cosmetic — never the only gate.
- Operator status comes **only** from `profiles.is_operator` (the legacy
  `OPERATOR_EMAILS` allowlist was removed).
- Sensitive operator actions are audited via `recordAudit(…)`
  (`src/lib/audit/record-audit.ts`). Run-for-client writes the operator as
  `actor_profile_id` and the affected workspace in `metadata`.

The legacy `canAccessSurface` / `ProductSurface` coarse gate still exists and is
being migrated onto capabilities; prefer `requireCapability` in new code.

## Module map (`src/lib/`)

| Module | Responsibility |
| --- | --- |
| `auth/` | Capabilities, workspace access, page guards, operator gate |
| `audit/` | Typed `audit_logs` writer |
| `ai-workforce/` | AI automation agent definitions + runtime policy |
| `ai/` | Model registry, OpenRouter client, run ledger, profile store |
| `providers/` | Meta/Google OAuth, publish/mutation/lead-delivery queues+workers |
| `research/` | Research engine schemas, ingest, normalise, Supabase writer |
| `adstudio/` | Ad creative generation, brand extraction, compliance, export |
| `campaigns/` | Publishing readiness/workflow |
| `compliance/` | AU real-estate policy checks |
| `leads/` | Lead dedupe/quality |
| `monitor/` | Dashboard data assembly |
| `operator/` | Operator console helpers |
| `product/` | Demo/live/workflow data sources |
| `config/` | Env parsing |
| `supabase/` | Client factories (server/browser/service) |

Path alias: `@/*` → `./src/*`.

## Conventions

- TypeScript strict. Imports inside `src` use the `@/` alias; relative imports
  may include the `.ts` extension (`allowImportingTsExtensions`). `trigger/`
  imports `src` via relative paths.
- Validate external/JSON input with Zod at boundaries.
- Background work goes through Trigger.dev tasks in `trigger/`. **Never change a
  Trigger task `id`** (e.g. `publish.meta.execute`, `run-agent-workflow`) — it
  orphans scheduled/in-flight runs.
- Provider writes are gated by `BLOCKWISE_ENABLE_PROVIDER_WRITES` (keep `false`
  until Meta/Google review + approvals are verified in production).
- Commit messages end with the Co-Authored-By trailer when authored with Claude.

## Docs

- `docs/architecture/ARCHITECTURE.md` — system design & runtime boundaries
- `docs/architecture/capability-model.md` — the three surfaces & capabilities
- `docs/architecture/DATABASE_SCHEMA.md` — data dictionary
- `docs/api/API_REFERENCE.md` — HTTP route inventory
- `docs/security/` — AI Workforce safety & client data isolation
- `docs/research-engine/` — Hermes research engine
- `docs/archive/` — superseded/historical docs (do not treat as current)
