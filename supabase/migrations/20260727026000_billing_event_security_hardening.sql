begin;

alter table public.workspaces
  add column if not exists billing_risk_state text,
  add column if not exists billing_event_created bigint not null default 0,
  add column if not exists billing_event_id text;

update public.workspaces
set billing_risk_state = billing_access_state
where billing_access_state in ('refunded', 'disputed')
  and billing_risk_state is null;

alter table public.workspaces
  drop constraint if exists workspaces_billing_risk_state_check,
  add constraint workspaces_billing_risk_state_check
    check (billing_risk_state is null or billing_risk_state in ('refunded', 'disputed')),
  drop constraint if exists workspaces_billing_event_created_check,
  add constraint workspaces_billing_event_created_check check (billing_event_created >= 0);

comment on column public.workspaces.billing_risk_state is
  'Latched refund/dispute state. Subscription snapshots cannot clear it; a positive authoritative paid invoice may.';
comment on column public.workspaces.billing_event_created is
  'Stripe event created timestamp high-water mark used to reject stale billing state writes.';
comment on column public.workspaces.billing_event_id is
  'Stripe event ID which last advanced or matched the billing high-water mark.';

alter table public.stripe_webhook_events
  add column if not exists processing_attempt_id uuid,
  add column if not exists processing_lease_expires_at timestamptz;

update public.stripe_webhook_events
set
  processing_attempt_id = coalesce(processing_attempt_id, gen_random_uuid()),
  processing_lease_expires_at = coalesce(processing_lease_expires_at, updated_at + interval '5 minutes')
where processing_status = 'processing';

drop function if exists public.claim_stripe_webhook_event(text, text, text, jsonb);
drop function if exists public.finish_stripe_webhook_event(text, text, text);

create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_object_id text,
  p_payload jsonb,
  p_attempt_id uuid,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_attempt_id is null then
    raise exception 'Stripe event attempt ID is required';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'Stripe event lease must be between 30 and 900 seconds';
  end if;

  insert into public.stripe_webhook_events (
    stripe_event_id,
    event_type,
    object_id,
    payload,
    processing_attempt_id,
    processing_lease_expires_at
  )
  values (
    p_event_id,
    p_event_type,
    p_object_id,
    p_payload,
    p_attempt_id,
    now() + make_interval(secs => p_lease_seconds)
  )
  on conflict (stripe_event_id) do update
  set
    event_type = excluded.event_type,
    object_id = excluded.object_id,
    payload = excluded.payload,
    processing_status = 'processing',
    processing_attempt_id = excluded.processing_attempt_id,
    processing_lease_expires_at = excluded.processing_lease_expires_at,
    attempt_count = public.stripe_webhook_events.attempt_count + 1,
    last_error = null,
    processed_at = null,
    updated_at = now()
  where public.stripe_webhook_events.processing_status = 'failed'
    or (
      public.stripe_webhook_events.processing_status = 'processing'
      and public.stripe_webhook_events.processing_lease_expires_at <= now()
    );

  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.finish_stripe_webhook_event(
  p_event_id text,
  p_attempt_id uuid,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('applied', 'ignored', 'failed') then
    raise exception 'invalid Stripe event completion status';
  end if;

  update public.stripe_webhook_events
  set
    processing_status = p_status,
    last_error = nullif(p_error, ''),
    processed_at = case when p_status in ('applied', 'ignored') then now() else null end,
    processing_lease_expires_at = null,
    updated_at = now()
  where stripe_event_id = p_event_id
    and processing_status = 'processing'
    and processing_attempt_id = p_attempt_id;
end;
$$;

revoke all on function public.claim_stripe_webhook_event(text, text, text, jsonb, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.finish_stripe_webhook_event(text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook_event(text, text, text, jsonb, uuid, integer)
  to service_role;
grant execute on function public.finish_stripe_webhook_event(text, uuid, text, text)
  to service_role;

create or replace function public.grant_stripe_invoice_period_credits(
  p_workspace_id uuid,
  p_subscription_id text,
  p_invoice_id text,
  p_credits integer,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_billing_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_key text;
  v_mutation_key text;
  v_workspace_period_start timestamptz;
  v_wallet_period_start timestamptz;
  v_wallet_period_key text;
begin
  if nullif(btrim(p_subscription_id), '') is null or nullif(btrim(p_invoice_id), '') is null then
    raise exception 'Stripe subscription and invoice IDs are required';
  end if;

  v_period_key := 'stripe-subscription:' || p_subscription_id || ':' || extract(epoch from p_period_start)::bigint;
  v_mutation_key := 'stripe-invoice:' || p_invoice_id || ':paid-credit-grant';

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  if exists (
    select 1
    from public.workspace_credit_ledger
    where workspace_id = p_workspace_id
      and mutation_key = v_mutation_key
  ) then
    return false;
  end if;

  select stripe_current_period_start
  into v_workspace_period_start
  from public.workspaces
  where id = p_workspace_id;

  select period_start, period_key
  into v_wallet_period_start, v_wallet_period_key
  from public.workspace_credit_wallets
  where workspace_id = p_workspace_id
    and status = 'active'
  for update;

  if v_workspace_period_start > p_period_start
    or v_wallet_period_start > p_period_start
    or (v_wallet_period_start = p_period_start and v_wallet_period_key <> v_period_key)
  then
    return false;
  end if;

  perform public.grant_workspace_credits(
    p_workspace_id,
    'paid',
    v_period_key,
    p_credits,
    p_period_start,
    p_period_end,
    v_mutation_key,
    p_invoice_id,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('billingReason', p_billing_reason)
  );

  return true;
end;
$$;

revoke all on function public.grant_stripe_invoice_period_credits(
  uuid, text, text, integer, timestamptz, timestamptz, text, jsonb
) from public, anon, authenticated;
grant execute on function public.grant_stripe_invoice_period_credits(
  uuid, text, text, integer, timestamptz, timestamptz, text, jsonb
) to service_role;

create or replace function public.enforce_billing_risk_precedence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.billing_risk_state is not null
    and new.billing_risk_state is not distinct from old.billing_risk_state
    and new.billing_access_state not in ('refunded', 'disputed')
  then
    new.billing_access_state := old.billing_access_state;
    new.billing_payment_recovery_required := true;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_billing_risk_precedence on public.workspaces;
create trigger enforce_billing_risk_precedence
before update on public.workspaces
for each row execute function public.enforce_billing_risk_precedence();

create or replace function public.protect_stripe_billing_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' and (
    new.country_code is distinct from old.country_code
    or new.billing_currency is distinct from old.billing_currency
    or new.billing_offer_key is distinct from old.billing_offer_key
    or new.billing_offer_version is distinct from old.billing_offer_version
    or new.billing_access_state is distinct from old.billing_access_state
    or new.billing_risk_state is distinct from old.billing_risk_state
    or new.billing_event_created is distinct from old.billing_event_created
    or new.billing_event_id is distinct from old.billing_event_id
    or new.billing_checkout_completed_at is distinct from old.billing_checkout_completed_at
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
    or new.stripe_subscription_status is distinct from old.stripe_subscription_status
    or new.stripe_current_period_start is distinct from old.stripe_current_period_start
    or new.stripe_current_period_end is distinct from old.stripe_current_period_end
    or new.stripe_cancel_at_period_end is distinct from old.stripe_cancel_at_period_end
    or new.stripe_latest_invoice_id is distinct from old.stripe_latest_invoice_id
    or new.stripe_latest_charge_id is distinct from old.stripe_latest_charge_id
    or new.stripe_latest_invoice_status is distinct from old.stripe_latest_invoice_status
    or new.stripe_latest_invoice_amount_paid is distinct from old.stripe_latest_invoice_amount_paid
    or new.stripe_intro_invoice_paid_at is distinct from old.stripe_intro_invoice_paid_at
    or new.stripe_last_renewal_paid_at is distinct from old.stripe_last_renewal_paid_at
    or new.billing_payment_recovery_required is distinct from old.billing_payment_recovery_required
    or new.billing_reconciliation_required is distinct from old.billing_reconciliation_required
  ) then
    raise exception 'Stripe billing fields are server-controlled';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_billing_risk_precedence() from public, anon, authenticated;
revoke all on function public.protect_stripe_billing_columns() from public, anon, authenticated;

commit;
