-- Trial workspaces begin only after Supabase confirms the email. This replaces
-- the legacy auth.users INSERT trigger without deleting any existing workspace.

drop trigger if exists on_trial_self_serve_signup on auth.users;

create or replace function public.handle_trial_self_serve_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Rolling-deployment compatibility: retained because older migration history
  -- names this function, but workspace creation now belongs exclusively to
  -- bootstrap_verified_trial_workspace after verification.
  return new;
end;
$$;

revoke all on function public.handle_trial_self_serve_signup()
  from public, anon, authenticated;

drop trigger if exists provision_workspace_activation_foundation on public.workspaces;

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
    on conflict (workspace_id) do nothing;

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
      v_trial_started_at := greatest(coalesce(v_trial_started_at, v_verified_at), v_verified_at);
      v_trial_ends_at := greatest(
        coalesce(v_trial_ends_at, v_trial_started_at + interval '7 days'),
        v_trial_started_at + interval '7 days'
      );
      update public.workspaces
      set trial_started_at = v_trial_started_at,
          trial_ends_at = v_trial_ends_at,
          updated_at = now()
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
        jsonb_build_object('verifiedUserId', p_verified_user_id)
      );
    end if;

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
  v_trial_started_at := v_verified_at;
  v_trial_ends_at := v_trial_started_at + interval '7 days';

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
    v_workspace_name,
    'self_serve',
    v_trial_plan_id,
    'AU',
    v_trial_started_at,
    v_trial_ends_at,
    'not_started',
    p_verified_user_id
  )
  returning id into v_workspace_id;

  insert into public.workspace_members (workspace_id, profile_id, role)
  values (v_workspace_id, p_verified_user_id, 'owner')
  on conflict (workspace_id, profile_id) do nothing;

  insert into public.customer_activations (workspace_id)
  values (v_workspace_id)
  on conflict (workspace_id) do nothing;

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
    v_trial_started_at,
    v_trial_ends_at,
    'trial-grant:' || v_workspace_id::text,
    'verified_workspace_bootstrap',
    jsonb_build_object('verifiedUserId', p_verified_user_id)
  );

  workspace_id := v_workspace_id;
  created := true;
  resumed := false;
  eligible := true;
  trial_ends_at := v_trial_ends_at;
  return next;
end;
$$;

revoke all on function public.bootstrap_verified_trial_workspace(uuid)
  from public, anon, authenticated;
grant execute on function public.bootstrap_verified_trial_workspace(uuid)
  to service_role;

comment on function public.bootstrap_verified_trial_workspace(uuid) is
  'Idempotently creates or resumes one self-serve trial workspace after authoritative email verification.';
