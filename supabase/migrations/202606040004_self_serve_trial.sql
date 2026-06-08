insert into public.workspace_plans (key, name, monthly_ai_budget_cents, max_workspaces, max_agent_runs_per_month)
values ('trial', 'Free Trial', 0, 1, 0)
on conflict (key) do update set
  name = excluded.name,
  monthly_ai_budget_cents = excluded.monthly_ai_budget_cents,
  max_workspaces = excluded.max_workspaces,
  max_agent_runs_per_month = excluded.max_agent_runs_per_month;

alter table public.workspaces
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists onboarding_status text not null default 'complete';

update public.workspaces
set onboarding_status = 'complete'
where onboarding_status is null;

alter table public.workspaces
  alter column onboarding_status set default 'complete',
  alter column onboarding_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workspaces_onboarding_status_check'
      and conrelid = 'public.workspaces'::regclass
  ) then
    alter table public.workspaces
      add constraint workspaces_onboarding_status_check
      check (onboarding_status in ('not_started', 'fast_path', 'full_setup', 'complete'));
  end if;
end $$;

create or replace function public.handle_trial_self_serve_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_name text;
  v_trial_plan_id uuid;
  v_workspace_id uuid;
  v_trial_started_at timestamptz := now();
  v_trial_ends_at timestamptz := v_trial_started_at + interval '7 days';
begin
  if coalesce(new.raw_user_meta_data->>'signup_flow', '') <> 'trial_self_serve' then
    return new;
  end if;

  v_agency_name := left(
    regexp_replace(btrim(coalesce(new.raw_user_meta_data->>'agency_name', '')), '\s+', ' ', 'g'),
    160
  );

  if v_agency_name = '' then
    v_agency_name := 'My agency';
  end if;

  select id
  into v_trial_plan_id
  from public.workspace_plans
  where key = 'trial'
  limit 1;

  if v_trial_plan_id is null then
    raise exception 'Trial workspace plan is missing';
  end if;

  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;

  insert into public.workspaces (
    name,
    mode,
    plan_id,
    region,
    trial_started_at,
    trial_ends_at,
    onboarding_status,
    created_by
  )
  values (
    v_agency_name,
    'self_serve',
    v_trial_plan_id,
    'AU',
    v_trial_started_at,
    v_trial_ends_at,
    'not_started',
    new.id
  )
  returning id into v_workspace_id;

  insert into public.workspace_members (workspace_id, profile_id, role)
  values (v_workspace_id, new.id, 'owner')
  on conflict (workspace_id, profile_id) do nothing;

  insert into public.rate_limits (
    workspace_id,
    subject_key,
    bucket,
    limit_count,
    used_count,
    resets_at
  )
  values (
    v_workspace_id,
    'ad_pack_generation',
    'trial',
    10,
    0,
    v_trial_ends_at
  )
  on conflict (workspace_id, subject_key, bucket) do nothing;

  return new;
end;
$$;

drop trigger if exists on_trial_self_serve_signup on auth.users;
create trigger on_trial_self_serve_signup
  after insert on auth.users
  for each row execute function public.handle_trial_self_serve_signup();

revoke all on function public.handle_trial_self_serve_signup() from public, anon, authenticated;

drop policy if exists workspace_insert on public.rate_limits;
drop policy if exists workspace_update on public.rate_limits;
drop policy if exists workspace_delete on public.rate_limits;
drop policy if exists rate_limits_server_owned_no_client_insert on public.rate_limits;
drop policy if exists rate_limits_server_owned_no_client_update on public.rate_limits;
drop policy if exists rate_limits_server_owned_no_client_delete on public.rate_limits;

create policy rate_limits_server_owned_no_client_insert
  on public.rate_limits for insert to authenticated
  with check (false);

create policy rate_limits_server_owned_no_client_update
  on public.rate_limits for update to authenticated
  using (false)
  with check (false);

create policy rate_limits_server_owned_no_client_delete
  on public.rate_limits for delete to authenticated
  using (false);

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
set search_path = public
as $$
declare
  v_plan_key text;
  v_trial_ends_at timestamptz;
  v_rate_limit_id uuid;
  v_used_count integer := 0;
  v_limit_count integer := 0;
begin
  select wp.key, w.trial_ends_at
  into v_plan_key, v_trial_ends_at
  from public.workspaces w
  left join public.workspace_plans wp on wp.id = w.plan_id
  where w.id = $1;

  select rl.used_count, rl.limit_count
  into v_used_count, v_limit_count
  from public.rate_limits rl
  where rl.workspace_id = $1
    and rl.subject_key = 'ad_pack_generation'
    and rl.bucket = 'trial';

  v_used_count := coalesce(v_used_count, 0);
  v_limit_count := coalesce(v_limit_count, 0);

  if v_plan_key is distinct from 'trial' then
    allowed := true;
    reason := 'not_trial';
    used_count := v_used_count;
    limit_count := v_limit_count;
    trial_ends_at := v_trial_ends_at;
    return next;
    return;
  end if;

  if v_trial_ends_at is null or v_trial_ends_at <= now() then
    allowed := false;
    reason := 'trial_expired';
    used_count := v_used_count;
    limit_count := v_limit_count;
    trial_ends_at := v_trial_ends_at;
    return next;
    return;
  end if;

  update public.rate_limits rl
  set used_count = rl.used_count + 1
  where rl.workspace_id = $1
    and rl.subject_key = 'ad_pack_generation'
    and rl.bucket = 'trial'
    and rl.used_count < rl.limit_count
  returning rl.id, rl.used_count, rl.limit_count
  into v_rate_limit_id, v_used_count, v_limit_count;

  if v_rate_limit_id is null then
    select rl.used_count, rl.limit_count
    into v_used_count, v_limit_count
    from public.rate_limits rl
    where rl.workspace_id = $1
      and rl.subject_key = 'ad_pack_generation'
      and rl.bucket = 'trial';

    allowed := false;
    reason := 'credit_limit_reached';
    used_count := coalesce(v_used_count, 0);
    limit_count := coalesce(v_limit_count, 0);
    trial_ends_at := v_trial_ends_at;
    return next;
    return;
  end if;

  insert into public.audit_logs (
    workspace_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    $1,
    $2,
    'trial.ad_pack_credit_reserved',
    'rate_limits',
    v_rate_limit_id,
    jsonb_build_object(
      'subject_key', 'ad_pack_generation',
      'bucket', 'trial',
      'used_count', v_used_count,
      'limit_count', v_limit_count
    )
  );

  allowed := true;
  reason := 'reserved';
  used_count := v_used_count;
  limit_count := v_limit_count;
  trial_ends_at := v_trial_ends_at;
  return next;
end;
$$;

revoke all on function public.reserve_trial_ad_pack_credit(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_trial_ad_pack_credit(uuid, uuid) to service_role;

create or replace function public.refund_trial_ad_pack_credit(target_workspace_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.rate_limits
  set used_count = greatest(used_count - 1, 0)
  where workspace_id = target_workspace_id
    and subject_key = 'ad_pack_generation'
    and bucket = 'trial';
$$;

revoke all on function public.refund_trial_ad_pack_credit(uuid) from public, anon, authenticated;
grant execute on function public.refund_trial_ad_pack_credit(uuid) to service_role;

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
set search_path = public
as $$
  select
    wp.key as plan_key,
    w.trial_ends_at,
    coalesce(rl.used_count, 0)::integer as ad_packs_used,
    coalesce(rl.limit_count, 0)::integer as ad_packs_limit,
    greatest(coalesce(rl.limit_count, 0) - coalesce(rl.used_count, 0), 0)::integer as ad_packs_remaining,
    case
      when w.trial_ends_at is null then 0
      else greatest(ceil(extract(epoch from (w.trial_ends_at - now())) / 86400.0)::integer, 0)
    end as trial_days_remaining,
    coalesce(wp.key = 'trial' and (w.trial_ends_at is null or w.trial_ends_at <= now()), false) as trial_expired
  from public.workspaces w
  left join public.workspace_plans wp on wp.id = w.plan_id
  left join public.rate_limits rl
    on rl.workspace_id = w.id
   and rl.subject_key = 'ad_pack_generation'
   and rl.bucket = 'trial'
  where w.id = target_workspace_id
    and (public.is_operator() or public.is_workspace_member(w.id));
$$;

revoke all on function public.get_trial_status(uuid) from public, anon;
grant execute on function public.get_trial_status(uuid) to authenticated;
