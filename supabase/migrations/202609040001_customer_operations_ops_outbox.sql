-- Customer operations read contract and provider-neutral projection outbox.
--
-- Source tables remain authoritative. This migration adds only an internal
-- read contract, communication consent state, and an outbox consumed by
-- Hermes. Provider calls must never be made from a customer request path.
--
-- Rollback (only after confirming the outbox and preference tables are empty
-- or archived): revoke the grants, drop the RPCs, then drop the views and
-- tables in reverse dependency order. Do not drop these tables while queued
-- work exists; archive it first for reconciliation.

begin;

create table if not exists public.customer_communication_preferences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  email text not null,
  marketing_consent text not null default 'unknown'
    check (marketing_consent in ('unknown', 'granted', 'denied', 'withdrawn')),
  topics text[] not null default '{}',
  unsubscribed_at timestamptz,
  suppressed boolean not null default false,
  suppression_reason text,
  consent_source text,
  consent_recorded_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (char_length(btrim(email)) between 3 and 320 and position('@' in email) > 1),
  unique (workspace_id, email)
);

create index if not exists customer_communication_preferences_email_idx
  on public.customer_communication_preferences (lower(email), workspace_id);

alter table public.customer_communication_preferences enable row level security;
revoke all on public.customer_communication_preferences from public, anon, authenticated;
grant all on public.customer_communication_preferences to service_role;

comment on table public.customer_communication_preferences is
  'Authoritative workspace-scoped marketing consent, topic consent, unsubscribe, and suppression state. Service-role writers only.';

create table if not exists public.ops_projection_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('mautic', 'chatwoot')),
  aggregate_type text not null check (aggregate_type in ('contact', 'lifecycle', 'enquiry', 'support')),
  aggregate_id text not null,
  operation text not null check (operation in ('upsert')),
  source_event_id text not null,
  source_version bigint not null default 1 check (source_version > 0),
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 25),
  run_after timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)),
  check (coalesce(payload ->> 'workspaceId', '') = workspace_id::text)
);

create index if not exists ops_projection_outbox_claim_idx
  on public.ops_projection_outbox (run_after, created_at)
  where status = 'pending';
create index if not exists ops_projection_outbox_workspace_status_idx
  on public.ops_projection_outbox (workspace_id, status, updated_at desc);
create index if not exists ops_projection_outbox_aggregate_version_idx
  on public.ops_projection_outbox
    (workspace_id, provider, aggregate_type, aggregate_id, operation, source_version desc);

alter table public.ops_projection_outbox enable row level security;
revoke all on public.ops_projection_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.ops_projection_outbox to service_role;

-- Narrow SQL contract for non-Next service consumers. The API performs richer
-- child reads; this view does not expose provider connections or raw JSON.
create or replace view public.ops_customer_summary as
select
  w.id as workspace_id, w.name as workspace_name, w.mode, w.region,
  w.country_code, w.managed_service_enabled, w.billing_access_state,
  w.stripe_subscription_status, w.stripe_latest_invoice_status,
  w.created_at, w.updated_at,
  owner_profile.id as owner_profile_id, owner_profile.email as owner_email,
  owner_profile.full_name as owner_name,
  activation.email_verified_at, activation.website_submitted_at,
  activation.brand_pack_approved_at, activation.first_ad_pack_generated_at,
  activation.meta_connected_at, activation.checkout_completed_at,
  activation.onboarding_completed_at,
  booking.status as booking_status,
  booking.scheduled_start_at as booking_scheduled_start_at
from public.workspaces w
left join lateral (
  select p.id, p.email, p.full_name
  from public.workspace_members wm
  join public.profiles p on p.id = wm.profile_id
  where wm.workspace_id = w.id and wm.role = 'owner'
  order by wm.created_at asc limit 1
) owner_profile on true
left join public.customer_activations activation on activation.workspace_id = w.id
left join lateral (
  select b.status, b.scheduled_start_at
  from public.workspace_onboarding_bookings b
  where b.workspace_id = w.id
  order by b.updated_at desc, b.created_at desc limit 1
) booking on true;
revoke all on public.ops_customer_summary from public, anon, authenticated;
grant select on public.ops_customer_summary to service_role;

create or replace function public.enqueue_ops_projection(
  p_workspace_id uuid,
  p_provider text,
  p_aggregate_type text,
  p_aggregate_id text,
  p_operation text,
  p_source_event_id text,
  p_source_version bigint,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_id uuid;
  v_key text;
begin
  if p_workspace_id is null or p_provider not in ('mautic', 'chatwoot')
    or p_aggregate_type not in ('contact', 'lifecycle', 'enquiry', 'support')
    or p_operation <> 'upsert'
    or nullif(btrim(p_aggregate_id), '') is null
    or nullif(btrim(p_source_event_id), '') is null
    or p_source_version is null or p_source_version < 1
  then
    raise exception 'invalid operations projection identity' using errcode = '22023';
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'operations projection payload must be a JSON object' using errcode = '22023';
  end if;
  if v_payload ?| array['accessToken', 'refreshToken', 'token', 'secret', 'password', 'encrypted_access_token', 'encrypted_refresh_token', 'raw_payload'] then
    raise exception 'operations projection payload contains a forbidden field' using errcode = '22023';
  end if;
  if nullif(v_payload ->> 'workspaceId', '') is not null
    and v_payload ->> 'workspaceId' <> p_workspace_id::text
  then
    raise exception 'operations projection workspace mismatch' using errcode = '22023';
  end if;
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id) then
    raise exception 'operations projection workspace does not exist' using errcode = '23503';
  end if;

  -- Serialize versions for one aggregate. A late event can never create work
  -- older than a version already accepted by the outbox.
  perform pg_advisory_xact_lock(hashtextextended(
    p_workspace_id::text || ':' || p_provider || ':' || p_aggregate_type || ':'
      || p_aggregate_id || ':' || p_operation, 0));
  select id into v_id
  from public.ops_projection_outbox
  where workspace_id = p_workspace_id
    and provider = p_provider
    and aggregate_type = p_aggregate_type
    and aggregate_id = p_aggregate_id
    and operation = p_operation
    and source_version >= p_source_version
  order by source_version desc, created_at desc
  limit 1;
  if found then return v_id; end if;

  v_payload := v_payload || jsonb_build_object('workspaceId', p_workspace_id::text);
  v_key := p_provider || ':' || p_workspace_id::text || ':' || p_aggregate_type || ':'
    || p_aggregate_id || ':' || p_operation || ':' || p_source_event_id;
  -- If a newer source version arrives before an older item is claimed, close
  -- the stale pending item. Processing is therefore monotonic even when
  -- delivery to this function is duplicated or out of order.
  update public.ops_projection_outbox
  set status = 'completed', completed_at = now(), last_error = 'superseded_by_newer_source_version',
      updated_at = now(), lease_token = null, lease_expires_at = null
  where workspace_id = p_workspace_id
    and provider = p_provider
    and aggregate_type = p_aggregate_type
    and aggregate_id = p_aggregate_id
    and operation = p_operation
    and source_version < p_source_version
    and status = 'pending';
  insert into public.ops_projection_outbox (
    workspace_id, provider, aggregate_type, aggregate_id, operation,
    source_event_id, source_version, idempotency_key, payload
  ) values (
    p_workspace_id, p_provider, p_aggregate_type, p_aggregate_id, p_operation,
    p_source_event_id, p_source_version, v_key, v_payload
  ) on conflict (idempotency_key) do update set updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.claim_ops_projection(
  p_provider text default null,
  p_lease_seconds integer default 600
)
returns table (
  id uuid, workspace_id uuid, provider text, aggregate_type text,
  aggregate_id text, operation text, source_event_id text, source_version bigint,
  payload jsonb, attempts integer, max_attempts integer, lease_token uuid
)
language sql
security definer
set search_path = ''
as $$
  update public.ops_projection_outbox as o
  set status = 'processing',
      attempts = o.attempts + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 600), 3600))),
      updated_at = now()
  where o.id = (
    select candidate.id
    from public.ops_projection_outbox candidate
    where candidate.status = 'pending'
      and candidate.run_after <= now()
      and candidate.attempts < candidate.max_attempts
      and (p_provider is null or candidate.provider = p_provider)
    order by candidate.run_after, candidate.created_at
    for update skip locked limit 1
  )
  returning o.id, o.workspace_id, o.provider, o.aggregate_type, o.aggregate_id,
    o.operation, o.source_event_id, o.source_version, o.payload,
    o.attempts, o.max_attempts, o.lease_token;
$$;

create or replace function public.complete_ops_projection(
  p_workspace_id uuid, p_id uuid, p_lease_token uuid
)
returns boolean language sql security definer set search_path = '' as $$
  with settled as (
    update public.ops_projection_outbox
    set status = 'completed', completed_at = now(), updated_at = now(),
        lease_token = null, lease_expires_at = null, last_error = null
    where id = p_id and workspace_id = p_workspace_id
      and status = 'processing' and lease_token = p_lease_token
      and lease_expires_at > now()
    returning 1
  ) select exists(select 1 from settled);
$$;

create or replace function public.heartbeat_ops_projection(
  p_workspace_id uuid, p_id uuid, p_lease_token uuid, p_lease_seconds integer default 600
)
returns boolean language sql security definer set search_path = '' as $$
  with touched as (
    update public.ops_projection_outbox
    set lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 600), 3600))),
        updated_at = now()
    where id = p_id and workspace_id = p_workspace_id and status = 'processing'
      and lease_token = p_lease_token and lease_expires_at > now()
    returning 1
  ) select exists(select 1 from touched);
$$;

create or replace function public.fail_ops_projection(
  p_workspace_id uuid, p_id uuid, p_lease_token uuid, p_error text
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_row public.ops_projection_outbox%rowtype;
begin
  select * into v_row from public.ops_projection_outbox
  where id = p_id and workspace_id = p_workspace_id
    and status = 'processing' and lease_token = p_lease_token
    and lease_expires_at > now() for update;
  if not found then return null; end if;
  if v_row.attempts >= v_row.max_attempts then
    update public.ops_projection_outbox set status = 'failed', last_error = left(p_error, 2000),
      lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id;
    return 'failed';
  end if;
  update public.ops_projection_outbox set status = 'pending', last_error = left(p_error, 2000),
    run_after = now() + least(power(2, v_row.attempts) * interval '1 second', interval '10 minutes'),
    lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id;
  return 'pending';
end;
$$;

create or replace function public.reap_ops_projections(p_lease_seconds integer default 600)
returns integer language sql security definer set search_path = '' as $$
  with stale as (
    update public.ops_projection_outbox
    set status = case when attempts >= max_attempts then 'failed' else 'pending' end,
        last_error = coalesce(last_error, 'projection lease expired'),
        run_after = case when attempts >= max_attempts then run_after else now() + interval '5 seconds' end,
        lease_token = null, lease_expires_at = null, updated_at = now()
    where status = 'processing'
      and lease_expires_at <= now() - make_interval(secs => greatest(0, least(coalesce(p_lease_seconds, 600), 3600)))
    returning 1
  ) select count(*)::integer from stale;
$$;

create or replace function public.can_send_marketing(
  p_workspace_id uuid, p_email text, p_topic text
)
returns table (allowed boolean, reason text)
language sql security definer set search_path = ''
as $$
  select case
    when p_workspace_id is null or nullif(lower(btrim(p_email)), '') is null then false
    when pref.id is null then false
    when pref.suppressed then false
    when pref.unsubscribed_at is not null then false
    when pref.marketing_consent <> 'granted' then false
    when nullif(btrim(p_topic), '') is null then false
    when not (p_topic = any(pref.topics)) then false
    else true
  end,
  case
    when pref.id is null then 'no_consent_record'
    when pref.suppressed then 'suppressed'
    when pref.unsubscribed_at is not null then 'unsubscribed'
    when pref.marketing_consent <> 'granted' then 'consent_not_granted'
    when nullif(btrim(p_topic), '') is null or not (p_topic = any(pref.topics)) then 'topic_not_consented'
    else 'allowed'
  end
  from (select 1) required
  left join public.customer_communication_preferences pref
    on pref.workspace_id = p_workspace_id and lower(pref.email) = lower(btrim(p_email));
$$;

revoke all on function public.enqueue_ops_projection(uuid, text, text, text, text, text, bigint, jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_ops_projection(text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_ops_projection(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.heartbeat_ops_projection(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.fail_ops_projection(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.reap_ops_projections(integer)
  from public, anon, authenticated;
revoke all on function public.can_send_marketing(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_ops_projection(uuid, text, text, text, text, text, bigint, jsonb) to service_role;
grant execute on function public.claim_ops_projection(text, integer) to service_role;
grant execute on function public.complete_ops_projection(uuid, uuid, uuid) to service_role;
grant execute on function public.heartbeat_ops_projection(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.fail_ops_projection(uuid, uuid, uuid, text) to service_role;
grant execute on function public.reap_ops_projections(integer) to service_role;
grant execute on function public.can_send_marketing(uuid, text, text) to service_role;

commit;
