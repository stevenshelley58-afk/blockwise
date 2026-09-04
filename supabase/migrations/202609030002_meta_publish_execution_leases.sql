-- Serialize provider execution per publish plan and give activation retries a
-- durable client key. This is an additive expand migration; older app/worker
-- revisions continue to operate while the new release rolls out.
begin;

alter table public.meta_publish_plans
  add column if not exists execution_lease_token uuid,
  add column if not exists execution_lease_expires_at timestamptz;

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

commit;
