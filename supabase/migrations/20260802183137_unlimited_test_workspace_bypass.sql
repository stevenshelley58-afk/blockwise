begin;

-- Internal, service-owned exceptions for development accounts. This table is
-- deliberately outside the public schema API and is only consulted by
-- security-definer/server-owned entitlement functions.
create table if not exists private.unlimited_test_workspaces (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  account_email text not null,
  reason text not null default 'development_test_account',
  created_at timestamptz not null default now()
);

revoke all on private.unlimited_test_workspaces from public, anon, authenticated;
grant all on private.unlimited_test_workspaces to service_role;

create or replace function private.is_unlimited_test_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.unlimited_test_workspaces t
    where t.workspace_id = target_workspace_id
  );
$$;

revoke all on function private.is_unlimited_test_workspace(uuid)
  from public, anon, authenticated;
grant execute on function private.is_unlimited_test_workspace(uuid)
  to service_role;

-- Keep the production claim implementation intact for ordinary workspaces.
-- Test workspaces get an idempotent no-op claim so they can publish without
-- consuming or colliding with the global one-free-campaign entitlement.
do $$
begin
  if to_regprocedure('public.reserve_meta_free_live_claim(uuid,text,text,uuid,text,text)') is not null
     and to_regprocedure('public.reserve_meta_free_live_claim_base(uuid,text,text,uuid,text,text)') is null then
    alter function public.reserve_meta_free_live_claim(uuid, text, text, uuid, text, text)
      rename to reserve_meta_free_live_claim_base;
  end if;
  if to_regprocedure('public.consume_meta_free_live_claim(uuid,text,text,uuid,text,text)') is not null
     and to_regprocedure('public.consume_meta_free_live_claim_base(uuid,text,text,uuid,text,text)') is null then
    alter function public.consume_meta_free_live_claim(uuid, text, text, uuid, text, text)
      rename to consume_meta_free_live_claim_base;
  end if;
  if to_regprocedure('public.release_meta_free_live_claim(uuid,text,text,uuid,text,text)') is not null
     and to_regprocedure('public.release_meta_free_live_claim_base(uuid,text,text,uuid,text,text)') is null then
    alter function public.release_meta_free_live_claim(uuid, text, text, uuid, text, text)
      rename to release_meta_free_live_claim_base;
  end if;
end;
$$;

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
  v_result jsonb;
begin
  if not private.is_unlimited_test_workspace(p_workspace_id) then
    return query select * from public.reserve_meta_free_live_claim_base(
      p_workspace_id, p_meta_business_id, p_meta_ad_account_id, p_plan_id,
      p_reservation_key, p_mutation_key
    );
    return;
  end if;

  if v_business_id = '' or v_account_id = '' or v_reservation_key = '' or v_key = ''
     or p_workspace_id is null or p_plan_id is null then
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

  insert into public.meta_free_live_claims (meta_business_id, meta_ad_account_id)
  values (v_business_id, v_account_id)
  on conflict (meta_business_id, meta_ad_account_id) do nothing;

  select c.* into v_claim
  from public.meta_free_live_claims c
  where c.meta_business_id = v_business_id and c.meta_ad_account_id = v_account_id
  for update;

  v_result := jsonb_build_object(
    'allowed', true,
    'reason', 'test_account_bypass',
    'claimId', v_claim.id,
    'status', v_claim.status
  );

  insert into public.meta_free_live_claim_mutations (
    claim_id, workspace_id, plan_id, mutation_key, action, outcome, result_json
  )
  values (v_claim.id, p_workspace_id, p_plan_id, v_key, 'reserve', 'test_account_bypass', v_result);

  return query select true, 'test_account_bypass'::text, v_claim.id, v_claim.status, v_key;
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
  v_key text := btrim(p_mutation_key);
  v_claim public.meta_free_live_claims;
  v_existing public.meta_free_live_claim_mutations;
  v_result jsonb;
begin
  if not private.is_unlimited_test_workspace(p_workspace_id) then
    return query select * from public.consume_meta_free_live_claim_base(
      p_workspace_id, p_meta_business_id, p_meta_ad_account_id, p_plan_id,
      p_reservation_key, p_mutation_key
    );
    return;
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
  insert into public.meta_free_live_claims (meta_business_id, meta_ad_account_id)
  values (v_business_id, v_account_id)
  on conflict (meta_business_id, meta_ad_account_id) do nothing;

  select c.* into v_claim
  from public.meta_free_live_claims c
  where c.meta_business_id = v_business_id and c.meta_ad_account_id = v_account_id
  for update;

  v_result := jsonb_build_object(
    'consumed', true,
    'reason', 'test_account_bypass',
    'claimId', v_claim.id,
    'status', v_claim.status
  );
  insert into public.meta_free_live_claim_mutations (
    claim_id, workspace_id, plan_id, mutation_key, action, outcome, result_json
  )
  values (v_claim.id, p_workspace_id, p_plan_id, v_key, 'consume', 'test_account_bypass', v_result);

  return query select true, 'test_account_bypass'::text, v_claim.id, v_claim.status, v_key;
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
  v_key text := btrim(p_mutation_key);
  v_claim public.meta_free_live_claims;
  v_existing public.meta_free_live_claim_mutations;
  v_result jsonb;
begin
  if not private.is_unlimited_test_workspace(p_workspace_id) then
    return query select * from public.release_meta_free_live_claim_base(
      p_workspace_id, p_meta_business_id, p_meta_ad_account_id, p_plan_id,
      p_reservation_key, p_mutation_key
    );
    return;
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
  insert into public.meta_free_live_claims (meta_business_id, meta_ad_account_id)
  values (v_business_id, v_account_id)
  on conflict (meta_business_id, meta_ad_account_id) do nothing;

  select c.* into v_claim
  from public.meta_free_live_claims c
  where c.meta_business_id = v_business_id and c.meta_ad_account_id = v_account_id
  for update;

  v_result := jsonb_build_object(
    'released', true,
    'reason', 'test_account_bypass',
    'claimId', v_claim.id,
    'status', v_claim.status
  );
  insert into public.meta_free_live_claim_mutations (
    claim_id, workspace_id, plan_id, mutation_key, action, outcome, result_json
  )
  values (v_claim.id, p_workspace_id, p_plan_id, v_key, 'release', 'test_account_bypass', v_result);

  return query select true, 'test_account_bypass'::text, v_claim.id, v_claim.status, v_key;
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

commit;
