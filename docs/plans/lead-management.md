# Lead Management — Build Spec

Status: ready to build · Scope: customer lead inbox workflow · Out of scope: Google, Meta changes

## Problem

`leads` is the product's core entity but the customer can only label *quality*
(`/api/leads/[id]/quality`). There's no way to **work** a lead — set a status,
assign an owner, log contact, add notes, or export. This spec adds that lifecycle
without new infrastructure where existing tables already fit.

## Reuse vs. add (grounded in current schema)

| Need | Existing? | Decision |
|---|---|---|
| Quality label | `lead_quality_labels` | reuse as-is |
| Activity timeline + notes | `lead_events` (append-only, `event_type`+`metadata` jsonb) | **reuse** — no new notes table |
| Source/campaign | `lead_source_attribution` | reuse (read-only) |
| Dedupe flag | `lead_dedupe_records` | reuse (read-only) |
| Outbound delivery / CRM push | `lead_delivery_attempts`, `lead_export_audits` (approval-gated) | reuse — export rides this path |
| **Status / owner / last activity** | — none on `leads` | **add columns** (below) |

## 1. Data model (one migration)

`leads` currently has only identity + `raw_payload` + `created_at`. Add:

```sql
-- new enum
create type public.lead_status as enum
  ('new','contacted','qualified','won','lost','archived');

alter table public.leads
  add column status public.lead_status not null default 'new',
  add column assigned_to uuid references public.profiles(id) on delete set null,
  add column last_activity_at timestamptz not null default now();

create index leads_workspace_status_idx on public.leads (workspace_id, status);
create index leads_workspace_assigned_idx on public.leads (workspace_id, assigned_to);
```

Notes and contact-logging go into `lead_events`, not new columns:
`event_type` ∈ `status_changed | assigned | note_added | contacted | exported`,
with `metadata` carrying `{ from, to, note, channel, actor_profile_id }`.

`last_activity_at` is bumped by the API on every write (used for inbox sort + a
"stale lead" view later).

### RLS (match house pattern)

Writes are **server-owned** — same model as the quality route, which uses the
service client behind `requireWorkspaceAccess`, not direct browser writes. So:

```sql
-- leads & lead_events: workspace-scoped SELECT for members; writes only via service role
create policy leads_server_owned_no_client_update on public.leads
  for update to authenticated using (false) with check (false);
-- (insert/delete already server-owned via ingestion; keep select policy as-is)

alter table public.lead_events enable row level security;
create policy lead_events_workspace_select on public.lead_events
  for select using (workspace_id = any (public.current_workspace_ids()));
create policy lead_events_server_owned_no_client_insert on public.lead_events
  for insert to authenticated with check (false);
```

(Use whatever the codebase's existing workspace-scoping helper is — mirror the
SELECT policy already on `leads`.)

## 2. API routes (Next.js route handlers, `runtime = "nodejs"`)

All follow the existing `leads/[id]/quality` shape: parse body → `createSupabaseServerClient()`
→ `requireWorkspaceAccess(supabase, { surface: "monitor", requestedWorkspaceId })`
→ role check → `createSupabaseServiceClient()` for the write → append a `lead_events`
row in the same handler → return JSON.

**Role gate:** writes require `owner | admin | operator` (same as quality). `member` is read-only.

| Method · Route | Body | Effect |
|---|---|---|
| `GET /api/leads/[id]` | — | Lead + quality + source + `lead_events` timeline (detail drawer) |
| `PATCH /api/leads/[id]` | `{ workspaceId, status?, assignedTo? }` | Update status and/or owner; logs `status_changed` / `assigned`; bumps `last_activity_at` |
| `POST /api/leads/[id]/notes` | `{ workspaceId, note }` | Append `note_added` event |
| `POST /api/leads/[id]/contacted` | `{ workspaceId, channel }` | Append `contacted` event; convenience for "Mark contacted" |
| `POST /api/leads/bulk` | `{ workspaceId, ids[], status?, assignedTo? }` | Bulk status/assign for inbox checkboxes |
| `GET /api/leads/export` | `?workspaceId&status=` | CSV of selected leads — **see compliance below** |

Validation: reject unknown `status` (enum guard like `normalizeLeadQualityLabel`),
verify the lead belongs to `access.workspaceId` before writing (the quality route
already does this `maybeSingle()` check — copy it), 404 otherwise.

## 3. Export — respect the existing approval gate

`/terms` states Blockwise "does not activate, modify budgets, or **export leads**
without a separate in-application human approval," and `lead_export_audits` already
records `approval_request_id` + `exported_by` + `row_count`. So CSV export must:

- write a `lead_export_audits` row (`destination = 'csv_download'`, `exported_by = profile`),
- append an `exported` event per lead (or one batch event),
- be gated to `owner | admin`.

If a strict reading of the Terms requires an approval *request* even for self-serve
CSV, route it through `approval_requests` first. **Flag for product:** confirm
whether customer self-export of *their own* leads needs an approval gate, or only
third-party/CRM delivery does. (Recommend: own-data CSV is allowed + audited;
external delivery keeps the approval gate.)

## 4. UI

**Inbox (`/leads`)** — extend the existing table:
- Replace the static "Status" pill (currently only New/Possible-duplicate) with a
  real **status dropdown** (`LeadStatusSelect`, modeled on `LeadQualitySelect`).
- Add **Assignee** column (workspace-member picker).
- Row checkboxes + bulk bar: Set status, Assign, Export CSV.
- Filters: status, assignee, quality, duplicates. Default sort `last_activity_at desc`.
- Keep the empty state and mobile card list; add status + assignee to the card.

**Lead detail drawer** (new) — opens on row click:
- Identity, source/campaign, quality, status, assignee.
- **Activity timeline** from `lead_events` (status changes, assignments, contacts, notes).
- **Add note** box + **Mark contacted** button.

Reuse `StatusPill`, `MetricCard`, `PageHeading`, `requirePageSurfaceAccess("monitor")`,
`listLeadRowsWithDedupe` (extend its select to include `status`, `assigned_to`,
`last_activity_at`).

## 5. Acceptance (per AGENTS.md)

- Migration is tested and idempotent; `lead_status` enum + columns + RLS apply on a
  fresh `supabase db reset`; row-count safe (additive, no drops).
- Every new query filters by `workspace_id`; RLS stays enabled; writes go through
  service client behind `requireWorkspaceAccess` (no direct browser writes to `leads`).
- `npm run typecheck` + `npm run test` pass; add tests for status-enum validation,
  workspace isolation on `PATCH /api/leads/[id]`, and the export audit write.
- Runtime verified on a Vercel Preview URL, not localhost.
- Export path writes a `lead_export_audits` row every time.

## 6. Suggested build order

1. Migration (enum, columns, indexes, RLS) → `supabase db reset` + confirm.
2. `GET`/`PATCH /api/leads/[id]` + `lead_events` logging + tests.
3. Inbox status dropdown + assignee + filters.
4. Detail drawer (timeline, notes, mark-contacted).
5. Bulk actions.
6. CSV export + audit (after the compliance question in §3 is answered).

## 7. Notifications (decided: instant email + daily digest + SMS)

The settings UI **already lists** these toggles (`New leads`, `Weekly digest`) on
`profiles.notification_preferences` — but nothing reads them. The only live sender is
`sendDemoRequestNotification` (Resend). So this is wiring, plus one new channel (SMS).

- **Instant email** — on lead ingest (`scheduledMetaLeadSyncTask` / `publish-plans/[id]/leads/sync`),
  if `notification_preferences.leadAlerts`, send via **Resend** (already integrated).
  Reuse the demo-email helper's pattern. Respects existing toggle.
- **Daily digest** — new `schedules.task` cron (trigger.dev already runs many; e.g.
  `0 22 * * *` workspace-local), gated on `weeklyDigest`/a new `dailyDigest` toggle.
  Summarizes new leads + quality breakdown.
- **SMS (new dependency) — provider: ClickSend** (AU-native, pay-as-you-go, no monthly
  minimum). Integrate via the ClickSend REST API (`POST /v3/sms/send`, HTTP Basic auth
  with username + API key). Needs: a `CLICKSEND_USERNAME` + `CLICKSEND_API_KEY` secret
  (store server-side; do not expose to client), a phone field + opt-in on the profile,
  and Spam Act compliance (consent + opt-out). Gate on a new `smsAlerts` toggle; send on
  the same trigger as instant email. Implement as a `sendSms()` helper mirroring the
  Resend email helper so it slots into the §8 `destination_type` abstraction.
- **Timing caveat:** "as they come in" is bounded by the Meta sync cadence (cron), not
  truly real-time. To get closer to instant later, move ingest to a Meta leads webhook.

## 8. Connect & export (decided: CSV + webhook + direct CRM)

Settings already models lead destinations as `manual | webhook | crm`, and
`lead_delivery_attempts` + `lead_export_audits` exist — so most of this is plumbing.

- **CSV** — `GET /api/leads/export` (§2), audited via `lead_export_audits`.
- **Webhook (generic)** — fire a signed `POST {lead json}` per new lead to the user's
  URL; record a `lead_delivery_attempts` row (`destination_type='webhook'`) with retry.
  This alone unlocks Zapier/Make → any CRM with zero per-vendor code.
- **Direct CRM (new dependencies, phase it)** — native HubSpot/Salesforce connectors.
  Each needs its own OAuth app + token vault entry (`private.provider_token_vault`) +
  field mapping. Build on top of the webhook delivery abstraction so CRMs are just
  another `destination_type`, not a parallel system.

## Phased rollout (recommended order)

**Phase 1 — ships "feels complete", no new dependencies:**
status/assignee/notes/timeline (§1–§4), CSV export (§3), instant lead email + daily
digest (§7, Resend only). All buildable now against existing infra.

**Phase 2 — generic webhook delivery (§8).** Small; reuses delivery tables. Gets users
into their own tools immediately via Zapier/Make.

**Phase 3 — needs your accounts/creds, can't be done unattended:**
SMS (ClickSend account + API key + recipient opt-in) and direct CRM connectors
(HubSpot/Salesforce OAuth apps). Spec ready; blocked on credentials and compliance
sign-off. To unblock SMS: create a ClickSend account, top up credit, and put the
username + API key in the secret store — then the `sendSms()` helper is a quick add.

## Open question for product (blocks §3 only)

Does customer self-export of their own leads to CSV require an approval request, or
is audit-logging sufficient? Everything else in Phase 1 is unblocked.
