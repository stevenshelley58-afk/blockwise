# Architecture

Blockwise is **one Next.js application** exposing three permission surfaces over
shared, workspace-isolated data. It is not three separate apps. This document is
the high-level map; see `capability-model.md` for access rules,
`DATABASE_SCHEMA.md` for the data model, and `../api/API_REFERENCE.md` for routes.

## Runtime boundaries

| Runtime | Responsibility |
| --- | --- |
| **Vercel / Next.js** | App Router pages and API route handlers (`src/app/`). Server components do auth + data loading. |
| **Supabase** | Auth, Postgres, Row-Level Security, Storage. Every tenant row carries a non-null `workspace_id`; RLS fails closed. |
| **Trigger.dev** | Durable jobs, schedules, retries: provider sync, Meta publish/mutation, lead delivery, AI Workforce runs (`trigger/`). Runs with the service-role key and **bypasses RLS** — so jobs enforce access in code. |
| **Hermes** | A remote research supervisor (separate VPS deploy, `hermes/`) running Claude skills that populate the Postgres `research` schema. The app reads research data and controls Hermes via `/api/operator/research/*`. |
| **Model providers** | OpenAI (direct) and OpenRouter (routed), selected per-task by the model registry with cost policy + kill switches. |

## The three surfaces

```
Client workspace surface            Operator surface
  monitor   (read-only)               cross-workspace management
  adstudio  (self-serve authoring)    run-for-client
                                      approvals & publishing
Shared business workflows            Hermes research control
  approvals  publishing               API / provider control
  leads      reporting                model control
```

Surfaces are gated by **capabilities** derived from `(role, workspaceMode,
isOperator)`. See `capability-model.md`.

## Code structure

```
src/
  app/
    (customer)/    monitor, ad-studio, self-serve, campaigns, leads, research, onboarding
    (operator)/    operator, operator/research, approvals
    (workforce)/   ai-workforce, model-control      # operator-only
    (legal)/       privacy, terms, data-deletion    # public
    api/           ~58 route handlers (see API_REFERENCE.md)
  ui/              UI components (app-shell, sidebar-nav, adstudio, monitor, approvals, …)
  modules/         business logic, one folder per domain (see CLAUDE.md module map)
trigger/           Trigger.dev task definitions
supabase/migrations/  SQL schema (source of truth for the data model)
hermes/            remote research supervisor (skills + runtime tools)
tests/             node:test suites
e2e/               Playwright
```

> Route groups in parentheses do not affect URLs. The `(customer)` /
> `(workforce)` groupings are historical; the durable concept is the
> **client vs operator** split enforced by capabilities, not the folder names.

## Request lifecycle (typical)

1. A request hits a server component or API route handler.
2. Auth + workspace membership resolve via `requireWorkspaceAccess` /
   `requireCapability` (`src/modules/auth/`). Operator status comes from
   `profiles.is_operator`.
3. The handler reads/writes Supabase under RLS (client/server key) or enqueues a
   Trigger.dev job for durable work.
4. Jobs run with the service-role key, re-check access in code
   (`assertJobCapability`), perform provider I/O, and write results + an
   `audit_logs` entry via `recordAudit`.

## Data flow

1. A workspace is created with a mode (`monitor` | `self_serve`), plan, region,
   members, and provider connections.
2. Trigger.dev jobs sync provider data into reporting snapshots and lead tables.
3. Hermes research skills populate the `research` schema (real-estate agents,
   agencies, advertiser pages, observed ads) under strict safety rules.
4. Self-serve authoring (AdStudio) produces brand kits, campaigns, creatives, and
   export packages; submissions become approval requests.
5. AI work resolves a model profile, records usage in `ai_runs` /
   `ai_usage_ledger`, and blocks runs that exceed cost or data-class policy.
6. Publishing checks provider health, compliance, and **human approval** before
   any provider write (and only when `BLOCKWISE_ENABLE_PROVIDER_WRITES=true`).
7. Lead ingestion dedupes identities, labels quality, attributes sources, and
   audits exports.

## Safety invariants

- Multi-tenant, fail-closed: no data leaves a workspace without explicit context.
- Provider tokens live in a private vault, never in workspace-readable tables.
- AI Workforce runs use a signed runtime policy and never receive service-role
  keys, provider tokens, or unnecessary lead PII by default.
- Operator actions (publish, run-for-client, approvals, API/model/Hermes changes)
  are audited with actor identity and affected workspace.

See `../security/ai-workforce-safety.md` and
`../security/client-data-isolation.md`.
