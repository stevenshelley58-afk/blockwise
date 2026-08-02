-- Progressive activation + one durable render-credit authority.
-- Trial and paid generation both use these wallets and append-only mutations.

create table public.customer_activations (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  email_verified_at timestamptz,
  country_confirmed_at timestamptz,
  website_submitted_at timestamptz,
  brand_pack_approved_at timestamptz,
  first_template_selected_at timestamptz,
  first_ad_pack_generated_at timestamptz,
  meta_help_selected_at timestamptz,
  meta_help_path text,
  meta_connected_at timestamptz,
  checkout_completed_at timestamptz,
  free_live_claim_reserved_at timestamptz,
  free_live_claim_consumed_at timestamptz,
  first_campaign_live_at timestamptz,
  intro_invoice_paid_at timestamptz,
  onboarding_booked_at timestamptz,
  onboarding_completed_at timestamptz,
  activation_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_activations_meta_help_path_check
    check (meta_help_path is null or meta_help_path in ('connect', 'setup_guide', 'book_onboarding', 'pre_purchase_call'))
);

create table public.workspace_credit_wallets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entitlement_type text not null
    check (entitlement_type in ('trial', 'paid', 'operator')),
  period_key text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'expired', 'revoked')),
  credits_granted integer not null default 0 check (credits_granted >= 0),
  credits_reserved integer not null default 0 check (credits_reserved >= 0),
  credits_consumed integer not null default 0 check (credits_consumed >= 0),
  credits_expired integer not null default 0 check (credits_expired >= 0),
  source_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_credit_wallets_period_check check (period_end > period_start),
  constraint workspace_credit_wallets_balance_check
    check (credits_reserved + credits_consumed + credits_expired <= credits_granted),
  unique (workspace_id, period_key)
);

create unique index workspace_credit_wallets_one_active_idx
  on public.workspace_credit_wallets (workspace_id)
  where status = 'active';

create index workspace_credit_wallets_workspace_period_idx
  on public.workspace_credit_wallets (workspace_id, period_end desc);

create table public.workspace_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  wallet_id uuid references public.workspace_credit_wallets (id) on delete restrict,
  reservation_id uuid references public.workspace_credit_ledger (id) on delete restrict,
  mutation_key text not null,
  entry_type text not null check (
    entry_type in (
      'grant',
      'reservation',
      'reservation_denied',
      'settlement',
      'refund',
      'expiration',
      'operator_adjustment'
    )
  ),
  quantity integer not null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  purpose text,
  request_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint workspace_credit_ledger_quantity_check check (
    (entry_type = 'operator_adjustment' and quantity <> 0)
    or (entry_type = 'reservation_denied' and quantity = 0)
    or (entry_type not in ('operator_adjustment', 'reservation_denied') and quantity > 0)
  ),
  unique (mutation_key)
);

create index workspace_credit_ledger_wallet_created_idx
  on public.workspace_credit_ledger (wallet_id, created_at);

create index workspace_credit_ledger_reservation_idx
  on public.workspace_credit_ledger (reservation_id)
  where reservation_id is not null;

alter table public.customer_activations enable row level security;
alter table public.workspace_credit_wallets enable row level security;
alter table public.workspace_credit_ledger enable row level security;

create policy customer_activations_workspace_select
  on public.customer_activations for select to authenticated
  using (private.is_operator() or private.is_workspace_member(workspace_id));

create policy workspace_credit_wallets_workspace_select
  on public.workspace_credit_wallets for select to authenticated
  using (private.is_operator() or private.is_workspace_member(workspace_id));

create policy workspace_credit_ledger_workspace_select
  on public.workspace_credit_ledger for select to authenticated
  using (private.is_operator() or private.is_workspace_member(workspace_id));

revoke all on public.customer_activations from public, anon, authenticated;
revoke all on public.workspace_credit_wallets from public, anon, authenticated;
revoke all on public.workspace_credit_ledger from public, anon, authenticated;
grant select on public.customer_activations to authenticated;
grant select on public.workspace_credit_wallets to authenticated;
grant select on public.workspace_credit_ledger to authenticated;
grant all on public.customer_activations to service_role;
grant all on public.workspace_credit_wallets to service_role;
grant all on public.workspace_credit_ledger to service_role;

create or replace function private.reject_credit_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'workspace_credit_ledger is append-only';
end;
$$;

create trigger workspace_credit_ledger_append_only
  before update or delete on public.workspace_credit_ledger
  for each row execute function private.reject_credit_ledger_mutation();

create or replace function private.guard_customer_activation_monotonic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'customer activation workspace cannot change';
  end if;

  if (old.email_verified_at is not null and (new.email_verified_at is null or new.email_verified_at < old.email_verified_at))
    or (old.country_confirmed_at is not null and (new.country_confirmed_at is null or new.country_confirmed_at < old.country_confirmed_at))
    or (old.website_submitted_at is not null and (new.website_submitted_at is null or new.website_submitted_at < old.website_submitted_at))
    or (old.brand_pack_approved_at is not null and (new.brand_pack_approved_at is null or new.brand_pack_approved_at < old.brand_pack_approved_at))
    or (old.first_template_selected_at is not null and (new.first_template_selected_at is null or new.first_template_selected_at < old.first_template_selected_at))
    or (old.first_ad_pack_generated_at is not null and (new.first_ad_pack_generated_at is null or new.first_ad_pack_generated_at < old.first_ad_pack_generated_at))
    or (old.meta_help_selected_at is not null and (new.meta_help_selected_at is null or new.meta_help_selected_at < old.meta_help_selected_at))
    or (old.meta_connected_at is not null and (new.meta_connected_at is null or new.meta_connected_at < old.meta_connected_at))
    or (old.checkout_completed_at is not null and (new.checkout_completed_at is null or new.checkout_completed_at < old.checkout_completed_at))
    or (old.free_live_claim_reserved_at is not null and (new.free_live_claim_reserved_at is null or new.free_live_claim_reserved_at < old.free_live_claim_reserved_at))
    or (old.free_live_claim_consumed_at is not null and (new.free_live_claim_consumed_at is null or new.free_live_claim_consumed_at < old.free_live_claim_consumed_at))
    or (old.first_campaign_live_at is not null and (new.first_campaign_live_at is null or new.first_campaign_live_at < old.first_campaign_live_at))
    or (old.intro_invoice_paid_at is not null and (new.intro_invoice_paid_at is null or new.intro_invoice_paid_at < old.intro_invoice_paid_at))
    or (old.onboarding_booked_at is not null and (new.onboarding_booked_at is null or new.onboarding_booked_at < old.onboarding_booked_at))
    or (old.onboarding_completed_at is not null and (new.onboarding_completed_at is null or new.onboarding_completed_at < old.onboarding_completed_at))
    or (old.activation_completed_at is not null and (new.activation_completed_at is null or new.activation_completed_at < old.activation_completed_at))
  then
    raise exception 'customer activation milestones are monotonic';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger customer_activations_monotonic
  before update on public.customer_activations
  for each row execute function private.guard_customer_activation_monotonic();

create or replace function public.record_customer_activation_milestone(
  p_workspace_id uuid,
  p_milestone text,
  p_occurred_at timestamptz default now(),
  p_choice text default null
)
returns public.customer_activations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.customer_activations;
begin
  insert into public.customer_activations (workspace_id)
  values (p_workspace_id)
  on conflict (workspace_id) do nothing;

  case p_milestone
    when 'email_verified' then
      update public.customer_activations set email_verified_at = coalesce(email_verified_at, p_occurred_at) where workspace_id = p_workspace_id;
    when 'country_confirmed' then
      update public.customer_activations set country_confirmed_at = coalesce(country_confirmed_at, p_occurred_at) where workspace_id = p_workspace_id;
    when 'website_submitted' then
      update public.customer_activations set website_submitted_at = coalesce(website_submitted_at, p_occurred_at) where workspace_id = p_workspace_id;
    when 'brand_pack_approved' then
      update public.customer_activations set brand_pack_approved_at = coalesce(brand_pack_approved_at, p_occurred_at) where workspace_id = p_workspace_id;
    when 'first_template_selected' then
      update public.customer_activations set first_template_selected_at = coalesce(first_template_selected_at, p_occurred_at) where workspace_id = p_workspace_id;
    when 'first_ad_pack_generated' then
      update public.customer_activations set first_ad_pack_generated_at = coalesce(first_ad_pack_generated_at, p_occurred_at) where workspace_id = p_workspace_id;
    when 'meta_help_selected' then
      if p_choice is null or p_choice not in ('connect', 'setup_guide', 'book_onboarding', 'pre_purchase_call') then
        raise exception 'A valid Meta help path is required';
      end if;
      update public.customer_activations
      set meta_help_selected_at = coalesce(meta_help_selected_at, p_occurred_at),
          meta_help_path = coalesce(meta_help_path, p_choice)
      where workspace_id = p_workspace_id;
    when 'meta_connected' then
      update public.customer_activations set meta_connected_at = coalesce(meta_connected_at, p_occurred_at) where workspace_id = p_workspace_id;
    when 'checkout_completed' then
      update public.customer_activations set checkout_completed_at = coalesce(checkout_completed_at, p_occurred_at) where workspace_id = p_workspace_id;
    when 'free_live_claim_reserved' then
      update public.customer_activations set free_live_claim_reserved_at = coalesce(free_live_claim_reserved_at, p_occurred_at) where workspace_id = p_workspace_id;
    when 'free_live_claim_consumed' then
      update public.customer_activations set free_live_claim_consumed_at = coalesce(free_live_claim_consumed_at, p_occurred_at) where workspace_id = p_workspace_id;
    when 'first_campaign_live' then
      update public.customer_activations set first_campaign_live_at = coalesce(first_campaign_live_at, p_occurred_at) where workspace_id = p_workspace_id;
    when 'intro_invoice_paid' then
      update public.customer_activations set intro_invoice_paid_at = coalesce(intro_invoice_paid_at, p_occurred_at) where workspace_id = p_workspace_id;
    when 'onboarding_booked' then
      update public.customer_activations set onboarding_booked_at = coalesce(onboarding_booked_at, p_occurred_at) where workspace_id = p_workspace_id;
    when 'onboarding_completed' then
      update public.customer_activations set onboarding_completed_at = coalesce(onboarding_completed_at, p_occurred_at) where workspace_id = p_workspace_id;
    when 'activation_completed' then
      update public.customer_activations set activation_completed_at = coalesce(activation_completed_at, p_occurred_at) where workspace_id = p_workspace_id;
    else
      raise exception 'Unknown customer activation milestone: %', p_milestone;
  end case;

  select * into v_result
  from public.customer_activations
  where workspace_id = p_workspace_id;
  return v_result;
end;
$$;

revoke all on function public.record_customer_activation_milestone(uuid, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_customer_activation_milestone(uuid, text, timestamptz, text)
  to service_role;

create or replace function public.grant_workspace_credits(
  p_workspace_id uuid,
  p_entitlement_type text,
  p_period_key text,
  p_credits integer,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_mutation_key text,
  p_source_reference text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  wallet_id uuid,
  mutation_key text,
  credits_granted integer,
  credits_remaining integer,
  period_end timestamptz,
  entitlement_type text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.workspace_credit_ledger;
  v_previous public.workspace_credit_wallets;
  v_wallet public.workspace_credit_wallets;
  v_expired integer;
  v_request jsonb;
  v_result jsonb;
begin
  if p_entitlement_type not in ('trial', 'paid', 'operator') then
    raise exception 'Unsupported credit entitlement type';
  end if;
  if p_credits <= 0 then
    raise exception 'Credit grant must be positive';
  end if;
  if p_period_end <= p_period_start then
    raise exception 'Credit period must end after it starts';
  end if;
  if nullif(btrim(p_mutation_key), '') is null or nullif(btrim(p_period_key), '') is null then
    raise exception 'Credit period and mutation keys are required';
  end if;
  v_request := jsonb_build_object(
    'workspaceId', p_workspace_id,
    'entitlementType', p_entitlement_type,
    'periodKey', p_period_key,
    'credits', p_credits,
    'periodStart', p_period_start,
    'periodEnd', p_period_end,
    'sourceReference', p_source_reference,
    'purpose', 'entitlement_grant'
  );

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  select l.* into v_existing
  from public.workspace_credit_ledger l
  where l.mutation_key = p_mutation_key;

  if found then
    if v_existing.entry_type <> 'grant' then
      raise exception 'Credit mutation key is already used for %', v_existing.entry_type;
    end if;
    v_request := v_request || jsonb_build_object('walletId', v_existing.wallet_id);
    if v_existing.request_json <> v_request then
      raise exception 'Credit mutation key reuse does not match the original grant request';
    end if;
    return query select
      (v_existing.result_json->>'walletId')::uuid,
      v_existing.mutation_key,
      (v_existing.result_json->>'creditsGranted')::integer,
      (v_existing.result_json->>'creditsRemaining')::integer,
      (v_existing.result_json->>'periodEnd')::timestamptz,
      v_existing.result_json->>'entitlementType';
    return;
  end if;

  select w.* into v_previous
  from public.workspace_credit_wallets w
  where w.workspace_id = p_workspace_id
    and w.status = 'active'
  for update;

  if found then
    if v_previous.period_key = p_period_key then
      raise exception 'Credit period exists without its grant mutation';
    end if;
    v_expired := v_previous.credits_granted
      - v_previous.credits_reserved
      - v_previous.credits_consumed
      - v_previous.credits_expired;
    if v_previous.credits_reserved > 0 then
      raise exception 'Cannot supersede a wallet with outstanding reservations';
    end if;
    update public.workspace_credit_wallets
    set credits_expired = credits_expired + v_expired,
        status = 'expired',
        updated_at = now()
    where id = v_previous.id;

    if v_expired > 0 then
      insert into public.workspace_credit_ledger (
        workspace_id, wallet_id, mutation_key, entry_type, quantity, purpose, request_json, result_json, metadata
      )
      values (
        p_workspace_id,
        v_previous.id,
        'wallet-expire:' || v_previous.id::text || ':superseded:' || p_period_key,
        'expiration',
        v_expired,
        'entitlement_superseded',
        jsonb_build_object(
          'workspaceId', p_workspace_id,
          'walletId', v_previous.id,
          'credits', v_expired,
          'purpose', 'entitlement_superseded'
        ),
        jsonb_build_object('walletId', v_previous.id, 'creditsExpired', v_expired),
        jsonb_build_object('supersededByPeriodKey', p_period_key)
      );
    end if;
  end if;

  insert into public.workspace_credit_wallets (
    workspace_id,
    entitlement_type,
    period_key,
    period_start,
    period_end,
    status,
    credits_granted,
    source_reference,
    metadata
  )
  values (
    p_workspace_id,
    p_entitlement_type,
    p_period_key,
    p_period_start,
    p_period_end,
    case when p_period_end > now() then 'active' else 'expired' end,
    p_credits,
    p_source_reference,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_wallet;

  if v_wallet.status = 'expired' then
    update public.workspace_credit_wallets
    set credits_expired = credits_granted
    where id = v_wallet.id
    returning * into v_wallet;
  end if;
  v_request := v_request || jsonb_build_object('walletId', v_wallet.id);

  v_result := jsonb_build_object(
    'walletId', v_wallet.id,
    'creditsGranted', v_wallet.credits_granted,
    'creditsRemaining', v_wallet.credits_granted - v_wallet.credits_expired,
    'periodEnd', v_wallet.period_end,
    'entitlementType', v_wallet.entitlement_type
  );

  insert into public.workspace_credit_ledger (
    workspace_id, wallet_id, mutation_key, entry_type, quantity, purpose, request_json, result_json, metadata
  )
  values (
    p_workspace_id,
    v_wallet.id,
    p_mutation_key,
    'grant',
    p_credits,
    'entitlement_grant',
    v_request,
    v_result,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return query select
    v_wallet.id,
    p_mutation_key,
    v_wallet.credits_granted,
    v_wallet.credits_granted - v_wallet.credits_expired,
    v_wallet.period_end,
    v_wallet.entitlement_type;
end;
$$;

revoke all on function public.grant_workspace_credits(uuid, text, text, integer, timestamptz, timestamptz, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.grant_workspace_credits(uuid, text, text, integer, timestamptz, timestamptz, text, text, jsonb)
  to service_role;

create or replace function public.reserve_workspace_credits(
  p_workspace_id uuid,
  p_actor_profile_id uuid,
  p_credits integer,
  p_mutation_key text,
  p_purpose text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  allowed boolean,
  reason text,
  reservation_id uuid,
  wallet_id uuid,
  credits_reserved integer,
  credits_remaining integer,
  period_end timestamptz,
  entitlement_type text,
  mutation_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.workspace_credit_ledger;
  v_wallet public.workspace_credit_wallets;
  v_ledger_id uuid;
  v_remaining integer;
  v_reason text;
  v_request jsonb;
  v_result jsonb;
  v_billing_access_state text;
begin
  if p_credits <= 0 then
    raise exception 'Credit reservation must be positive';
  end if;
  if nullif(btrim(p_mutation_key), '') is null or nullif(btrim(p_purpose), '') is null then
    raise exception 'Credit mutation key and purpose are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  select l.* into v_existing
  from public.workspace_credit_ledger l
  where l.mutation_key = p_mutation_key;

  if found then
    if v_existing.entry_type not in ('reservation', 'reservation_denied') then
      raise exception 'Credit mutation key is already used for %', v_existing.entry_type;
    end if;
    v_request := jsonb_build_object(
      'workspaceId', p_workspace_id,
      'walletId', v_existing.wallet_id,
      'actorProfileId', p_actor_profile_id,
      'credits', p_credits,
      'purpose', p_purpose
    );
    if v_existing.request_json <> v_request then
      raise exception 'Credit mutation key reuse does not match the original reservation request';
    end if;
    return query select
      (v_existing.result_json->>'allowed')::boolean,
      v_existing.result_json->>'reason',
      nullif(v_existing.result_json->>'reservationId', '')::uuid,
      nullif(v_existing.result_json->>'walletId', '')::uuid,
      (v_existing.result_json->>'creditsReserved')::integer,
      (v_existing.result_json->>'creditsRemaining')::integer,
      nullif(v_existing.result_json->>'periodEnd', '')::timestamptz,
      v_existing.result_json->>'entitlementType',
      v_existing.mutation_key;
    return;
  end if;

  select w.* into v_wallet
  from public.workspace_credit_wallets w
  where w.workspace_id = p_workspace_id
    and w.status = 'active'
  for update;

  if not found then
    v_reason := 'no_active_entitlement';
  else
    -- to_jsonb keeps this migration replay-safe before/after the billing
    -- foundation adds billing_access_state to workspaces.
    select to_jsonb(ws)->>'billing_access_state'
    into v_billing_access_state
    from public.workspaces ws
    where ws.id = p_workspace_id;

    if v_billing_access_state in ('payment_recovery', 'refunded', 'disputed') then
      v_reason := 'billing_access_blocked';
    elsif v_wallet.entitlement_type = 'paid'
      and coalesce(v_billing_access_state, 'unbilled') not in ('paid', 'canceled')
    then
      v_reason := 'paid_entitlement_inactive';
    elsif v_wallet.period_end <= now() then
      v_reason := 'entitlement_expired';
    else
      v_remaining := v_wallet.credits_granted
        - v_wallet.credits_reserved
        - v_wallet.credits_consumed
        - v_wallet.credits_expired;
      if v_remaining < p_credits then
        v_reason := 'credit_limit_reached';
      end if;
    end if;
  end if;

  if v_reason is not null then
    v_request := jsonb_build_object(
      'workspaceId', p_workspace_id,
      'walletId', v_wallet.id,
      'actorProfileId', p_actor_profile_id,
      'credits', p_credits,
      'purpose', p_purpose
    );
    v_result := jsonb_build_object(
      'allowed', false,
      'reason', v_reason,
      'reservationId', null,
      'walletId', v_wallet.id,
      'creditsReserved', 0,
      'creditsRemaining', greatest(coalesce(v_remaining, 0), 0),
      'periodEnd', v_wallet.period_end,
      'entitlementType', v_wallet.entitlement_type
    );
    insert into public.workspace_credit_ledger (
      workspace_id, wallet_id, mutation_key, entry_type, quantity,
      actor_profile_id, purpose, request_json, result_json, metadata
    )
    values (
      p_workspace_id, v_wallet.id, p_mutation_key, 'reservation_denied', 0,
      p_actor_profile_id, p_purpose, v_request, v_result, coalesce(p_metadata, '{}'::jsonb)
    );
    return query select
      false, v_reason, null::uuid, v_wallet.id, 0,
      greatest(coalesce(v_remaining, 0), 0), v_wallet.period_end,
      v_wallet.entitlement_type, p_mutation_key;
    return;
  end if;

  update public.workspace_credit_wallets
  set credits_reserved = credits_reserved + p_credits,
      updated_at = now()
  where id = v_wallet.id;
  v_remaining := v_remaining - p_credits;
  v_ledger_id := gen_random_uuid();
  v_request := jsonb_build_object(
    'workspaceId', p_workspace_id,
    'walletId', v_wallet.id,
    'actorProfileId', p_actor_profile_id,
    'credits', p_credits,
    'purpose', p_purpose
  );
  v_result := jsonb_build_object(
    'allowed', true,
    'reason', 'reserved',
    'reservationId', v_ledger_id,
    'walletId', v_wallet.id,
    'creditsReserved', p_credits,
    'creditsRemaining', v_remaining,
    'periodEnd', v_wallet.period_end,
    'entitlementType', v_wallet.entitlement_type
  );

  insert into public.workspace_credit_ledger (
    id, workspace_id, wallet_id, mutation_key, entry_type, quantity,
    actor_profile_id, purpose, request_json, result_json, metadata
  )
  values (
    v_ledger_id, p_workspace_id, v_wallet.id, p_mutation_key, 'reservation', p_credits,
    p_actor_profile_id, p_purpose, v_request, v_result, coalesce(p_metadata, '{}'::jsonb)
  );

  return query select
    true, 'reserved'::text, v_ledger_id, v_wallet.id, p_credits,
    v_remaining, v_wallet.period_end, v_wallet.entitlement_type, p_mutation_key;
end;
$$;

revoke all on function public.reserve_workspace_credits(uuid, uuid, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.reserve_workspace_credits(uuid, uuid, integer, text, text, jsonb)
  to service_role;

create or replace function public.settle_workspace_credit_reservation(
  p_workspace_id uuid,
  p_reservation_id uuid,
  p_credits integer,
  p_mutation_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  reservation_id uuid,
  wallet_id uuid,
  credits_settled integer,
  credits_outstanding integer,
  credits_remaining integer,
  mutation_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.workspace_credit_ledger;
  v_reservation public.workspace_credit_ledger;
  v_wallet public.workspace_credit_wallets;
  v_closed integer;
  v_outstanding integer;
  v_remaining integer;
  v_request jsonb;
  v_result jsonb;
begin
  if p_credits <= 0 then
    raise exception 'Credit settlement must be positive';
  end if;
  if nullif(btrim(p_mutation_key), '') is null then
    raise exception 'Credit mutation key is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  select l.* into v_reservation
  from public.workspace_credit_ledger l
  where l.workspace_id = p_workspace_id
    and l.id = p_reservation_id
    and l.entry_type = 'reservation';
  if not found then
    raise exception 'Credit reservation was not found';
  end if;
  v_request := jsonb_build_object(
    'workspaceId', p_workspace_id,
    'walletId', v_reservation.wallet_id,
    'reservationId', p_reservation_id,
    'credits', p_credits,
    'purpose', v_reservation.purpose
  );

  select l.* into v_existing
  from public.workspace_credit_ledger l
  where l.mutation_key = p_mutation_key;
  if found then
    if v_existing.entry_type <> 'settlement' then
      raise exception 'Credit mutation key is already used for %', v_existing.entry_type;
    end if;
    if v_existing.request_json <> v_request then
      raise exception 'Credit mutation key reuse does not match the original settlement request';
    end if;
    return query select
      (v_existing.result_json->>'reservationId')::uuid,
      (v_existing.result_json->>'walletId')::uuid,
      (v_existing.result_json->>'creditsSettled')::integer,
      (v_existing.result_json->>'creditsOutstanding')::integer,
      (v_existing.result_json->>'creditsRemaining')::integer,
      v_existing.mutation_key;
    return;
  end if;

  select w.* into v_wallet
  from public.workspace_credit_wallets w
  where w.workspace_id = p_workspace_id
    and w.id = v_reservation.wallet_id
  for update;

  select coalesce(sum(l.quantity), 0)::integer into v_closed
  from public.workspace_credit_ledger l
  where l.workspace_id = p_workspace_id
    and l.reservation_id = p_reservation_id
    and l.entry_type in ('settlement', 'refund');
  v_outstanding := v_reservation.quantity - v_closed;
  if p_credits > v_outstanding then
    raise exception 'Credit settlement exceeds reservation outstanding amount';
  end if;

  update public.workspace_credit_wallets
  set credits_reserved = credits_reserved - p_credits,
      credits_consumed = credits_consumed + p_credits,
      updated_at = now()
  where id = v_wallet.id;

  v_outstanding := v_outstanding - p_credits;
  v_remaining := v_wallet.credits_granted
    - (v_wallet.credits_reserved - p_credits)
    - (v_wallet.credits_consumed + p_credits)
    - v_wallet.credits_expired;
  v_result := jsonb_build_object(
    'reservationId', p_reservation_id,
    'walletId', v_wallet.id,
    'creditsSettled', p_credits,
    'creditsOutstanding', v_outstanding,
    'creditsRemaining', v_remaining
  );

  insert into public.workspace_credit_ledger (
    workspace_id, wallet_id, reservation_id, mutation_key, entry_type,
    quantity, purpose, request_json, result_json, metadata
  )
  values (
    p_workspace_id, v_wallet.id, p_reservation_id, p_mutation_key, 'settlement',
    p_credits, v_reservation.purpose, v_request, v_result, coalesce(p_metadata, '{}'::jsonb)
  );

  return query select
    p_reservation_id, v_wallet.id, p_credits, v_outstanding, v_remaining, p_mutation_key;
end;
$$;

revoke all on function public.settle_workspace_credit_reservation(uuid, uuid, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.settle_workspace_credit_reservation(uuid, uuid, integer, text, jsonb)
  to service_role;

create or replace function public.refund_workspace_credit_reservation(
  p_workspace_id uuid,
  p_reservation_id uuid,
  p_credits integer,
  p_mutation_key text,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  reservation_id uuid,
  wallet_id uuid,
  credits_refunded integer,
  credits_outstanding integer,
  credits_remaining integer,
  mutation_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.workspace_credit_ledger;
  v_reservation public.workspace_credit_ledger;
  v_wallet public.workspace_credit_wallets;
  v_closed integer;
  v_outstanding integer;
  v_remaining integer;
  v_request jsonb;
  v_result jsonb;
begin
  if p_credits <= 0 then
    raise exception 'Credit refund must be positive';
  end if;
  if nullif(btrim(p_mutation_key), '') is null or nullif(btrim(p_reason), '') is null then
    raise exception 'Credit refund mutation key and reason are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  select l.* into v_reservation
  from public.workspace_credit_ledger l
  where l.workspace_id = p_workspace_id
    and l.id = p_reservation_id
    and l.entry_type = 'reservation';
  if not found then
    raise exception 'Credit reservation was not found';
  end if;
  v_request := jsonb_build_object(
    'workspaceId', p_workspace_id,
    'walletId', v_reservation.wallet_id,
    'reservationId', p_reservation_id,
    'credits', p_credits,
    'purpose', p_reason
  );

  select l.* into v_existing
  from public.workspace_credit_ledger l
  where l.mutation_key = p_mutation_key;
  if found then
    if v_existing.entry_type <> 'refund' then
      raise exception 'Credit mutation key is already used for %', v_existing.entry_type;
    end if;
    if v_existing.request_json <> v_request then
      raise exception 'Credit mutation key reuse does not match the original refund request';
    end if;
    return query select
      (v_existing.result_json->>'reservationId')::uuid,
      (v_existing.result_json->>'walletId')::uuid,
      (v_existing.result_json->>'creditsRefunded')::integer,
      (v_existing.result_json->>'creditsOutstanding')::integer,
      (v_existing.result_json->>'creditsRemaining')::integer,
      v_existing.mutation_key;
    return;
  end if;

  select w.* into v_wallet
  from public.workspace_credit_wallets w
  where w.workspace_id = p_workspace_id
    and w.id = v_reservation.wallet_id
  for update;

  select coalesce(sum(l.quantity), 0)::integer into v_closed
  from public.workspace_credit_ledger l
  where l.workspace_id = p_workspace_id
    and l.reservation_id = p_reservation_id
    and l.entry_type in ('settlement', 'refund');
  v_outstanding := v_reservation.quantity - v_closed;
  if p_credits > v_outstanding then
    raise exception 'Credit refund exceeds reservation outstanding amount';
  end if;

  update public.workspace_credit_wallets
  set credits_reserved = credits_reserved - p_credits,
      updated_at = now()
  where id = v_wallet.id;

  v_outstanding := v_outstanding - p_credits;
  v_remaining := v_wallet.credits_granted
    - (v_wallet.credits_reserved - p_credits)
    - v_wallet.credits_consumed
    - v_wallet.credits_expired;
  v_result := jsonb_build_object(
    'reservationId', p_reservation_id,
    'walletId', v_wallet.id,
    'creditsRefunded', p_credits,
    'creditsOutstanding', v_outstanding,
    'creditsRemaining', v_remaining
  );

  insert into public.workspace_credit_ledger (
    workspace_id, wallet_id, reservation_id, mutation_key, entry_type,
    quantity, purpose, request_json, result_json, metadata
  )
  values (
    p_workspace_id, v_wallet.id, p_reservation_id, p_mutation_key, 'refund',
    p_credits, p_reason, v_request, v_result, coalesce(p_metadata, '{}'::jsonb)
  );

  return query select
    p_reservation_id, v_wallet.id, p_credits, v_outstanding, v_remaining, p_mutation_key;
end;
$$;

revoke all on function public.refund_workspace_credit_reservation(uuid, uuid, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.refund_workspace_credit_reservation(uuid, uuid, integer, text, text, jsonb)
  to service_role;

create or replace function public.adjust_workspace_credits(
  p_workspace_id uuid,
  p_delta integer,
  p_mutation_key text,
  p_reason text,
  p_actor_profile_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  wallet_id uuid,
  credits_granted integer,
  credits_remaining integer,
  mutation_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.workspace_credit_ledger;
  v_wallet public.workspace_credit_wallets;
  v_new_granted integer;
  v_remaining integer;
  v_request jsonb;
  v_result jsonb;
begin
  if p_delta = 0 or nullif(btrim(p_reason), '') is null or nullif(btrim(p_mutation_key), '') is null then
    raise exception 'Non-zero adjustment, reason, and mutation key are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  select l.* into v_existing from public.workspace_credit_ledger l
  where l.mutation_key = p_mutation_key;
  if found then
    if v_existing.entry_type <> 'operator_adjustment' then
      raise exception 'Credit mutation key is already used for %', v_existing.entry_type;
    end if;
    v_request := jsonb_build_object(
      'workspaceId', p_workspace_id,
      'walletId', v_existing.wallet_id,
      'credits', p_delta,
      'purpose', p_reason,
      'actorProfileId', p_actor_profile_id
    );
    if v_existing.request_json <> v_request then
      raise exception 'Credit mutation key reuse does not match the original adjustment request';
    end if;
    return query select
      (v_existing.result_json->>'walletId')::uuid,
      (v_existing.result_json->>'creditsGranted')::integer,
      (v_existing.result_json->>'creditsRemaining')::integer,
      v_existing.mutation_key;
    return;
  end if;

  select w.* into v_wallet
  from public.workspace_credit_wallets w
  where w.workspace_id = p_workspace_id and w.status = 'active'
  for update;
  if not found then raise exception 'No active credit wallet'; end if;
  v_request := jsonb_build_object(
    'workspaceId', p_workspace_id,
    'walletId', v_wallet.id,
    'credits', p_delta,
    'purpose', p_reason,
    'actorProfileId', p_actor_profile_id
  );

  v_new_granted := v_wallet.credits_granted + p_delta;
  if v_new_granted < v_wallet.credits_reserved + v_wallet.credits_consumed + v_wallet.credits_expired then
    raise exception 'Adjustment would make the credit wallet negative';
  end if;
  update public.workspace_credit_wallets
  set credits_granted = v_new_granted, updated_at = now()
  where id = v_wallet.id;
  v_remaining := v_new_granted - v_wallet.credits_reserved - v_wallet.credits_consumed - v_wallet.credits_expired;
  v_result := jsonb_build_object(
    'walletId', v_wallet.id,
    'creditsGranted', v_new_granted,
    'creditsRemaining', v_remaining
  );
  insert into public.workspace_credit_ledger (
    workspace_id, wallet_id, mutation_key, entry_type, quantity,
    actor_profile_id, purpose, request_json, result_json, metadata
  ) values (
    p_workspace_id, v_wallet.id, p_mutation_key, 'operator_adjustment', p_delta,
    p_actor_profile_id, p_reason, v_request, v_result, coalesce(p_metadata, '{}'::jsonb)
  );
  return query select v_wallet.id, v_new_granted, v_remaining, p_mutation_key;
end;
$$;

revoke all on function public.adjust_workspace_credits(uuid, integer, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.adjust_workspace_credits(uuid, integer, text, text, uuid, jsonb)
  to service_role;

create or replace function public.get_workspace_credit_balance(p_workspace_id uuid)
returns table (
  wallet_id uuid,
  entitlement_type text,
  period_start timestamptz,
  period_end timestamptz,
  credits_granted integer,
  credits_reserved integer,
  credits_consumed integer,
  credits_expired integer,
  credits_remaining integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    w.id,
    w.entitlement_type,
    w.period_start,
    w.period_end,
    w.credits_granted,
    w.credits_reserved,
    w.credits_consumed,
    w.credits_expired,
    greatest(
      w.credits_granted - w.credits_reserved - w.credits_consumed - w.credits_expired,
      0
    )::integer
  from public.workspace_credit_wallets w
  where w.workspace_id = p_workspace_id
    and w.status = 'active'
    and (private.is_operator() or private.is_workspace_member(w.workspace_id));
$$;

revoke all on function public.get_workspace_credit_balance(uuid) from public, anon;
grant execute on function public.get_workspace_credit_balance(uuid) to authenticated;

-- Backfill the activation record from owning source tables. These timestamps
-- are repairs only: the monotonic guard prevents a source reconciliation from
-- ever erasing an already-observed milestone.
insert into public.customer_activations (
  workspace_id,
  email_verified_at,
  website_submitted_at,
  brand_pack_approved_at,
  first_template_selected_at,
  first_ad_pack_generated_at,
  meta_connected_at,
  checkout_completed_at
)
select
  w.id,
  (
    select min(coalesce(u.email_confirmed_at, u.confirmed_at))
    from public.workspace_members wm
    join auth.users u on u.id = wm.profile_id
    where wm.workspace_id = w.id
      and wm.role = 'owner'
  ),
  (
    select min(b.created_at)
    from public.adstudio_brand_kits b
    where b.workspace_id = w.id
      and nullif(btrim(b.source_url), '') is not null
  ),
  (
    select min(b.updated_at)
    from public.adstudio_brand_kits b
    where b.workspace_id = w.id
      and b.review_status = 'approved'
  ),
  (
    select min(c.created_at)
    from public.adstudio_campaigns c
    where c.workspace_id = w.id
      and c.template_key is not null
  ),
  (
    select min(c.created_at)
    from public.adstudio_campaigns c
    where c.workspace_id = w.id
      and exists (
        select 1
        from public.adstudio_creatives cr
        where cr.workspace_id = w.id
          and cr.campaign_id = c.id
          and cr.render_status = 'rendered'
      )
  ),
  (
    select min(pc.created_at)
    from public.provider_connections pc
    where pc.workspace_id = w.id
      and pc.provider = 'meta'
      and pc.status = 'connected'
  ),
  case when w.stripe_subscription_id is not null then w.updated_at end
from public.workspaces w
where w.mode = 'self_serve'
on conflict (workspace_id) do nothing;

-- Convert the old pack counter once. A historical pack consumed two renders;
-- the approved trial is capped at six renders (three complete ad packs).
with verified_trials as (
  select
    w.id as workspace_id,
    min(coalesce(u.email_confirmed_at, u.confirmed_at)) as verified_at
  from public.workspaces w
  join public.workspace_plans wp on wp.id = w.plan_id and wp.key = 'trial'
  join public.workspace_members wm on wm.workspace_id = w.id and wm.role = 'owner'
  join auth.users u on u.id = wm.profile_id
  where coalesce(u.email_confirmed_at, u.confirmed_at) is not null
  group by w.id
)
update public.workspaces w
set trial_started_at = greatest(coalesce(w.trial_started_at, v.verified_at), v.verified_at),
    trial_ends_at = greatest(
      coalesce(w.trial_ends_at, v.verified_at + interval '7 days'),
      v.verified_at + interval '7 days'
    ),
    updated_at = now()
from verified_trials v
where w.id = v.workspace_id;

insert into public.workspace_credit_wallets (
  workspace_id,
  entitlement_type,
  period_key,
  period_start,
  period_end,
  status,
  credits_granted,
  credits_consumed,
  credits_expired,
  source_reference,
  metadata
)
select
  w.id,
  'trial',
  'trial:' || w.id::text,
  coalesce(w.trial_started_at, w.created_at),
  greatest(
    coalesce(w.trial_ends_at, coalesce(w.trial_started_at, w.created_at) + interval '7 days'),
    coalesce(w.trial_started_at, w.created_at) + interval '1 second'
  ),
  case
    when coalesce(w.trial_ends_at, coalesce(w.trial_started_at, w.created_at) + interval '7 days') > now()
      then 'active'
    else 'expired'
  end,
  6,
  least(coalesce(rl.used_count, 0) * 2, 6),
  case
    when coalesce(w.trial_ends_at, coalesce(w.trial_started_at, w.created_at) + interval '7 days') <= now()
      then 6 - least(coalesce(rl.used_count, 0) * 2, 6)
    else 0
  end,
  'legacy_trial_backfill',
  jsonb_build_object(
    'legacySubjectKey', 'ad_pack_generation',
    'legacyUsedPacks', coalesce(rl.used_count, 0)
  )
from public.workspaces w
join public.workspace_plans wp on wp.id = w.plan_id and wp.key = 'trial'
left join public.rate_limits rl
  on rl.workspace_id = w.id
 and rl.subject_key = 'ad_pack_generation'
 and rl.bucket = 'trial'
where exists (
  select 1
  from public.workspace_members wm
  join auth.users u on u.id = wm.profile_id
  where wm.workspace_id = w.id
    and wm.role = 'owner'
    and coalesce(u.email_confirmed_at, u.confirmed_at) is not null
)
on conflict (workspace_id, period_key) do nothing;

insert into public.workspace_credit_ledger (
  workspace_id, wallet_id, mutation_key, entry_type, quantity, purpose, request_json, result_json, metadata
)
select
  w.workspace_id,
  w.id,
  'trial-grant:' || w.workspace_id::text,
  'grant',
  w.credits_granted,
  'trial_entitlement',
  jsonb_build_object(
    'workspaceId', w.workspace_id,
    'walletId', w.id,
    'entitlementType', w.entitlement_type,
    'periodKey', w.period_key,
    'credits', w.credits_granted,
    'periodStart', w.period_start,
    'periodEnd', w.period_end,
    'sourceReference', w.source_reference,
    'purpose', 'entitlement_grant'
  ),
  jsonb_build_object(
    'walletId', w.id,
    'creditsGranted', w.credits_granted,
    'creditsRemaining', w.credits_granted - w.credits_consumed - w.credits_expired,
    'periodEnd', w.period_end,
    'entitlementType', w.entitlement_type
  ),
  w.metadata
from public.workspace_credit_wallets w
where w.entitlement_type = 'trial';

insert into public.workspace_credit_ledger (
  workspace_id, wallet_id, mutation_key, entry_type, quantity, purpose, request_json, result_json, metadata
)
select
  w.workspace_id,
  w.id,
  'legacy-trial-settlement:' || w.workspace_id::text,
  'settlement',
  w.credits_consumed,
  'legacy_trial_backfill',
  jsonb_build_object(
    'workspaceId', w.workspace_id,
    'walletId', w.id,
    'reservationId', null,
    'credits', w.credits_consumed,
    'purpose', 'legacy_trial_backfill'
  ),
  jsonb_build_object(
    'walletId', w.id,
    'creditsSettled', w.credits_consumed,
    'creditsOutstanding', 0,
    'creditsRemaining', w.credits_granted - w.credits_consumed - w.credits_expired
  ),
  w.metadata
from public.workspace_credit_wallets w
where w.entitlement_type = 'trial'
  and w.credits_consumed > 0;

insert into public.workspace_credit_ledger (
  workspace_id, wallet_id, mutation_key, entry_type, quantity, purpose, request_json, result_json, metadata
)
select
  w.workspace_id,
  w.id,
  'trial-expiration:' || w.workspace_id::text,
  'expiration',
  w.credits_expired,
  'trial_period_ended',
  jsonb_build_object(
    'workspaceId', w.workspace_id,
    'walletId', w.id,
    'credits', w.credits_expired,
    'purpose', 'trial_period_ended'
  ),
  jsonb_build_object('walletId', w.id, 'creditsExpired', w.credits_expired),
  w.metadata
from public.workspace_credit_wallets w
where w.entitlement_type = 'trial'
  and w.credits_expired > 0;

create or replace function private.provision_workspace_activation_foundation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_key text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_wallet_id uuid;
begin
  if new.mode <> 'self_serve' then
    return new;
  end if;

  insert into public.customer_activations (workspace_id)
  values (new.id)
  on conflict (workspace_id) do nothing;

  select wp.key into v_plan_key
  from public.workspace_plans wp
  where wp.id = new.plan_id;
  if v_plan_key <> 'trial' then
    return new;
  end if;

  v_period_start := coalesce(new.trial_started_at, new.created_at, now());
  v_period_end := greatest(coalesce(new.trial_ends_at, v_period_start + interval '7 days'), v_period_start + interval '1 second');
  insert into public.workspace_credit_wallets (
    workspace_id, entitlement_type, period_key, period_start, period_end,
    status, credits_granted, credits_expired, source_reference
  )
  values (
    new.id, 'trial', 'trial:' || new.id::text, v_period_start, v_period_end,
    case when v_period_end > now() then 'active' else 'expired' end,
    6, case when v_period_end > now() then 0 else 6 end, 'workspace_provisioning'
  )
  on conflict (workspace_id, period_key) do nothing
  returning id into v_wallet_id;

  if v_wallet_id is not null then
    insert into public.workspace_credit_ledger (
      workspace_id, wallet_id, mutation_key, entry_type, quantity, purpose, request_json, result_json
    )
    select
      new.id,
      w.id,
      'trial-grant:' || new.id::text,
      'grant',
      6,
      'trial_entitlement',
      jsonb_build_object(
        'workspaceId', new.id,
        'walletId', w.id,
        'entitlementType', 'trial',
        'periodKey', w.period_key,
        'credits', 6,
        'periodStart', w.period_start,
        'periodEnd', w.period_end,
        'sourceReference', w.source_reference,
        'purpose', 'entitlement_grant'
      ),
      jsonb_build_object(
        'walletId', w.id,
        'creditsGranted', 6,
        'creditsRemaining', case when w.status = 'active' then 6 else 0 end,
        'periodEnd', w.period_end,
        'entitlementType', 'trial'
      )
    from public.workspace_credit_wallets w
    where w.id = v_wallet_id;
  end if;
  return new;
end;
$$;

drop trigger if exists provision_workspace_activation_foundation on public.workspaces;
create trigger provision_workspace_activation_foundation
  after insert on public.workspaces
  for each row execute function private.provision_workspace_activation_foundation();

-- Rolling-deployment compatibility only. These legacy signatures delegate to
-- the shared ledger and never touch rate_limits. Remove them in a later
-- release after every generation deployment uses the shared credit RPCs.
create or replace function public.reserve_trial_ad_pack_credit(
  target_workspace_id uuid,
  actor_profile_id uuid
)
returns table (
  allowed boolean,
  reason text,
  used_count integer,
  limit_count integer,
  trial_ends_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credit record;
  v_wallet public.workspace_credit_wallets;
begin
  select * into v_credit
  from public.reserve_workspace_credits(
    target_workspace_id,
    actor_profile_id,
    2,
    'legacy-trial-pack:' || target_workspace_id::text || ':' || gen_random_uuid()::text,
    'legacy_trial_ad_pack',
    jsonb_build_object('compatibilityWrapper', true)
  );

  if v_credit.wallet_id is not null then
    select * into v_wallet
    from public.workspace_credit_wallets w
    where w.workspace_id = target_workspace_id
      and w.id = v_credit.wallet_id;
  end if;

  allowed := coalesce(v_credit.allowed, false);
  reason := case v_credit.reason
    when 'entitlement_expired' then 'trial_expired'
    when 'no_active_entitlement' then 'trial_expired'
    else v_credit.reason
  end;
  used_count := (
    coalesce(v_wallet.credits_consumed, 0) + coalesce(v_wallet.credits_reserved, 0)
  ) / 2;
  limit_count := coalesce(v_wallet.credits_granted, 0) / 2;
  trial_ends_at := v_wallet.period_end;
  return next;
end;
$$;

revoke all on function public.reserve_trial_ad_pack_credit(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_trial_ad_pack_credit(uuid, uuid)
  to service_role;

create or replace function public.refund_trial_ad_pack_credit(target_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation_id uuid;
  v_outstanding integer;
begin
  select
    r.id,
    r.quantity - coalesce(sum(c.quantity), 0)::integer
  into v_reservation_id, v_outstanding
  from public.workspace_credit_ledger r
  left join public.workspace_credit_ledger c
    on c.workspace_id = r.workspace_id
   and c.reservation_id = r.id
   and c.entry_type in ('settlement', 'refund')
  where r.workspace_id = target_workspace_id
    and r.entry_type = 'reservation'
    and r.purpose = 'legacy_trial_ad_pack'
  group by r.id, r.quantity, r.created_at
  having r.quantity - coalesce(sum(c.quantity), 0)::integer > 0
  order by r.created_at desc
  limit 1;

  if v_reservation_id is null or v_outstanding <= 0 then
    return;
  end if;

  perform public.refund_workspace_credit_reservation(
    target_workspace_id,
    v_reservation_id,
    v_outstanding,
    'legacy-trial-refund:' || v_reservation_id::text || ':' || gen_random_uuid()::text,
    'legacy_trial_generation_failed',
    jsonb_build_object('compatibilityWrapper', true)
  );
end;
$$;

revoke all on function public.refund_trial_ad_pack_credit(uuid)
  from public, anon, authenticated;
grant execute on function public.refund_trial_ad_pack_credit(uuid)
  to service_role;

-- Compatibility status reads also derive from the shared wallet.

create or replace function public.get_trial_status(target_workspace_id uuid)
returns table (
  plan_key text,
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
