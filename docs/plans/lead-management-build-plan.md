# Lead Management — Build Plan (for Codex)

Companion to `docs/plans/lead-management.md` (the spec). This is the **ordered,
file-level execution plan**. Build phases in order; each task lists files, the change,
and its acceptance check. Do not start a phase until the previous one is green.

## Conventions Codex MUST follow (from AGENTS.md + existing code)

- **Auth/workspace guard, every write route:** `createSupabaseServerClient()` →
  `requireWorkspaceAccess(supabase, { surface: "monitor", requestedWorkspaceId })` →
  check `access.access.role`. Returns `{ ok, access: { workspaceId, role, isOperator } }`.
  Copy the exact shape from `src/app/api/leads/[id]/quality/route.ts`.
- **Writes go through the service client** (`createSupabaseServiceClient()` from
  `@/lib/supabase/service`) AFTER the guard — never direct browser writes to `leads`.
- **Every query filters by `workspace_id`**; verify the lead belongs to
  `access.access.workspaceId` (the quality route's `maybeSingle()` check) before writing.
- **Role gate:** writes require `owner | admin | operator`; `member` is read-only.
  Export (Phase 1) requires `owner | admin`.
- **RLS helpers that exist:** `public.is_workspace_member(workspace_id uuid)` and
  `public.is_operator()`. Use these in policies — do not invent new ones.
- **Routes:** `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`
- **Migrations:** additive only (no drops); idempotent; must apply on a clean
  `supabase db reset`. Destructive changes need a row-count check first.
- **Acceptance for every PR:** `npm run typecheck` + `npm run test` pass; runtime
  verified on a Vercel Preview URL (never localhost); if trigger.dev tasks or migrations
  changed, deploy/apply and confirm they register before merge.
- **Secrets** (ClickSend, etc.) are server-side only; never shipped to the client.

---

# PHASE 1 — Lead workflow + email + CSV (no new dependencies)

Goal: app feels complete using only existing infra (Supabase, Resend, trigger.dev).

### 1.1 — Migration: status, assignee, activity, events RLS
**File:** `supabase/migrations/<timestamp>_lead_management.sql` (new)
- Create enum `public.lead_status` = `('new','contacted','qualified','won','lost','archived')`.
- `alter table public.leads add column status public.lead_status not null default 'new',
  add column assigned_to uuid references public.profiles(id) on delete set null,
  add column last_activity_at timestamptz not null default now();`
- Indexes: `(workspace_id, status)` and `(workspace_id, assigned_to)`.
- `lead_events`: ensure RLS on; `select` policy `using (public.is_workspace_member(workspace_id))`;
  insert/update/delete `to authenticated using/with check (false)` (server-owned).
- `leads`: add server-owned update/delete policies `to authenticated using/with check (false)`;
  leave the existing member `select` policy intact.
**Accept:** `supabase db reset` applies clean; `\d public.leads` shows new columns; RLS enabled.

### 1.2 — Status + event helpers (shared lib)
**File:** `src/lib/operator/overview.ts` (edit) or new `src/lib/leads/status.ts`
- Add `normalizeLeadStatus(value): LeadStatus | null` (mirror `normalizeLeadQualityLabel`).
- Add `logLeadEvent(serviceSupabase, { workspaceId, leadId, eventType, metadata })` helper
  that inserts a `lead_events` row and bumps `leads.last_activity_at` in one place.
- Extend `listLeadRowsWithDedupe` select to include `status, assigned_to, last_activity_at`.
**Accept:** unit test for `normalizeLeadStatus` (valid/invalid); typecheck passes.

### 1.3 — Base lead route (status + assignee)
**File:** `src/app/api/leads/[id]/route.ts` (new)
- `GET` → lead + latest quality + source attribution + `lead_events` timeline (for the drawer).
- `PATCH` → body `{ workspaceId, status?, assignedTo? }`; validate `status` via
  `normalizeLeadStatus`; verify `assignedTo` is a member of the workspace; update via
  service client; call `logLeadEvent` (`status_changed` / `assigned`).
**Accept:** test workspace isolation (lead from another workspace → 404) and role gate
(`member` → 403); invalid status → 400.

### 1.4 — Notes + contacted routes
**Files:** `src/app/api/leads/[id]/notes/route.ts`, `src/app/api/leads/[id]/contacted/route.ts` (new)
- `notes` `POST { workspaceId, note }` → `logLeadEvent('note_added', { note, actor })`.
- `contacted` `POST { workspaceId, channel }` → `logLeadEvent('contacted', { channel, actor })`.
**Accept:** events appear in `GET /api/leads/[id]`; role gate enforced.

### 1.5 — Bulk actions
**File:** `src/app/api/leads/bulk/route.ts` (new)
- `POST { workspaceId, ids[], status?, assignedTo? }` → validate all `ids` belong to the
  workspace; apply update; one `logLeadEvent` per lead. Cap `ids.length` (e.g. ≤ 500).
**Accept:** mixed-workspace id list is rejected wholesale (no partial cross-workspace write).

### 1.6 — Inbox UI
**Files:** `src/app/(customer)/leads/page.tsx` (edit),
`src/app/(customer)/leads/lead-status-select.tsx` (new, model on `lead-quality-select.tsx`),
`src/app/(customer)/leads/lead-assignee-select.tsx` (new)
- Replace the static New/Duplicate pill with a real **status dropdown**.
- Add **Assignee** column (workspace-member picker), row checkboxes + bulk bar
  (set status / assign / export CSV), and filters (status, assignee, quality, duplicates).
- Default sort `last_activity_at desc`. Keep empty state + mobile card list (add status/assignee).
**Accept:** dropdowns persist via the routes; disabled for `member`; mobile list renders.

### 1.7 — Lead detail drawer
**File:** `src/app/(customer)/leads/lead-detail-drawer.tsx` (new)
- Opens on row click; shows identity, source/campaign, quality, status, assignee, and the
  **activity timeline** from `lead_events`. Includes Add-note box + Mark-contacted button.
**Accept:** timeline reflects actions taken in 1.3–1.4 without page reload.

### 1.8 — Instant lead email (Resend)
**Files:** `src/lib/notify/lead-alert-email.ts` (new, mirror `demo-request-email.ts`);
hook into the ingest point `src/lib/providers/meta-leads-worker.ts` (where `leads` is inserted).
- On new lead, load the workspace owner/members' `profiles.notification_preferences`;
  if `leadAlerts`, send a Resend email. Reuse `RESEND_API_KEY`; add `LEAD_NOTIFY_FROM` env.
- Failures must not block ingest (log + continue, like the demo helper).
**Accept:** toggling `leadAlerts` off suppresses the email; ingest still succeeds if Resend unset.

### 1.9 — Daily digest (trigger.dev cron)
**File:** `trigger/lead-digest.ts` (new; model on `trigger/provider-sync.ts`)
- `schedules.task({ id: "lead-daily-digest", cron: "0 22 * * *", ... })`; for each workspace
  with `dailyDigest` enabled, summarize the day's new leads + quality breakdown via Resend.
- Add a `dailyDigest` key to `NOTIFICATION_OPTIONS` in
  `src/app/(customer)/settings/notifications-section.tsx`.
**Accept:** task registers (`npx trigger.dev@latest deploy` / dev); digest sends for a seeded workspace.

### 1.10 — CSV export (audited)  ⚠ blocked on Terms decision below
**File:** `src/app/api/leads/export/route.ts` (new)
- `GET ?workspaceId&status=&assignee=` → CSV of matching leads; write a `lead_export_audits`
  row (`destination='csv_download'`, `exported_by=profile`, `row_count`); log `exported` events.
- Gate to `owner | admin`.
**Accept:** every download writes exactly one `lead_export_audits` row; RLS respected.

**DECISION REQUIRED (blocks 1.10 only):** `/terms` says leads aren't exported "without a
separate in-application human approval." Ruling needed: does a customer exporting *their own*
leads to CSV require an `approval_requests` gate, or is audit-logging sufficient?
Recommended default: own-data CSV allowed + audited; external delivery (Phase 2) keeps the gate.

---

# PHASE 2 — Generic webhook delivery

Goal: get leads into users' own tools (Zapier/Make/most CRMs) with no per-vendor code.

### 2.1 — Webhook delivery on new lead
**Files:** extend existing `src/lib/providers/lead-delivery-worker.ts`; ingest hook in `meta-leads-worker.ts`
- When a workspace's lead destination is `webhook`, `POST` a signed JSON payload to the
  configured URL; record a `lead_delivery_attempts` row (`destination_type='webhook'`,
  status `queued→delivered/failed`) with retry/backoff.
- Sign with an HMAC using a per-workspace secret; include the secret-setup UI in settings.
**Accept:** a test endpoint receives the payload; failed deliveries are retried and logged.

### 2.2 — Settings: webhook destination config
**File:** `src/app/(customer)/settings/connections-section.tsx` (edit)
- The `webhook` destination type already exists; wire URL + signing-secret fields and a
  "Send test event" button. Persist to the existing destination config.
**Accept:** test event produces a `lead_delivery_attempts` row and reaches the URL.

---

# PHASE 3 — SMS (ClickSend) + direct CRM connectors

Goal: the two ambitious channels. **Blocked on external accounts/creds** — Codex builds the
code; the human provides credentials and compliance sign-off.

### 3.1 — SMS via ClickSend
**File:** `src/lib/notify/sms.ts` (new; `sendSms()` mirroring the Resend helper)
- ClickSend REST: `POST https://rest.clicksend.com/v3/sms/send`, HTTP Basic auth
  (`CLICKSEND_USERNAME` + `CLICKSEND_API_KEY` secrets, server-side only).
- Trigger on new lead alongside the email (1.8), gated on a new `smsAlerts` toggle.
- Requires a phone field + **opt-in** on the profile; enforce opt-out (AU Spam Act).
**Accept:** with creds set, a seeded opt-in profile receives a text; no creds → no-op (logged).
**BLOCKED ON:** ClickSend account + credit + API key in the secret store.

### 3.2 — Direct CRM connectors (HubSpot / Salesforce)
**Files:** new adapters under `src/lib/providers/crm/`; reuse `lead-delivery-worker.ts`
abstraction so a CRM is just another `destination_type`.
- Each CRM: OAuth app + token in `private.provider_token_vault` (service-role only) +
  field mapping (lead → contact). Build on Phase 2's delivery worker, not a parallel path.
**Accept:** a connected sandbox CRM receives a mapped contact on new lead; tokens vaulted.
**BLOCKED ON:** HubSpot/Salesforce OAuth app registration + sandbox credentials.

---

## Required env / secrets summary

| Var | Phase | Notes |
|---|---|---|
| `RESEND_API_KEY` | 1 | exists (demo email) |
| `LEAD_NOTIFY_FROM` | 1 | new sender address |
| (webhook signing secret, per-workspace) | 2 | stored with destination config |
| `CLICKSEND_USERNAME`, `CLICKSEND_API_KEY` | 3 | ClickSend account |
| CRM OAuth client id/secret(s) | 3 | per CRM, vaulted |

## Suggested PR slicing

P1: (a) 1.1–1.2 migration+helpers, (b) 1.3–1.5 API, (c) 1.6–1.7 UI, (d) 1.8–1.9 email/digest,
(e) 1.10 CSV. P2: one PR. P3: one PR per channel (SMS, then each CRM).
