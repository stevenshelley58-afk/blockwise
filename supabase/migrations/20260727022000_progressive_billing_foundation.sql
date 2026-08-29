begin;

alter table public.workspaces
  add column if not exists country_code text not null default 'AU',
  add column if not exists billing_currency text not null default 'AUD',
  add column if not exists billing_offer_key text,
  add column if not exists billing_offer_version text,
  add column if not exists billing_access_state text not null default 'unbilled',
  add column if not exists billing_checkout_completed_at timestamptz,
  add column if not exists stripe_current_period_start timestamptz,
  add column if not exists stripe_current_period_end timestamptz,
  add column if not exists stripe_cancel_at_period_end boolean not null default false,
  add column if not exists stripe_latest_invoice_id text,
  add column if not exists stripe_latest_charge_id text,
  add column if not exists stripe_latest_invoice_status text,
  add column if not exists stripe_latest_invoice_amount_paid integer,
  add column if not exists stripe_intro_invoice_paid_at timestamptz,
  add column if not exists stripe_last_renewal_paid_at timestamptz,
  add column if not exists billing_payment_recovery_required boolean not null default false,
  add column if not exists billing_reconciliation_required boolean not null default false;

update public.workspaces
set
  country_code = case when upper(coalesce(country_code, 'AU')) = 'US' then 'US' else 'AU' end,
  billing_currency = case when upper(coalesce(country_code, 'AU')) = 'US' then 'USD' else 'AUD' end
where
  country_code is null
  or country_code <> upper(country_code)
  or upper(country_code) not in ('US', 'AU')
  or billing_currency is null
  or billing_currency <> upper(billing_currency)
  or (upper(country_code), upper(billing_currency)) not in (('US', 'USD'), ('AU', 'AUD'));

alter table public.workspaces
  drop constraint if exists workspaces_country_code_check,
  add constraint workspaces_country_code_check check (country_code in ('US', 'AU')),
  drop constraint if exists workspaces_billing_currency_check,
  add constraint workspaces_billing_currency_check check (
    (country_code = 'US' and billing_currency = 'USD')
    or (country_code = 'AU' and billing_currency = 'AUD')
  ),
  drop constraint if exists workspaces_billing_access_state_check,
  add constraint workspaces_billing_access_state_check check (
    billing_access_state in ('unbilled', 'trialing', 'paid', 'payment_recovery', 'canceled', 'refunded', 'disputed')
  );

comment on column public.workspaces.country_code is
  'Confirmed billing market. Existing workspaces default/backfill to AU based on the product''s existing AU market evidence.';
comment on column public.workspaces.billing_currency is
  'Stripe-bound workspace currency. Must match country_code and becomes server-controlled after Checkout.';
comment on column public.workspaces.billing_access_state is
  'Server-maintained billing entitlement state derived from authoritative Stripe events or retrieval.';

create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  object_id text,
  payload jsonb not null,
  processing_status text not null default 'processing'
    check (processing_status in ('processing', 'applied', 'ignored', 'failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_offer_acceptances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stripe_checkout_session_id text not null unique,
  stripe_customer_id text,
  stripe_subscription_id text,
  offer_key text not null,
  offer_version text not null,
  accepted_at timestamptz not null,
  market text not null check (market in ('US', 'AU')),
  currency text not null check (currency in ('USD', 'AUD')),
  first_invoice_amount integer not null check (first_invoice_amount >= 0),
  renewal_amount integer not null check (renewal_amount >= 0),
  triggering_rule text not null,
  created_at timestamptz not null default now(),
  check (
    (market = 'US' and currency = 'USD')
    or (market = 'AU' and currency = 'AUD')
  )
);

create index if not exists billing_offer_acceptances_workspace_idx
  on public.billing_offer_acceptances (workspace_id, accepted_at desc);

alter table public.stripe_webhook_events enable row level security;
alter table public.billing_offer_acceptances enable row level security;
revoke all on public.stripe_webhook_events from public, anon, authenticated;
revoke all on public.billing_offer_acceptances from public, anon, authenticated;
grant all on public.stripe_webhook_events to service_role;
grant all on public.billing_offer_acceptances to service_role;

create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_object_id text,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  insert into public.stripe_webhook_events (
    stripe_event_id,
    event_type,
    object_id,
    payload
  )
  values (p_event_id, p_event_type, p_object_id, p_payload)
  on conflict (stripe_event_id) do nothing;

  get diagnostics affected = row_count;
  if affected = 1 then
    return true;
  end if;

  update public.stripe_webhook_events
  set
    processing_status = 'processing',
    attempt_count = attempt_count + 1,
    last_error = null,
    processed_at = null,
    updated_at = now()
  where stripe_event_id = p_event_id
    and processing_status = 'failed';

  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.finish_stripe_webhook_event(
  p_event_id text,
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
    updated_at = now()
  where stripe_event_id = p_event_id;
end;
$$;

revoke all on function public.claim_stripe_webhook_event(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.finish_stripe_webhook_event(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook_event(text, text, text, jsonb) to service_role;
grant execute on function public.finish_stripe_webhook_event(text, text, text) to service_role;

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

drop trigger if exists protect_stripe_billing_columns on public.workspaces;
create trigger protect_stripe_billing_columns
before update on public.workspaces
for each row execute function public.protect_stripe_billing_columns();

revoke all on function public.protect_stripe_billing_columns() from public, anon, authenticated;

commit;
