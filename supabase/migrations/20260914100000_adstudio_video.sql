-- Ad Builder Video: customer uploads and commissioned video orders.
--
-- Scope: initial launch. A customer may either keep an existing finished video
-- (no production charge) or buy one edited video for a one-off fee. Payment
-- state and fulfilment state are deliberately separate columns so a refund or
-- dispute never erases production history.
--
-- Owner decisions recorded 14 September 2026 (Steven):
--   * price A$100 ex-GST placeholder; live checkout stays gated until the
--     accountant confirms GST treatment
--   * deliverable one 20-30s vertical 1080x1920 MP4, one consolidated revision
--   * first draft due 48 business hours (Mon-Fri) after verified payment and a
--     complete brief; revision due 24 hours after feedback is submitted
--   * full refund on request any time before final delivery
--   * retention: 7 days abandoned unpaid uploads, 90 days paid source files,
--     final library videos while the account is active
--   * no narration; customer-supplied transcript or a house-licensed music bed
--   * support contact support@blockwise.sale
--
-- Every tenant row carries a non-null workspace_id. Customers may never write
-- payment state, fulfilment state, due dates, operator notes or approvals.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- video_projects
-- ---------------------------------------------------------------------------
create table if not exists public.video_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mode text not null check (mode in ('uploaded', 'commissioned')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'archived')),
  current_brief_version integer not null default 0 check (current_brief_version >= 0),
  customer_visible boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists video_projects_workspace_created_idx
  on public.video_projects (workspace_id, created_at desc);
create index if not exists video_projects_workspace_mode_idx
  on public.video_projects (workspace_id, mode, status);

-- ---------------------------------------------------------------------------
-- video_assets
-- ---------------------------------------------------------------------------
-- visibility separates customer-supplied material from operator-only
-- production material. A customer may read their own sources and previews; they
-- may never read production sources, edit projects or reviewer reports, even
-- inside their own workspace.
create table if not exists public.video_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.video_projects(id) on delete cascade,
  version_id uuid,
  kind text not null check (kind in (
    'source_upload', 'source_workspace', 'preview', 'thumbnail',
    'production_source', 'draft', 'final'
  )),
  visibility text not null default 'customer' check (visibility in ('customer', 'operator')),
  bucket_id text not null default 'adbuilder-video',
  object_path text not null,
  original_name text,
  mime_type text,
  bytes bigint check (bytes is null or bytes >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  duration_seconds numeric(10, 3) check (duration_seconds is null or duration_seconds >= 0),
  upload_state text not null default 'initiated'
    check (upload_state in ('initiated', 'uploaded', 'validating', 'ready', 'rejected')),
  rejection_reason text,
  validated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, object_path)
);

create index if not exists video_assets_project_idx on public.video_assets (project_id, kind);
create index if not exists video_assets_workspace_state_idx on public.video_assets (workspace_id, upload_state);
-- A quarantined asset is never visible to a customer read path.
create index if not exists video_assets_ready_idx
  on public.video_assets (project_id) where upload_state = 'ready';

-- ---------------------------------------------------------------------------
-- video_brief_versions
-- ---------------------------------------------------------------------------
-- Briefs are immutable once frozen. The paid order snapshots the frozen
-- version, so a later edit can never silently change what was purchased.
create table if not exists public.video_brief_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.video_projects(id) on delete cascade,
  version integer not null check (version >= 1),
  objective text,
  audience text,
  desired_action text,
  key_facts text,
  overlay_wording text,
  wants_wording_help boolean not null default false,
  transcript text,
  reference_url text check (reference_url is null or reference_url ~ '^https?://'),
  music_preference text not null default 'house_licensed'
    check (music_preference in ('house_licensed', 'customer_supplied', 'none')),
  upload_permission_confirmed boolean not null default false,
  is_complete boolean not null default false,
  completeness_issues text[] not null default '{}',
  frozen_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

create index if not exists video_brief_versions_project_idx
  on public.video_brief_versions (project_id, version desc);

-- ---------------------------------------------------------------------------
-- video_orders
-- ---------------------------------------------------------------------------
create table if not exists public.video_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.video_projects(id) on delete cascade,
  brief_version_id uuid not null references public.video_brief_versions(id) on delete restrict,
  offer_id text not null,
  offer_version integer not null default 1,
  offer_snapshot jsonb not null,
  amount_minor integer not null check (amount_minor >= 0),
  currency text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  tax_treatment text not null default 'undetermined'
    check (tax_treatment in ('undetermined', 'gst_inclusive', 'gst_exclusive', 'gst_free')),
  payment_state text not null default 'pending'
    check (payment_state in ('pending', 'paid', 'refunded', 'partially_refunded', 'disputed', 'failed')),
  fulfilment_state text not null default 'awaiting_payment'
    check (fulfilment_state in (
      'awaiting_payment', 'queued', 'editing', 'draft_ready', 'revision_requested',
      'final_ready', 'delivered', 'cancelled', 'failed', 'needs_clarification'
    )),
  ready_at timestamptz,
  first_draft_due_at timestamptz,
  due_timezone text not null default 'Australia/Sydney',
  workday_start_hour integer not null default 9 check (workday_start_hour between 0 and 23),
  workday_end_hour integer not null default 17 check (workday_end_hour between 1 and 24),
  delivery_working_days integer not null default 2 check (delivery_working_days > 0),
  revision_working_days integer not null default 1 check (revision_working_days > 0),
  revision_entitlement integer not null default 1 check (revision_entitlement >= 0),
  revisions_used integer not null default 0 check (revisions_used >= 0),
  assigned_operator uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  customer_visible boolean not null default true,
  refunded_amount_minor integer not null default 0 check (refunded_amount_minor >= 0),
  refund_reason text,
  cancelled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_orders_revisions_within_entitlement
    check (revisions_used <= revision_entitlement),
  constraint video_orders_refund_within_amount
    check (refunded_amount_minor <= amount_minor)
);

-- One paid order per project: a second successful payment for the same video is
-- a duplicate that must be surfaced, never silently fulfilled.
create unique index if not exists video_orders_one_paid_per_project_idx
  on public.video_orders (project_id) where payment_state = 'paid';
create unique index if not exists video_orders_one_live_per_project_idx
  on public.video_orders (project_id) where payment_state = 'pending';
create index if not exists video_orders_workspace_idx
  on public.video_orders (workspace_id, created_at desc);
create index if not exists video_orders_queue_idx
  on public.video_orders (fulfilment_state, first_draft_due_at)
  where payment_state = 'paid';

-- ---------------------------------------------------------------------------
-- video_payment_attempts
-- ---------------------------------------------------------------------------
-- Idempotency is scoped to the specific order and attempt. An open Checkout
-- Session for one video must never pay for another video.
create table if not exists public.video_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid not null references public.video_orders(id) on delete cascade,
  attempt_number integer not null check (attempt_number >= 1),
  provider text not null default 'stripe' check (provider = 'stripe'),
  checkout_session_id text,
  payment_intent_id text,
  status text not null default 'created'
    check (status in ('created', 'open', 'complete', 'expired', 'failed', 'cancelled')),
  amount_minor integer not null check (amount_minor >= 0),
  currency text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  idempotency_key text,
  expires_at timestamptz,
  completed_at timestamptz,
  reconciled_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, attempt_number)
);

create unique index if not exists video_payment_attempts_session_idx
  on public.video_payment_attempts (checkout_session_id) where checkout_session_id is not null;
create unique index if not exists video_payment_attempts_intent_idx
  on public.video_payment_attempts (payment_intent_id) where payment_intent_id is not null;
create unique index if not exists video_payment_attempts_live_idx
  on public.video_payment_attempts (order_id) where status in ('created', 'open');
create index if not exists video_payment_attempts_reconcile_idx
  on public.video_payment_attempts (status, created_at)
  where status in ('created', 'open');

-- ---------------------------------------------------------------------------
-- video_versions
-- ---------------------------------------------------------------------------
-- Drafts and finals. An approved version is immutable: the approval freezes it
-- so a later upload cannot rewrite what the customer signed off.
create table if not exists public.video_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.video_projects(id) on delete cascade,
  order_id uuid references public.video_orders(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  kind text not null check (kind in ('draft', 'final')),
  asset_id uuid not null references public.video_assets(id) on delete restrict,
  notes text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, version_number, kind),
  constraint video_versions_approval_pair
    check ((approved_by is null) = (approved_at is null))
);

create index if not exists video_versions_project_idx
  on public.video_versions (project_id, version_number desc);

-- ---------------------------------------------------------------------------
-- video_feedback
-- ---------------------------------------------------------------------------
-- Exactly one consolidated revision round by default, enforced server-side by
-- a partial unique index rather than by application logic alone.
create table if not exists public.video_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid not null references public.video_orders(id) on delete cascade,
  version_id uuid not null references public.video_versions(id) on delete cascade,
  revision_number integer not null check (revision_number >= 1),
  feedback_text text not null check (char_length(btrim(feedback_text)) between 1 and 4000),
  timestamped_items jsonb not null default '[]'::jsonb,
  revision_due_at timestamptz,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now()
);

create unique index if not exists video_feedback_one_per_revision_idx
  on public.video_feedback (order_id, revision_number);
create index if not exists video_feedback_order_idx
  on public.video_feedback (order_id, submitted_at desc);

-- ---------------------------------------------------------------------------
-- video_order_events
-- ---------------------------------------------------------------------------
-- Append-only audit trail. Update and delete are refused, including for the
-- service role, so the record of who changed what cannot be rewritten.
create table if not exists public.video_order_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Restrict, not cascade: the append-only trigger below refuses every delete,
  -- so a cascading parent delete would abort instead of quietly erasing the
  -- audit trail. Retiring a project or order is an explicit audited operation.
  order_id uuid references public.video_orders(id) on delete restrict,
  project_id uuid references public.video_projects(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text not null default 'system'
    check (actor_role in ('customer', 'operator', 'system', 'webhook')),
  event_type text not null,
  from_state text,
  to_state text,
  detail jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now()
);

create unique index if not exists video_order_events_idempotency_idx
  on public.video_order_events (idempotency_key) where idempotency_key is not null;
create index if not exists video_order_events_order_idx
  on public.video_order_events (order_id, created_at desc);
create index if not exists video_order_events_workspace_idx
  on public.video_order_events (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Working-day deadline
-- ---------------------------------------------------------------------------
-- The public promise is "within 48 hours on business days", which the owner
-- defined on 14 September 2026 as landing on the 2nd working day, not as 48
-- accumulated working hours (that would be six working days and would surprise
-- the customer). Weekends never consume the commitment. When the start instant
-- is already past the end of a working day, counting begins on the next one.
--
-- The customer is always shown the resulting exact local date and time, so the
-- page states a date rather than asking them to interpret a duration.
create or replace function private.video_working_day_deadline(
  starts_at timestamptz,
  working_days integer,
  timezone_name text default 'Australia/Sydney',
  workday_start integer default 9,
  workday_end integer default 17
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $fn$
declare
  remaining integer := greatest(coalesce(working_days, 1), 1);
  cursor_ts timestamptz := starts_at;
  local_ts timestamp;
  local_date date;
  local_time time;
  tz text := coalesce(nullif(timezone_name, ''), 'Australia/Sydney');
begin
  -- A null or unknown timezone must never silently drop the commitment.
  if not exists (select 1 from pg_timezone_names where name = tz) then
    tz := 'Australia/Sydney';
  end if;

  if workday_end <= workday_start then
    workday_start := 9;
    workday_end := 17;
  end if;

  -- Bounded: weekends are skipped, so a large request still terminates.
  for _step in 1..4000 loop
    local_ts := cursor_ts at time zone tz;
    local_date := local_ts::date;
    local_time := local_ts::time;

    if extract(isodow from local_date) >= 6 then
      cursor_ts := ((local_date + 1)::timestamp + make_interval(hours => workday_start)) at time zone tz;
      continue;
    end if;

    if local_time < make_interval(hours => workday_start) then
      cursor_ts := (local_date::timestamp + make_interval(hours => workday_start)) at time zone tz;
      continue;
    end if;

    if local_time >= make_interval(hours => workday_end) then
      -- Past the end of this working day: start counting on the next one.
      cursor_ts := ((local_date + 1)::timestamp + make_interval(hours => workday_start)) at time zone tz;
      continue;
    end if;

    remaining := remaining - 1;
    if remaining <= 0 then
      return (local_date::timestamp + make_interval(hours => workday_end)) at time zone tz;
    end if;

    cursor_ts := ((local_date + 1)::timestamp + make_interval(hours => workday_start)) at time zone tz;
  end loop;

  return cursor_ts;
end;
$fn$;

revoke all on function private.video_working_day_deadline(timestamptz, integer, text, integer, integer) from public;
grant execute on function private.video_working_day_deadline(timestamptz, integer, text, integer, integer)
  to anon, authenticated, service_role;

-- Superseded during development: an early draft of this migration shipped a
-- function that counted 48 accumulated working hours, which is six working
-- days. The owner's decision is a deadline on the 2nd working day, so that
-- function is replaced above and the discarded signature is removed here.
drop function if exists private.video_business_hours_deadline(timestamptz, integer, text, integer, integer);

-- ---------------------------------------------------------------------------
-- Append-only guard for the audit trail
-- ---------------------------------------------------------------------------
create or replace function private.reject_video_order_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception 'video_order_events is append-only';
end;
$fn$;

drop trigger if exists video_order_events_append_only on public.video_order_events;
create trigger video_order_events_append_only
  before update or delete on public.video_order_events
  for each row execute function private.reject_video_order_event_mutation();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.video_projects enable row level security;
alter table public.video_assets enable row level security;
alter table public.video_brief_versions enable row level security;
alter table public.video_orders enable row level security;
alter table public.video_payment_attempts enable row level security;
alter table public.video_versions enable row level security;
alter table public.video_feedback enable row level security;
alter table public.video_order_events enable row level security;

-- Deny by default: no anon access to any video table.
--
-- The browser-facing column is deliberately narrow. A customer reads and edits
-- their projects, reads their orders, versions and submitted feedback, and
-- inserts one feedback row per allocated revision. Everything else is reached
-- only through authenticated API routes holding the service role, which enforce
-- workspace scope explicitly:
--   * video_assets          storage object references
--   * video_brief_versions  the internal brief record
--   * video_payment_attempts Stripe session and payment intent identifiers
--   * video_order_events    the append-only audit trail
-- Those four are also listed in infra/product/post-migrate-api-grants.sql,
-- which is the authoritative switch that keeps a table off the PostgREST
-- browser surface. Listing them here documents the intent; that file enforces
-- it, because it runs after the whole migration set.
revoke all on public.video_projects, public.video_assets, public.video_brief_versions,
  public.video_orders, public.video_payment_attempts, public.video_versions,
  public.video_feedback, public.video_order_events
from anon;

grant select, insert, update on public.video_projects to authenticated;
grant select on public.video_orders to authenticated;
grant select on public.video_versions to authenticated;
grant select, insert on public.video_feedback to authenticated;

-- The privileged server credential needs explicit access: migrations create
-- these tables owned by postgres, and the central post-migration grants file is
-- not the only path that has to work. Granting here keeps the migration a
-- complete unit, matching the convention in the other product migrations.
grant all on public.video_projects, public.video_assets, public.video_brief_versions,
  public.video_orders, public.video_payment_attempts, public.video_versions,
  public.video_feedback, public.video_order_events
to service_role;
grant execute on function private.video_working_day_deadline(timestamptz, integer, text, integer, integer)
  to service_role;

revoke all on public.video_assets from authenticated;
revoke all on public.video_brief_versions from authenticated;
revoke all on public.video_payment_attempts from authenticated;
revoke all on public.video_order_events from authenticated;

-- Members may never write a version, an approval or a payment. Modifying those
-- runs through service-role server code so an approved version stays immutable
-- and a customer cannot attribute an approval to an operator.
revoke insert, update, delete on public.video_versions from authenticated;
revoke update, delete on public.video_feedback from authenticated;

-- video_projects: members read, members with a writing role insert and update.
drop policy if exists video_projects_select on public.video_projects;
create policy video_projects_select on public.video_projects
  for select to authenticated using (
    private.is_workspace_member(workspace_id) or private.is_operator()
  );

drop policy if exists video_projects_insert on public.video_projects;
create policy video_projects_insert on public.video_projects
  for insert to authenticated with check (
    private.has_workspace_role(workspace_id, array['owner', 'admin', 'operator', 'member'])
    and (created_by is null or created_by = (select auth.uid()))
  );

drop policy if exists video_projects_update on public.video_projects;
create policy video_projects_update on public.video_projects
  for update to authenticated using (
    private.has_workspace_role(workspace_id, array['owner', 'admin', 'operator', 'member'])
  ) with check (
    private.has_workspace_role(workspace_id, array['owner', 'admin', 'operator', 'member'])
  );

-- video_assets: customers read only their own customer-visible material.
-- Operator-visible production material is invisible to them even inside their
-- own workspace. There is no customer delete policy; removal is an audited,
-- reference-aware server operation.
drop policy if exists video_assets_select on public.video_assets;
create policy video_assets_select on public.video_assets
  for select to authenticated using (
    private.is_operator()
    or (private.is_workspace_member(workspace_id) and visibility = 'customer')
  );

drop policy if exists video_assets_insert on public.video_assets;
create policy video_assets_insert on public.video_assets
  for insert to authenticated with check (
    visibility = 'customer'
    and private.has_workspace_role(workspace_id, array['owner', 'admin', 'operator', 'member'])
    and upload_state in ('initiated', 'uploaded', 'validating')
  );

-- A member may only advance the validation lifecycle, never declare a file
-- ready and never touch an operator-visible row.
drop policy if exists video_assets_update on public.video_assets;
create policy video_assets_update on public.video_assets
  for update to authenticated using (
    visibility = 'customer'
    and private.has_workspace_role(workspace_id, array['owner', 'admin', 'operator', 'member'])
    and upload_state in ('initiated', 'uploaded', 'validating')
  ) with check (
    visibility = 'customer'
    and upload_state in ('uploaded', 'validating', 'rejected')
  );

-- video_brief_versions: readable by members while unfrozen; a frozen version is
-- immutable and an expired or cancelled project keeps its frozen brief.
drop policy if exists video_brief_versions_select on public.video_brief_versions;
create policy video_brief_versions_select on public.video_brief_versions
  for select to authenticated using (
    private.is_operator() or private.is_workspace_member(workspace_id)
  );

drop policy if exists video_brief_versions_insert on public.video_brief_versions;
create policy video_brief_versions_insert on public.video_brief_versions
  for insert to authenticated with check (
    frozen_at is null
    and private.has_workspace_role(workspace_id, array['owner', 'admin', 'operator', 'member'])
  );

-- video_orders: members read their own orders. All writes are service-role so a
-- customer cannot set payment state, due dates or fulfilment state.
drop policy if exists video_orders_select on public.video_orders;
create policy video_orders_select on public.video_orders
  for select to authenticated using (
    private.is_operator() or private.is_workspace_member(workspace_id)
  );

-- video_versions: drafts and finals visible to the owning workspace only once
-- the corresponding asset is customer-visible. Enforced through a join so a
-- customer cannot read an operator-only production version.
drop policy if exists video_versions_select on public.video_versions;
create policy video_versions_select on public.video_versions
  for select to authenticated using (
    private.is_operator()
    or (
      private.is_workspace_member(workspace_id)
      and exists (
        select 1 from public.video_assets a
        where a.id = video_versions.asset_id and a.visibility = 'customer'
      )
    )
  );

-- video_feedback: members read and submit feedback for their own orders.
drop policy if exists video_feedback_select on public.video_feedback;
create policy video_feedback_select on public.video_feedback
  for select to authenticated using (
    private.is_operator() or private.is_workspace_member(workspace_id)
  );

drop policy if exists video_feedback_insert on public.video_feedback;
create policy video_feedback_insert on public.video_feedback
  for insert to authenticated with check (
    private.has_workspace_role(workspace_id, array['owner', 'admin', 'operator', 'member'])
    and submitted_by = (select auth.uid())
  );

-- video_order_events: operators read the full trail; a member reads only events
-- for a project that is still theirs and customer-visible.
drop policy if exists video_order_events_select on public.video_order_events;
create policy video_order_events_select on public.video_order_events
  for select to authenticated using (
    private.is_operator()
    or (
      private.is_workspace_member(workspace_id)
      and exists (
        select 1 from public.video_projects p
        where p.id = video_order_events.project_id
          and p.customer_visible
          and p.workspace_id = video_order_events.workspace_id
      )
    )
  );

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function private.touch_video_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists video_projects_touch on public.video_projects;
create trigger video_projects_touch before update on public.video_projects
  for each row execute function private.touch_video_updated_at();

drop trigger if exists video_assets_touch on public.video_assets;
create trigger video_assets_touch before update on public.video_assets
  for each row execute function private.touch_video_updated_at();

drop trigger if exists video_orders_touch on public.video_orders;
create trigger video_orders_touch before update on public.video_orders
  for each row execute function private.touch_video_updated_at();

drop trigger if exists video_payment_attempts_touch on public.video_payment_attempts;
create trigger video_payment_attempts_touch before update on public.video_payment_attempts
  for each row execute function private.touch_video_updated_at();
