-- Provider-neutral onboarding bookings and idempotent webhook receipts.

create table public.workspace_onboarding_bookings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null default 'calcom',
  provider_booking_id text,
  provider_event_type_id text,
  market text not null,
  status text not null default 'link_sent',
  mutation_key text,
  hosted_booking_url text not null,
  reschedule_url text,
  customer_email text,
  customer_name text,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  booked_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  reminder_24h_due_at timestamptz,
  reminder_24h_sent_at timestamptz,
  reminder_pre_session_due_at timestamptz,
  reminder_pre_session_sent_at timestamptz,
  last_provider_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_onboarding_bookings_market_check check (market in ('US', 'AU')),
  constraint workspace_onboarding_bookings_provider_check check (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  constraint workspace_onboarding_bookings_status_check check (
    status in ('link_sent', 'booked', 'rescheduled', 'cancelled', 'completed', 'failed')
  ),
  constraint workspace_onboarding_bookings_schedule_check check (
    scheduled_end_at is null
    or scheduled_start_at is null
    or scheduled_end_at > scheduled_start_at
  )
);

create unique index workspace_onboarding_bookings_provider_id_key
  on public.workspace_onboarding_bookings (provider, provider_booking_id)
  where provider_booking_id is not null;

create unique index workspace_onboarding_bookings_mutation_key
  on public.workspace_onboarding_bookings (workspace_id, mutation_key)
  where mutation_key is not null;

create index workspace_onboarding_bookings_workspace_created_idx
  on public.workspace_onboarding_bookings (workspace_id, created_at desc);

create index workspace_onboarding_bookings_reminder_24h_idx
  on public.workspace_onboarding_bookings (reminder_24h_due_at)
  where status in ('booked', 'rescheduled') and reminder_24h_sent_at is null;

create index workspace_onboarding_bookings_reminder_pre_session_idx
  on public.workspace_onboarding_bookings (reminder_pre_session_due_at)
  where status in ('booked', 'rescheduled') and reminder_pre_session_sent_at is null;

create table public.booking_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'processing',
  attempt_count integer not null default 1,
  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint booking_webhook_events_status_check check (status in ('processing', 'processed', 'failed')),
  constraint booking_webhook_events_attempt_count_check check (attempt_count > 0),
  unique (provider, provider_event_id)
);

alter table public.workspace_onboarding_bookings enable row level security;
alter table public.booking_webhook_events enable row level security;

create policy workspace_onboarding_bookings_workspace_select
  on public.workspace_onboarding_bookings for select to authenticated
  using (private.is_operator() or private.is_workspace_member(workspace_id));

revoke all on public.workspace_onboarding_bookings from public, anon, authenticated;
revoke all on public.booking_webhook_events from public, anon, authenticated;
grant select on public.workspace_onboarding_bookings to authenticated;
grant all on public.workspace_onboarding_bookings to service_role;
grant all on public.booking_webhook_events to service_role;

create or replace function public.claim_booking_webhook_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_lease_token uuid
)
returns table (claimed boolean, attempt_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt integer;
begin
  if nullif(btrim(p_provider), '') is null
    or nullif(btrim(p_event_id), '') is null
    or nullif(btrim(p_event_type), '') is null
  then
    raise exception 'Booking webhook identity is required';
  end if;

  insert into public.booking_webhook_events as receipt (
    provider, provider_event_id, event_type, payload, status,
    attempt_count, lease_token, lease_expires_at
  )
  values (
    p_provider, p_event_id, p_event_type, p_payload, 'processing',
    1, p_lease_token, now() + interval '5 minutes'
  )
  on conflict (provider, provider_event_id) do update
  set
    event_type = excluded.event_type,
    payload = excluded.payload,
    status = 'processing',
    attempt_count = receipt.attempt_count + 1,
    lease_token = excluded.lease_token,
    lease_expires_at = excluded.lease_expires_at,
    error_message = null,
    processed_at = null
  where receipt.status = 'failed'
     or (receipt.status = 'processing' and receipt.lease_expires_at <= now())
  returning receipt.attempt_count into v_attempt;

  if found then
    return query select true, v_attempt;
    return;
  end if;

  select receipt.attempt_count into v_attempt
  from public.booking_webhook_events receipt
  where receipt.provider = p_provider
    and receipt.provider_event_id = p_event_id;
  return query select false, coalesce(v_attempt, 0);
end;
$$;

create or replace function public.finish_booking_webhook_event(
  p_provider text,
  p_event_id text,
  p_lease_token uuid,
  p_status text,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_status not in ('processed', 'failed') then
    raise exception 'Booking webhook terminal status is invalid';
  end if;
  update public.booking_webhook_events
  set
    status = p_status,
    error_message = p_error_message,
    processed_at = now(),
    lease_token = p_lease_token,
    lease_expires_at = now()
  where provider = p_provider
    and provider_event_id = p_event_id
    and status = 'processing'
    and lease_token = p_lease_token;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.claim_booking_webhook_event(text, text, text, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.finish_booking_webhook_event(text, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_booking_webhook_event(text, text, text, jsonb, uuid)
  to service_role;
grant execute on function public.finish_booking_webhook_event(text, text, uuid, text, text)
  to service_role;

create or replace function public.set_workspace_onboarding_booking_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger workspace_onboarding_bookings_set_updated_at
  before update on public.workspace_onboarding_bookings
  for each row execute function public.set_workspace_onboarding_booking_updated_at();

revoke all on function public.set_workspace_onboarding_booking_updated_at()
  from public, anon, authenticated;
grant execute on function public.set_workspace_onboarding_booking_updated_at()
  to service_role;
