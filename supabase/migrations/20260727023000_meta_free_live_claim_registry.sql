-- One free live-campaign setup per Meta Business Portfolio + ad account.
-- Rows and mutation history deliberately survive workspace/customer deletion.

create table public.meta_free_live_claims (
  id uuid primary key default gen_random_uuid(),
  meta_business_id text not null,
  meta_ad_account_id text not null,
  status text not null default 'available'
    check (status in ('available', 'reserved', 'consumed')),
  reservation_key text,
  reserved_workspace_id uuid,
  reserved_plan_id uuid,
  reserved_at timestamptz,
  consumed_workspace_id uuid,
  consumed_plan_id uuid,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_free_live_claims_business_nonempty
    check (meta_business_id = lower(btrim(meta_business_id)) and meta_business_id <> ''),
  constraint meta_free_live_claims_account_nonempty
    check (meta_ad_account_id = lower(btrim(meta_ad_account_id)) and meta_ad_account_id <> ''),
  constraint meta_free_live_claims_state_check check (
    (status = 'available' and reservation_key is null and reserved_workspace_id is null and reserved_plan_id is null)
    or
    (status = 'reserved' and reservation_key is not null and reserved_workspace_id is not null and reserved_plan_id is not null and reserved_at is not null)
    or
    (status = 'consumed' and reservation_key is not null and consumed_workspace_id is not null and consumed_plan_id is not null and consumed_at is not null)
  ),
  unique (meta_business_id, meta_ad_account_id)
);

create index meta_free_live_claims_status_idx
  on public.meta_free_live_claims (status, updated_at desc);

create table public.meta_free_live_claim_mutations (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.meta_free_live_claims (id) on delete restrict,
  workspace_id uuid,
  plan_id uuid,
  mutation_key text not null,
  action text not null check (action in ('reserve', 'consume', 'release')),
  outcome text not null,
  result_json jsonb not null,
  created_at timestamptz not null default now(),
  constraint meta_free_live_claim_mutations_key_nonempty check (btrim(mutation_key) <> ''),
  unique (action, mutation_key)
);

create index meta_free_live_claim_mutations_claim_created_idx
  on public.meta_free_live_claim_mutations (claim_id, created_at);

alter table public.meta_free_live_claims enable row level security;
alter table public.meta_free_live_claim_mutations enable row level security;

revoke all on public.meta_free_live_claims from public, anon, authenticated;
revoke all on public.meta_free_live_claim_mutations from public, anon, authenticated;
grant all on public.meta_free_live_claims to service_role;
grant all on public.meta_free_live_claim_mutations to service_role;

create or replace function private.reject_meta_free_live_mutation_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'meta_free_live_claim_mutations is append-only';
end;
$$;

create trigger meta_free_live_claim_mutations_append_only
  before update or delete on public.meta_free_live_claim_mutations
  for each row execute function private.reject_meta_free_live_mutation_change();

create or replace function public.reserve_meta_free_live_claim(
  p_workspace_id uuid,
  p_meta_business_id text,
  p_meta_ad_account_id text,
  p_plan_id uuid,
  p_reservation_key text,
  p_mutation_key text
)
returns table (
  allowed boolean,
  reason text,
  claim_id uuid,
  status text,
  mutation_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id text := lower(btrim(p_meta_business_id));
  v_account_id text := lower(regexp_replace(btrim(p_meta_ad_account_id), '^act_', '', 'i'));
  v_reservation_key text := btrim(p_reservation_key);
  v_key text := btrim(p_mutation_key);
  v_claim public.meta_free_live_claims;
  v_existing public.meta_free_live_claim_mutations;
  v_allowed boolean;
  v_reason text;
  v_result jsonb;
begin
  if v_business_id = '' or v_account_id = '' or v_reservation_key = '' or v_key = '' or p_workspace_id is null or p_plan_id is null then
    raise exception 'Workspace, Meta Business, ad account, publish plan, and mutation key are required';
  end if;

  select m.* into v_existing
  from public.meta_free_live_claim_mutations m
  where m.action = 'reserve' and m.mutation_key = v_key;

  if found then
    return query select
      (v_existing.result_json->>'allowed')::boolean,
      v_existing.result_json->>'reason',
      (v_existing.result_json->>'claimId')::uuid,
      v_existing.result_json->>'status',
      v_key;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_business_id || ':' || v_account_id, 0));

  select m.* into v_existing
  from public.meta_free_live_claim_mutations m
  where m.action = 'reserve' and m.mutation_key = v_key;
  if found then
    return query select
      (v_existing.result_json->>'allowed')::boolean,
      v_existing.result_json->>'reason',
      (v_existing.result_json->>'claimId')::uuid,
      v_existing.result_json->>'status',
      v_key;
    return;
  end if;

  insert into public.meta_free_live_claims (meta_business_id, meta_ad_account_id)
  values (v_business_id, v_account_id)
  on conflict (meta_business_id, meta_ad_account_id) do nothing;

  select c.* into v_claim
  from public.meta_free_live_claims c
  where c.meta_business_id = v_business_id and c.meta_ad_account_id = v_account_id
  for update;

  if v_claim.status = 'consumed' then
    v_allowed := v_claim.reservation_key = v_reservation_key
      and v_claim.consumed_workspace_id = p_workspace_id
      and v_claim.consumed_plan_id = p_plan_id;
    v_reason := case when v_allowed then 'already_consumed' else 'already_claimed' end;
  elsif v_claim.status = 'reserved' then
    v_allowed := v_claim.reservation_key = v_reservation_key
      and v_claim.reserved_workspace_id = p_workspace_id
      and v_claim.reserved_plan_id = p_plan_id;
    v_reason := case when v_allowed then 'already_reserved' else 'reserved_elsewhere' end;
  else
    update public.meta_free_live_claims
    set status = 'reserved',
        reservation_key = v_reservation_key,
        reserved_workspace_id = p_workspace_id,
        reserved_plan_id = p_plan_id,
        reserved_at = now(),
        updated_at = now()
    where id = v_claim.id
    returning * into v_claim;
    v_allowed := true;
    v_reason := 'reserved';
  end if;

  v_result := jsonb_build_object(
    'allowed', v_allowed,
    'reason', v_reason,
    'claimId', v_claim.id,
    'status', v_claim.status
  );

  insert into public.meta_free_live_claim_mutations (
    claim_id, workspace_id, plan_id, mutation_key, action, outcome, result_json
  )
  values (v_claim.id, p_workspace_id, p_plan_id, v_key, 'reserve', v_reason, v_result);

  if v_allowed and v_reason in ('reserved', 'already_reserved') then
    perform public.record_customer_activation_milestone(
      p_workspace_id,
      'free_live_claim_reserved',
      now(),
      null
    );
  end if;

  return query select v_allowed, v_reason, v_claim.id, v_claim.status, v_key;
end;
$$;

create or replace function public.consume_meta_free_live_claim(
  p_workspace_id uuid,
  p_meta_business_id text,
  p_meta_ad_account_id text,
  p_plan_id uuid,
  p_reservation_key text,
  p_mutation_key text
)
returns table (
  consumed boolean,
  reason text,
  claim_id uuid,
  status text,
  mutation_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id text := lower(btrim(p_meta_business_id));
  v_account_id text := lower(regexp_replace(btrim(p_meta_ad_account_id), '^act_', '', 'i'));
  v_reservation_key text := btrim(p_reservation_key);
  v_key text := btrim(p_mutation_key);
  v_claim public.meta_free_live_claims;
  v_existing public.meta_free_live_claim_mutations;
  v_consumed boolean;
  v_reason text;
  v_result jsonb;
begin
  if v_business_id = '' or v_account_id = '' or v_reservation_key = '' or v_key = '' then
    raise exception 'Meta identity, reservation key, and mutation key are required';
  end if;

  select m.* into v_existing
  from public.meta_free_live_claim_mutations m
  where m.action = 'consume' and m.mutation_key = v_key;

  if found then
    return query select
      (v_existing.result_json->>'consumed')::boolean,
      v_existing.result_json->>'reason',
      (v_existing.result_json->>'claimId')::uuid,
      v_existing.result_json->>'status',
      v_key;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_business_id || ':' || v_account_id, 0));

  select m.* into v_existing
  from public.meta_free_live_claim_mutations m
  where m.action = 'consume' and m.mutation_key = v_key;
  if found then
    return query select
      (v_existing.result_json->>'consumed')::boolean,
      v_existing.result_json->>'reason',
      (v_existing.result_json->>'claimId')::uuid,
      v_existing.result_json->>'status',
      v_key;
    return;
  end if;

  select c.* into v_claim
  from public.meta_free_live_claims c
  where c.meta_business_id = v_business_id and c.meta_ad_account_id = v_account_id
  for update;

  if not found then
    raise exception 'Free-live claim does not exist';
  end if;

  if v_claim.status = 'consumed'
    and v_claim.reservation_key = v_reservation_key
    and v_claim.consumed_workspace_id = p_workspace_id
    and v_claim.consumed_plan_id = p_plan_id
  then
    v_consumed := true;
    v_reason := 'already_consumed';
  elsif v_claim.status = 'reserved'
    and v_claim.reservation_key = v_reservation_key
    and v_claim.reserved_workspace_id = p_workspace_id
    and v_claim.reserved_plan_id = p_plan_id
  then
    update public.meta_free_live_claims
    set status = 'consumed',
        consumed_workspace_id = p_workspace_id,
        consumed_plan_id = p_plan_id,
        consumed_at = now(),
        updated_at = now()
    where id = v_claim.id
    returning * into v_claim;
    v_consumed := true;
    v_reason := 'consumed';
  else
    v_consumed := false;
    v_reason := case when v_claim.status = 'consumed' then 'already_claimed' else 'reservation_mismatch' end;
  end if;

  v_result := jsonb_build_object(
    'consumed', v_consumed,
    'reason', v_reason,
    'claimId', v_claim.id,
    'status', v_claim.status
  );
  insert into public.meta_free_live_claim_mutations (
    claim_id, workspace_id, plan_id, mutation_key, action, outcome, result_json
  )
  values (v_claim.id, p_workspace_id, p_plan_id, v_key, 'consume', v_reason, v_result);

  if v_consumed then
    perform public.record_customer_activation_milestone(
      p_workspace_id,
      'free_live_claim_consumed',
      now(),
      null
    );
    perform public.record_customer_activation_milestone(
      p_workspace_id,
      'first_campaign_live',
      now(),
      null
    );
  end if;

  return query select v_consumed, v_reason, v_claim.id, v_claim.status, v_key;
end;
$$;

create or replace function public.release_meta_free_live_claim(
  p_workspace_id uuid,
  p_meta_business_id text,
  p_meta_ad_account_id text,
  p_plan_id uuid,
  p_reservation_key text,
  p_mutation_key text
)
returns table (
  released boolean,
  reason text,
  claim_id uuid,
  status text,
  mutation_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id text := lower(btrim(p_meta_business_id));
  v_account_id text := lower(regexp_replace(btrim(p_meta_ad_account_id), '^act_', '', 'i'));
  v_reservation_key text := btrim(p_reservation_key);
  v_key text := btrim(p_mutation_key);
  v_claim public.meta_free_live_claims;
  v_existing public.meta_free_live_claim_mutations;
  v_released boolean;
  v_reason text;
  v_result jsonb;
begin
  if v_business_id = '' or v_account_id = '' or v_reservation_key = '' or v_key = '' then
    raise exception 'Meta identity, reservation key, and mutation key are required';
  end if;

  select m.* into v_existing
  from public.meta_free_live_claim_mutations m
  where m.action = 'release' and m.mutation_key = v_key;

  if found then
    return query select
      (v_existing.result_json->>'released')::boolean,
      v_existing.result_json->>'reason',
      (v_existing.result_json->>'claimId')::uuid,
      v_existing.result_json->>'status',
      v_key;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_business_id || ':' || v_account_id, 0));

  select m.* into v_existing
  from public.meta_free_live_claim_mutations m
  where m.action = 'release' and m.mutation_key = v_key;
  if found then
    return query select
      (v_existing.result_json->>'released')::boolean,
      v_existing.result_json->>'reason',
      (v_existing.result_json->>'claimId')::uuid,
      v_existing.result_json->>'status',
      v_key;
    return;
  end if;

  select c.* into v_claim
  from public.meta_free_live_claims c
  where c.meta_business_id = v_business_id and c.meta_ad_account_id = v_account_id
  for update;

  if not found then
    raise exception 'Free-live claim does not exist';
  end if;

  if v_claim.status = 'reserved'
    and v_claim.reservation_key = v_reservation_key
    and v_claim.reserved_workspace_id = p_workspace_id
    and v_claim.reserved_plan_id = p_plan_id
  then
    update public.meta_free_live_claims
    set status = 'available',
        reservation_key = null,
        reserved_workspace_id = null,
        reserved_plan_id = null,
        reserved_at = null,
        updated_at = now()
    where id = v_claim.id
    returning * into v_claim;
    v_released := true;
    v_reason := 'released';
  else
    v_released := false;
    v_reason := case when v_claim.status = 'consumed' then 'already_consumed' else 'reservation_mismatch' end;
  end if;

  v_result := jsonb_build_object(
    'released', v_released,
    'reason', v_reason,
    'claimId', v_claim.id,
    'status', v_claim.status
  );
  insert into public.meta_free_live_claim_mutations (
    claim_id, workspace_id, plan_id, mutation_key, action, outcome, result_json
  )
  values (v_claim.id, p_workspace_id, p_plan_id, v_key, 'release', v_reason, v_result);

  return query select v_released, v_reason, v_claim.id, v_claim.status, v_key;
end;
$$;

revoke all on function public.reserve_meta_free_live_claim(uuid, text, text, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.consume_meta_free_live_claim(uuid, text, text, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.release_meta_free_live_claim(uuid, text, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_meta_free_live_claim(uuid, text, text, uuid, text, text)
  to service_role;
grant execute on function public.consume_meta_free_live_claim(uuid, text, text, uuid, text, text)
  to service_role;
grant execute on function public.release_meta_free_live_claim(uuid, text, text, uuid, text, text)
  to service_role;
