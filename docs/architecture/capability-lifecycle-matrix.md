# Capability / Lifecycle Matrix

> Standing artifact for catching **category-level gaps** — entire capabilities that
> *should* exist for a given entity but were never built. File-by-file review can't
> find these because an absence has no file to read. Re-run this diff each release.
>
> Method: for every product entity, check it has a full lifecycle —
> **Create · Read · Update · Pause/Archive · Delete · Export** — across all three
> layers (DB table → API/handler → customer UI). A missing cell is a candidate gap.
>
> Generated 2026-06-16 from README routes, `product-map.md`, `src/app`, `src/app/api`,
> `src/lib`, and `supabase/migrations`. Confidence noted per row; verify before acting.

## Legend

- `Y` present · `—` absent · `op` operator-only (no customer surface) · `?` unconfirmed
- "Path" = where the write happens: `api` = `/api` route handler, `client` = browser→Supabase (RLS-gated)

## Matrix (selected core entities)

| Entity | Table | Create | Read | Update | Pause/Archive | Delete | Export | Write path |
|---|---|---|---|---|---|---|---|---|
| Ad Studio campaign | `adstudio_campaigns` | Y | Y | Y | Y (draft) | Y | Y (export pkg) | api |
| **Live Meta ad** (post-publish) | `meta_publish_plans` | Y | Y | Y (mutations) | Y (pause/activate) | — | Y (export_leads) | api |
| **Live Google ad** (post-publish) | `provider_connections` | — | — | **—** | **—** | **—** | — | — |
| Brand kit | `adstudio_brand_kits` | Y | Y | Y | Y (approve) | **—** | n/a | api |
| **Lead** (customer inbox) | `leads` | (ingest) | Y | quality only | **—** | **—** | **—** (deliver only) | client |
| Team member | `workspace_members` | Y (invite) | Y | Y (role) | n/a | Y (remove) | n/a | client |
| Notification prefs | `profiles` | n/a | Y | Y | n/a | n/a | n/a | client |
| Provider connection (Meta) | `provider_connections` | Y | Y | Y (setup) | n/a | Y (disconnect) | n/a | api |
| Provider connection (Google) | `provider_connections` | Y | Y | **—** | n/a | **—** (no disconnect) | n/a | api |
| Competitor watchlist | `competitor_watchlists` | **?** | op | **?** | **?** | **?** | n/a | ? |
| Model profile | `model_profiles` | n/a | Y | Y | Y (kill-switch) | n/a | n/a | api |
| Approval request | `approval_requests` | Y | Y | Y (approve/reject) | n/a | n/a | n/a | api |
| Agent definition | `agent_definitions` | **?** | op | **?** | **?** | **?** | n/a | ? |

## Confirmed gaps (verified in code)

### 1. Customer lead inbox is read-only — the platform's core entity has no workflow
`src/app/(customer)/leads/` contains only `page.tsx` + `lead-quality-select.tsx`. A user
can *label quality* but cannot set a status (new → contacted → won/lost), add a note,
assign an owner, or manually export. For a "real-estate lead-generation platform," the
thing customers buy has no management surface. Same class as "no ad management."

### 2. Google integration is connect-only
`api/integrations/google/` has just `connect` + `callback`. Meta has
`disconnect`, `data-deletion`, `publish-plans`, `setup`. Consequences:
- No way to **disconnect** Google (Meta can).
- No publish/mutation path for Google (can't manage Google ads at all).
- **Compliance**: no Google `data-deletion` endpoint mirroring Meta's.

### 3. No live management for Google ads
The Meta mutation layer (`lib/providers/meta-mutations.ts`: activate / pause /
increase_budget / export_leads, exposed via `publish-plans/[id]/mutations`) — the
ad-management capability being added now — has **no Google equivalent**.

## Needs confirmation (table exists, no surface found)

- **Competitor watchlist** (`competitor_watchlists`): referenced only by an agent's
  job description; no customer add/remove surface located. May be operator-seeded.
- **Agent definitions / schedules** (`agent_definitions`, `agent_schedules`): only
  `GET /agent-runs` found; no create/edit/disable surface located. May be config-as-data.
- **Lead magnets / landing captures** (`lead_magnets`, `landing_captures`): tables exist;
  no CRUD surface located.

## Root-cause finding — *why* gaps like this slip through

There are **two write paths**, and they hide absences differently:
- **Operator / Ad Studio / Meta** writes go through `/api` route handlers (server-guarded).
- **Customer-facing** writes (team role, notification prefs, lead quality) go
  **browser → Supabase directly**, relying on RLS.

A customer capability that wasn't built as a React component simply doesn't exist *and
leaves no API route to make the absence visible*. Reviewing "the ad" never surfaces
"there's no Google disconnect" or "leads can't be worked" because nothing points at the
hole. The fix is structural: keep this matrix current and diff it each release, the same
way `AGENTS.md` encodes safety/acceptance checks.
