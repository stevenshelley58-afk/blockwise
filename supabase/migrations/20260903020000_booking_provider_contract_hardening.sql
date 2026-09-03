-- Booking provider contract hardening. Additive and safe to apply after the
-- onboarding booking foundation migration in production.

alter table public.workspace_onboarding_bookings
  add column if not exists last_provider_occurred_at timestamptz;

update public.workspace_onboarding_bookings
set last_provider_occurred_at = greatest(
  coalesce(booked_at, '-infinity'::timestamptz),
  coalesce(cancelled_at, '-infinity'::timestamptz),
  coalesce(completed_at, '-infinity'::timestamptz)
)
where last_provider_occurred_at is null
  and (booked_at is not null or cancelled_at is not null or completed_at is not null);

create index if not exists workspace_onboarding_bookings_provider_occurred_idx
  on public.workspace_onboarding_bookings (provider, provider_booking_id, last_provider_occurred_at desc)
  where provider_booking_id is not null;

create or replace function public.apply_booking_provider_event(
  p_invitation_id uuid,
  p_workspace_id uuid,
  p_provider text,
  p_provider_booking_id text,
  p_provider_event_id text,
  p_provider_event_type_id text,
  p_state text,
  p_occurred_at timestamptz,
  p_reschedule_url text,
  p_customer_email text,
  p_customer_name text,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz
)
returns table (result_status text, booking_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.workspace_onboarding_bookings%rowtype;
  v_reminder_24h timestamptz;
  v_reminder_pre_session timestamptz;
begin
  if p_invitation_id is null or p_workspace_id is null
    or nullif(btrim(p_provider), '') is null
    or nullif(btrim(p_provider_booking_id), '') is null
    or nullif(btrim(p_provider_event_id), '') is null
    or p_state not in ('booked', 'rescheduled', 'cancelled', 'completed')
    or p_occurred_at is null
  then
    raise exception 'Booking provider event is invalid';
  end if;
  if p_scheduled_start_at is not null and p_scheduled_end_at is not null
    and p_scheduled_end_at <= p_scheduled_start_at
  then
    raise exception 'Booking provider event schedule is invalid';
  end if;

  -- The row lock makes two distinct provider event IDs for the same booking
  -- converge on one timestamp comparison, even when delivered concurrently.
  select * into v_booking
  from public.workspace_onboarding_bookings
  where provider = p_provider and provider_booking_id = p_provider_booking_id
  for update;

  if found then
    if v_booking.workspace_id <> p_workspace_id then
      raise exception 'Booking provider ID is already bound to another workspace';
    end if;
  else
    select * into v_booking
    from public.workspace_onboarding_bookings
    where id = p_invitation_id
    for update;
    if not found or v_booking.workspace_id <> p_workspace_id
      or v_booking.provider <> p_provider
      or (v_booking.provider_booking_id is not null and v_booking.provider_booking_id <> p_provider_booking_id)
    then
      raise exception 'Booking invitation binding is invalid';
    end if;
  end if;

  if p_occurred_at <= coalesce(
    v_booking.last_provider_occurred_at,
    greatest(
      coalesce(v_booking.booked_at, '-infinity'::timestamptz),
      coalesce(v_booking.cancelled_at, '-infinity'::timestamptz),
      coalesce(v_booking.completed_at, '-infinity'::timestamptz)
    )
  )
  then
    return query select 'stale'::text, v_booking.id;
    return;
  end if;

  v_reminder_24h := p_occurred_at + interval '24 hours';
  v_reminder_pre_session := case when p_scheduled_start_at is null then null
    else p_scheduled_start_at - interval '24 hours' end;

  update public.workspace_onboarding_bookings
  set provider = p_provider,
      provider_booking_id = p_provider_booking_id,
      provider_event_type_id = p_provider_event_type_id,
      status = p_state,
      reschedule_url = p_reschedule_url,
      customer_email = p_customer_email,
      customer_name = p_customer_name,
      scheduled_start_at = p_scheduled_start_at,
      scheduled_end_at = p_scheduled_end_at,
      booked_at = case when p_state in ('booked', 'rescheduled') then p_occurred_at else booked_at end,
      cancelled_at = case when p_state = 'cancelled' then p_occurred_at else null end,
      completed_at = case when p_state = 'completed' then p_occurred_at else null end,
      reminder_24h_due_at = case when p_state in ('booked', 'rescheduled') then v_reminder_24h else null end,
      reminder_pre_session_due_at = case when p_state in ('booked', 'rescheduled') then v_reminder_pre_session else null end,
      last_provider_event_id = p_provider_event_id,
      last_provider_occurred_at = p_occurred_at
  where id = v_booking.id;

  return query select 'applied'::text, v_booking.id;
end;
$$;

revoke all on function public.apply_booking_provider_event(
  uuid, uuid, text, text, text, text, text, timestamptz, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_booking_provider_event(
  uuid, uuid, text, text, text, text, text, timestamptz, text, text, text, timestamptz, timestamptz
) to service_role;
