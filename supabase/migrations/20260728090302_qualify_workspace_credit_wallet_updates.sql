-- PostgreSQL 17 rejects unqualified wallet columns when a PL/pgSQL
-- RETURNS TABLE output has the same name. Qualify every mutable wallet read
-- so reservation, settlement, refund, and expired-period grants share one
-- unambiguous credit path.

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
    update public.workspace_credit_wallets as w
    set credits_expired = w.credits_expired + v_expired,
        status = 'expired',
        updated_at = now()
    where w.id = v_previous.id;

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
    update public.workspace_credit_wallets as w
    set credits_expired = w.credits_granted
    where w.id = v_wallet.id
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

  update public.workspace_credit_wallets as w
  set credits_reserved = w.credits_reserved + p_credits,
      updated_at = now()
  where w.id = v_wallet.id;
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

  update public.workspace_credit_wallets as w
  set credits_reserved = w.credits_reserved - p_credits,
      credits_consumed = w.credits_consumed + p_credits,
      updated_at = now()
  where w.id = v_wallet.id;

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

  update public.workspace_credit_wallets as w
  set credits_reserved = w.credits_reserved - p_credits,
      updated_at = now()
  where w.id = v_wallet.id;

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
;
