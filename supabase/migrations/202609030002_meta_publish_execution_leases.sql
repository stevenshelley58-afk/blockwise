-- Serialize provider execution per publish plan and give activation retries a
-- durable client key. This is an additive expand migration; older app/worker
-- revisions continue to operate while the new release rolls out.
begin;

alter table public.meta_publish_plans
  add column if not exists execution_lease_token uuid,
  add column if not exists execution_lease_expires_at timestamptz,
  add column if not exists publication_snapshot_id uuid references public.ad_publication_snapshots(id) on delete set null;

create index if not exists meta_publish_plans_execution_lease_idx
  on public.meta_publish_plans (workspace_id, execution_lease_expires_at)
  where execution_lease_token is not null;

alter table public.meta_publish_plan_mutations
  add column if not exists client_mutation_key text,
  add column if not exists outcome_status text
    check (outcome_status is null or outcome_status in ('confirmed_paused', 'unconfirmed')),
  add column if not exists unconfirmed_pause_ids_json jsonb not null default '[]'::jsonb;
create unique index if not exists meta_publish_plan_mutations_activation_key_idx
  on public.meta_publish_plan_mutations (workspace_id, meta_publish_plan_id, action, client_mutation_key)
  where action = 'activate' and client_mutation_key is not null;

create or replace function public.claim_meta_publish_execution(p_workspace_id uuid, p_plan_id uuid, p_lease_seconds integer default 600)
returns table(claimed boolean, lease_token uuid, lease_expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v_token uuid; v_expiry timestamptz;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  if not exists (select 1 from public.meta_publish_plans where workspace_id = p_workspace_id and id = p_plan_id) then
    raise exception 'Meta publish plan was not found for this workspace';
  end if;
  v_token := gen_random_uuid();
  v_expiry := now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 600), 3600)));
  update public.meta_publish_plans set execution_lease_token = v_token, execution_lease_expires_at = v_expiry
   where workspace_id = p_workspace_id and id = p_plan_id
     and (execution_lease_token is null or execution_lease_expires_at <= pg_catalog.now());
  if found then return query select true, v_token, v_expiry; else return query select false, null::uuid, null::timestamptz; end if;
end $$;

create or replace function public.renew_meta_publish_execution(p_workspace_id uuid, p_plan_id uuid, p_lease_token uuid, p_lease_seconds integer default 600)
returns boolean language sql security definer set search_path = '' as $$
  update public.meta_publish_plans set execution_lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 600), 3600)))
   where workspace_id = p_workspace_id and id = p_plan_id and execution_lease_token = p_lease_token and execution_lease_expires_at > pg_catalog.now()
  returning true;
$$;

create or replace function public.release_meta_publish_execution(p_workspace_id uuid, p_plan_id uuid, p_lease_token uuid)
returns boolean language sql security definer set search_path = '' as $$
  update public.meta_publish_plans set execution_lease_token = null, execution_lease_expires_at = null
   where workspace_id = p_workspace_id and id = p_plan_id and execution_lease_token = p_lease_token
  returning true;
$$;

revoke all on function public.claim_meta_publish_execution(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.renew_meta_publish_execution(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_meta_publish_execution(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_meta_publish_execution(uuid, uuid, integer) to service_role;
grant execute on function public.renew_meta_publish_execution(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.release_meta_publish_execution(uuid, uuid, uuid) to service_role;

-- Atomically create/recover an activation mutation and its approved approval.
-- Provider ids are deliberately derived from the server-owned plan snapshot;
-- this RPC accepts no browser-supplied target ids or payload.
create or replace function public.ensure_meta_activation_mutation(
  p_workspace_id uuid, p_plan_id uuid, p_client_mutation_key text,
  p_plan_fingerprint text, p_requested_by uuid
) returns table(mutation_id uuid, approval_request_id uuid)
language plpgsql security definer set search_path = '' as $$
declare v_plan public.meta_publish_plans%rowtype; v_mut public.meta_publish_plan_mutations%rowtype;
declare v_approval uuid; v_payload jsonb; v_target jsonb; v_mode text; v_created boolean := false;
declare v_owned_campaign_id text; v_reconciled_campaign_id text;
declare v_owned_ad_set_ids jsonb; v_owned_ad_ids jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception using errcode='42501', message='service_role_required'; end if;
  if nullif(trim(p_client_mutation_key), '') is null or nullif(trim(p_plan_fingerprint), '') is null then raise exception 'activation fencing values are required'; end if;
  select * into v_plan from public.meta_publish_plans where id=p_plan_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Meta publish plan was not found for this workspace'; end if;
  if v_plan.status <> 'paused_live' then raise exception 'Meta publish plan is not ready for activation'; end if;
  if v_plan.idempotency_key <> p_plan_fingerprint then raise exception 'plan fingerprint mismatch'; end if;
  v_target := coalesce(v_plan.plan_json #> '{controls,target}', '{}'::jsonb);
  v_mode := v_target->>'mode';
  v_owned_campaign_id := nullif(v_plan.reconciled_objects_json->>'ownedCampaignId', '');
  v_reconciled_campaign_id := nullif(v_plan.reconciled_objects_json->>'campaignId', '');
  select coalesce(pg_catalog.jsonb_agg(value order by key), '[]'::jsonb)
    into v_owned_ad_set_ids
    from pg_catalog.jsonb_each_text(coalesce(v_plan.reconciled_objects_json->'ownedAdSetIds', '{}'::jsonb));
  select coalesce(pg_catalog.jsonb_agg(value order by key), '[]'::jsonb)
    into v_owned_ad_ids
    from pg_catalog.jsonb_each_text(coalesce(v_plan.reconciled_objects_json->'ownedAdIds', '{}'::jsonb));
  if pg_catalog.jsonb_array_length(v_owned_ad_ids) = 0 then raise exception 'activation ownership could not be verified'; end if;
  v_payload := jsonb_build_object('adSetIds', v_owned_ad_set_ids, 'adIds', v_owned_ad_ids);
  if v_mode = 'new_campaign_new_adset' then
    if v_owned_campaign_id is null or v_owned_campaign_id <> v_reconciled_campaign_id then raise exception 'campaign ownership could not be verified'; end if;
    v_payload := v_payload || jsonb_build_object('campaignId', v_owned_campaign_id);
  else
    if nullif(v_target->>'campaignId', '') is null or v_target->>'campaignId' <> v_reconciled_campaign_id then raise exception 'reused campaign fencing failed'; end if;
    v_payload := v_payload || jsonb_build_object('reusedCampaignId', v_target->>'campaignId');
    if v_mode = 'existing_adset' then
      v_payload := v_payload || jsonb_build_object('reusedAdSetIds', coalesce(v_target->'adSetIds', '[]'::jsonb));
    end if;
  end if;
  select * into v_mut from public.meta_publish_plan_mutations where workspace_id=p_workspace_id and meta_publish_plan_id=p_plan_id and action='activate' and client_mutation_key=p_client_mutation_key for update;
  if not found then
    begin
      insert into public.meta_publish_plan_mutations(workspace_id,meta_publish_plan_id,action,status,payload_json,requested_by,client_mutation_key)
        values(p_workspace_id,p_plan_id,'activate','approved',v_payload,p_requested_by,p_client_mutation_key) returning * into v_mut;
      v_created := true;
    exception when unique_violation then
      select * into v_mut from public.meta_publish_plan_mutations where workspace_id=p_workspace_id and meta_publish_plan_id=p_plan_id and action='activate' and client_mutation_key=p_client_mutation_key for update;
      if not found then raise; end if;
    end;
  elsif v_mut.payload_json <> v_payload then raise exception 'activation payload mismatch';
  end if;
  select id into v_approval from public.approval_requests where workspace_id=p_workspace_id and target_type='meta_publish_plan_mutation' and target_id=v_mut.id and status='approved' order by created_at desc limit 1 for update;
  if v_approval is null then
    insert into public.approval_requests(workspace_id,target_type,target_id,status,requested_by,approved_by,resolved_at,risk_summary)
      values(p_workspace_id,'meta_publish_plan_mutation',v_mut.id,'approved',p_requested_by,p_requested_by,pg_catalog.now(),'Meta activation') returning id into v_approval;
  end if;
  update public.meta_publish_plan_mutations set approval_request_id=v_approval, status='approved', updated_at=pg_catalog.now() where id=v_mut.id;
  if v_created then
    insert into public.audit_logs(workspace_id,actor_profile_id,action,target_type,target_id,metadata)
      values(p_workspace_id,p_requested_by,'meta.activate_requested','meta_publish_plan_mutation',v_mut.id,
        jsonb_build_object('planId',p_plan_id,'clientMutationKey',p_client_mutation_key,'planFingerprint',p_plan_fingerprint));
  end if;
  return query select v_mut.id,v_approval;
end $$;
revoke all on function public.ensure_meta_activation_mutation(uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.ensure_meta_activation_mutation(uuid,uuid,text,text,uuid) to service_role;

-- Provider outcome and its audit record are one durable transaction. The
-- worker may report success only after this RPC commits both records.
create or replace function public.finalize_meta_publish_plan_mutation(
  p_workspace_id uuid, p_mutation_id uuid, p_status text,
  p_request_log jsonb, p_response_log jsonb, p_last_error text,
  p_outcome_status text default null, p_unconfirmed_pause_ids jsonb default '[]'::jsonb
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_mut public.meta_publish_plan_mutations%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception using errcode='42501', message='service_role_required'; end if;
  if p_status not in ('applied','failed') then raise exception 'invalid mutation final status'; end if;
  if p_outcome_status is not null and p_outcome_status not in ('confirmed_paused','unconfirmed') then raise exception 'invalid mutation outcome status'; end if;
  if pg_catalog.jsonb_typeof(coalesce(p_request_log,'[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(p_response_log,'[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(p_unconfirmed_pause_ids,'[]'::jsonb)) <> 'array'
  then raise exception 'mutation logs and unconfirmed ids must be arrays'; end if;
  select * into v_mut from public.meta_publish_plan_mutations where workspace_id=p_workspace_id and id=p_mutation_id for update;
  if not found then raise exception 'Meta mutation was not found for this workspace'; end if;
  -- Final outcomes are monotonic. A late executor whose lease expired must
  -- never overwrite a quarantine (and a quarantine racing a completed
  -- executor must never overwrite its durable provider result). Exact retries
  -- remain idempotent.
  if v_mut.status in ('applied','failed') then
    return v_mut.status = p_status
      and v_mut.outcome_status is not distinct from p_outcome_status
      and v_mut.unconfirmed_pause_ids_json = coalesce(p_unconfirmed_pause_ids,'[]'::jsonb);
  end if;
  if v_mut.status <> 'applying' then raise exception 'Meta mutation is not applying'; end if;
  update public.meta_publish_plan_mutations set
    status=p_status,
    request_log_json=coalesce(p_request_log,'[]'::jsonb),
    response_log_json=coalesce(p_response_log,'[]'::jsonb),
    last_error=p_last_error,
    outcome_status=p_outcome_status,
    unconfirmed_pause_ids_json=coalesce(p_unconfirmed_pause_ids,'[]'::jsonb),
    updated_at=pg_catalog.now()
    where workspace_id=p_workspace_id and id=p_mutation_id;
  if not exists (
    select 1 from public.audit_logs
      where workspace_id=p_workspace_id and target_type='meta_publish_plan_mutation' and target_id=p_mutation_id
        and action='meta.' || v_mut.action and metadata->>'status'=p_status
  ) then
    insert into public.audit_logs(workspace_id,actor_profile_id,action,target_type,target_id,metadata)
      values(p_workspace_id,v_mut.requested_by,'meta.' || v_mut.action,'meta_publish_plan_mutation',p_mutation_id,
        jsonb_build_object('planId',v_mut.meta_publish_plan_id,'status',p_status,'lastError',p_last_error,'outcomeStatus',p_outcome_status));
  end if;
  return true;
end $$;
revoke all on function public.finalize_meta_publish_plan_mutation(uuid,uuid,text,jsonb,jsonb,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.finalize_meta_publish_plan_mutation(uuid,uuid,text,jsonb,jsonb,text,text,jsonb) to service_role;

commit;
