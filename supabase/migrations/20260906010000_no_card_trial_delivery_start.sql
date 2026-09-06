-- No-card trial: the 14-day app trial starts when Meta first reports actual
-- delivery, not at signup, publishing, or approval. Also adds Checkout session
-- bookkeeping for open-session reuse and the server-side managed-service
-- written-scope approval gate.

begin;

alter table public.workspaces
  add column if not exists trial_state text not null default 'pending_delivery',
  add column if not exists managed_scope_approved_at timestamptz;

-- Backfill: workspaces whose trial already started under the previous
-- verification-time rule keep an active trial; everyone else waits for the
-- first Meta-reported delivery.
update public.workspaces
set trial_state = 'active'
where trial_started_at is not null
  and trial_state = 'pending_delivery';

alter table public.workspaces
  drop constraint if exists workspaces_trial_state_check,
  add constraint workspaces_trial_state_check
    check (trial_state in ('pending_delivery', 'active'));

comment on column public.workspaces.trial_state is
  'No-card trial progression. pending_delivery until Meta first reports actual delivery; active once the 14-day app trial starts.';
comment on column public.workspaces.managed_scope_approved_at is
  'Server-recorded written-scope approval for managed-service Checkout. Set only by operators; never by the customer UI.';

-- Checkout session bookkeeping so a retried Checkout reuses the eligible open
-- Stripe session instead of creating competing subscriptions.
create table if not exists public.billing_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  stripe_checkout_session_id text not null unique,
  offer_key text not null,
  status text not null default 'open'
    check (status in ('open', 'completed', 'expired')),
  url text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_checkout_sessions_workspace_status_idx
  on public.billing_checkout_sessions (workspace_id, status, expires_at desc);

alter table public.billing_checkout_sessions enable row level security;
revoke all on public.billing_checkout_sessions from public, anon, authenticated;
grant all on public.billing_checkout_sessions to service_role;

-- Idempotent, durable trial start. Only a pending_delivery workspace
-- transitions, and the transition is atomic, so duplicate or out-of-order
-- delivery reports can never restart or extend the 14-day window.
create or replace function public.start_trial_on_first_delivery(
  p_workspace_id uuid,
  p_delivery_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trial_ends timestamptz;
  v_wallet public.workspace_credit_wallets;
begin
  if p_workspace_id is null then
    raise exception 'Workspace ID is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  -- Only self-serve trial-plan workspaces participate in the no-card trial.
  update public.workspaces w
  set trial_started_at = p_delivery_at,
      trial_ends_at = p_delivery_at + interval '14 days',
      trial_state = 'active',
      updated_at = now()
  from public.workspace_plans wp
  where w.id = p_workspace_id
    and wp.id = w.plan_id
    and wp.key = 'trial'
    and w.mode = 'self_serve'
    and w.trial_state = 'pending_delivery'
  returning w.trial_ends_at into v_trial_ends;

  if not found then
    return false;
  end if;

  -- Align the trial wallet window with the delivery-anchored trial end so
  -- credit reservations expire exactly with app access. The pre-delivery
  -- setup window may be shortened (delivery early) or extended (delivery
  -- late) to land on the 14-day trial end; advertising budget and schedule
  -- are Meta-side consented values and are never touched here.
  select * into v_wallet
  from public.workspace_credit_wallets
  where workspace_id = p_workspace_id
    and entitlement_type = 'trial'
    and status = 'active'
  for update;

  if found then
    update public.workspace_credit_wallets
    set period_end = v_trial_ends,
        metadata = metadata || jsonb_build_object('trialStart', 'first_delivery', 'trialEndsAt', v_trial_ends),
        updated_at = now()
    where id = v_wallet.id
      and period_end is distinct from v_trial_ends;
  else
    perform *
    from public.grant_workspace_credits(
      p_workspace_id,
      'trial',
      'trial:' || p_workspace_id::text,
      6,
      p_delivery_at,
      v_trial_ends,
      'trial-grant:' || p_workspace_id::text,
      'first_meta_delivery_bootstrap',
      jsonb_build_object('trialStart', 'first_delivery')
    );
  end if;

  return true;
end;
$$;

revoke all on function public.start_trial_on_first_delivery(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.start_trial_on_first_delivery(uuid, timestamptz)
  to service_role;

-- Trial workspaces no longer start a 7-day clock at email verification.
-- Verification still unlocks the three-pack trial wallet (six renders), but
-- the window end is a generous pending-delivery setup bound; the real 14-day
-- app trial starts at first delivery via start_trial_on_first_delivery.
create or replace function public.bootstrap_verified_trial_workspace(
  p_verified_user_id uuid
)
returns table (
  workspace_id uuid,
  created boolean,
  resumed boolean,
  eligible boolean,
  trial_ends_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user auth.users;
  v_verified_at timestamptz;
  v_trial_plan_id uuid;
  v_plan_key text;
  v_workspace_id uuid;
  v_trial_started_at timestamptz;
  v_trial_ends_at timestamptz;
  v_workspace_name text;
  v_signup_flow text;
begin
  if p_verified_user_id is null then
    raise exception 'Verified user ID is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_verified_user_id::text, 0));

  select u.* into v_user
  from auth.users u
  where u.id = p_verified_user_id;
  if not found then
    raise exception 'Verified auth user was not found';
  end if;

  v_verified_at := coalesce(v_user.email_confirmed_at, v_user.confirmed_at);
  if v_verified_at is null or nullif(btrim(coalesce(v_user.email, '')), '') is null then
    raise exception 'Email verification is required before workspace bootstrap';
  end if;

  insert into public.profiles (id, email)
  values (v_user.id, v_user.email)
  on conflict (id) do update
  set email = excluded.email,
      updated_at = now();

  select w.id, wp.key, w.trial_started_at, w.trial_ends_at
  into v_workspace_id, v_plan_key, v_trial_started_at, v_trial_ends_at
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  left join public.workspace_plans wp on wp.id = w.plan_id
  where wm.profile_id = p_verified_user_id
    and w.mode = 'self_serve'
  order by
    case wm.role when 'owner' then 0 else 1 end,
    w.created_at
  limit 1;

  if v_workspace_id is not null then
    insert into public.customer_activations (workspace_id)
    values (v_workspace_id)
    on conflict on constraint customer_activations_pkey do nothing;

    perform public.record_customer_activation_milestone(
      v_workspace_id,
      'email_verified',
      v_verified_at,
      null
    );

    if v_plan_key = 'trial' and not exists (
      select 1
      from public.workspace_credit_wallets cw
      where cw.workspace_id = v_workspace_id
        and cw.entitlement_type = 'trial'
    ) then
      -- Pending-delivery wallet: usable immediately, bounded setup window.
      v_trial_started_at := coalesce(v_trial_started_at, v_verified_at);
      v_trial_ends_at := coalesce(v_trial_ends_at, v_trial_started_at + interval '30 days');
      update public.workspaces
      set updated_at = now()
      where id = v_workspace_id;

      perform *
      from public.grant_workspace_credits(
        v_workspace_id,
        'trial',
        'trial:' || v_workspace_id::text,
        6,
        v_trial_started_at,
        v_trial_ends_at,
        'trial-grant:' || v_workspace_id::text,
        'verified_workspace_bootstrap',
        jsonb_build_object(
          'verifiedUserId', p_verified_user_id,
          'phase', 'pending_delivery'
        )
      );
    end if;

    select w.trial_ends_at into v_trial_ends_at
    from public.workspaces w
    where w.id = v_workspace_id;

    workspace_id := v_workspace_id;
    created := false;
    resumed := true;
    eligible := true;
    trial_ends_at := v_trial_ends_at;
    return next;
    return;
  end if;

  v_signup_flow := coalesce(v_user.raw_user_meta_data->>'signup_flow', '');
  if v_signup_flow <> 'trial_self_serve' then
    workspace_id := null;
    created := false;
    resumed := false;
    eligible := false;
    trial_ends_at := null;
    return next;
    return;
  end if;

  select wp.id into v_trial_plan_id
  from public.workspace_plans wp
  where wp.key = 'trial'
  limit 1;
  if v_trial_plan_id is null then
    raise exception 'Trial workspace plan is missing';
  end if;

  v_workspace_name := left(
    regexp_replace(
      btrim(coalesce(v_user.raw_user_meta_data->>'agency_name', '')),
      '\s+',
      ' ',
      'g'
    ),
    160
  );
  if v_workspace_name = '' then
    v_workspace_name := 'My workspace';
  end if;

  -- The trial clock does not start here. trial_state stays pending_delivery
  -- until Meta first reports actual delivery.
  insert into public.workspaces (
    name,
    mode,
    plan_id,
    region,
    trial_state,
    onboarding_status,
    created_by
  )
  values (
    v_workspace_name,
    'self_serve',
    v_trial_plan_id,
    'AU',
    'pending_delivery',
    'not_started',
    p_verified_user_id
  )
  returning id into v_workspace_id;

  insert into public.workspace_members (workspace_id, profile_id, role)
  values (v_workspace_id, p_verified_user_id, 'owner')
  on conflict on constraint workspace_members_pkey do nothing;

  insert into public.customer_activations (workspace_id)
  values (v_workspace_id)
  on conflict on constraint customer_activations_pkey do nothing;

  perform public.record_customer_activation_milestone(
    v_workspace_id,
    'email_verified',
    v_verified_at,
    null
  );

  perform *
  from public.grant_workspace_credits(
    v_workspace_id,
    'trial',
    'trial:' || v_workspace_id::text,
    6,
    v_verified_at,
    v_verified_at + interval '30 days',
    'trial-grant:' || v_workspace_id::text,
    'verified_workspace_bootstrap',
    jsonb_build_object(
      'verifiedUserId', p_verified_user_id,
      'phase', 'pending_delivery'
    )
  );

  workspace_id := v_workspace_id;
  created := true;
  resumed := false;
  eligible := true;
  trial_ends_at := null;
  return next;
end;
$$;

revoke all on function public.bootstrap_verified_trial_workspace(uuid)
  from public, anon, authenticated;
grant execute on function public.bootstrap_verified_trial_workspace(uuid)
  to service_role;

comment on function public.bootstrap_verified_trial_workspace(uuid) is
  'Idempotently creates or resumes one self-serve trial workspace after authoritative email verification. The 14-day trial starts later, on first Meta-reported delivery.';

-- Expose the trial state machine to the existing trial status reader.
create or replace function public.get_trial_status(target_workspace_id uuid)
returns table (
  plan_key text,
  trial_state text,
  trial_ends_at timestamptz,
  ad_packs_used integer,
  ad_packs_limit integer,
  ad_packs_remaining integer,
  trial_days_remaining integer,
  trial_expired boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    wp.key,
    w.trial_state,
    cw.period_end,
    (cw.credits_consumed / 2)::integer,
    (cw.credits_granted / 2)::integer,
    (
      greatest(cw.credits_granted - cw.credits_reserved - cw.credits_consumed - cw.credits_expired, 0) / 2
    )::integer,
    greatest(ceil(extract(epoch from (cw.period_end - now())) / 86400.0)::integer, 0),
    (cw.status <> 'active' or cw.period_end <= now())
  from public.workspaces w
  join public.workspace_plans wp on wp.id = w.plan_id
  left join public.workspace_credit_wallets cw
    on cw.workspace_id = w.id
   and cw.entitlement_type = 'trial'
  where w.id = target_workspace_id
    and (private.is_operator() or private.is_workspace_member(w.id))
  order by cw.period_end desc
  limit 1;
$$;

revoke all on function public.get_trial_status(uuid) from public, anon;
grant execute on function public.get_trial_status(uuid) to authenticated;

-- Trial and managed-scope columns are server-controlled. Operators set the
-- managed-scope approval through the operator API; Stripe billing events and
-- trial-start RPCs own the trial columns.
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
    or new.trial_started_at is distinct from old.trial_started_at
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.trial_state is distinct from old.trial_state
    or new.managed_scope_approved_at is distinct from old.managed_scope_approved_at
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

revoke all on function public.protect_stripe_billing_columns() from public, anon, authenticated;

commit;
