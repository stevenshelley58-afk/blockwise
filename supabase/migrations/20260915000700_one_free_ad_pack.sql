-- Grant one free ad pack instead of three.
--
-- WHY THIS EXISTS
--
-- The free trial offer is one ad pack: one Feed ad and one Story ad, which is
-- two renders. The two functions that grant the trial wallet still pass the
-- literal 6 (three packs of two renders) to grant_workspace_credits at three
-- call sites. Those bodies live in migrations that are already in the ledger
-- and will never run again, so the change ships as a new file, by the
-- repository's rule that an applied filename is a frozen ledger key.
--
-- The two bodies below are copied verbatim from their current authoritative
-- definitions and differ from them only in the grant:
--
--   bootstrap_verified_trial_workspace  from 20260915000400 (two call sites)
--   start_trial_on_first_delivery       from 20260906010000 (one call site)
--
-- 20260915000500 and 20260915000600 rewrote literals inside stored bodies
-- (self_serve -> ad_studio, and the workspace access helper) without changing
-- either function's logic, and both repository texts already carry the new
-- vocabulary, so re-creating from the repository text is a no-op for them.
--
-- The application constant FREE_TRIAL_RENDER_LIMIT (src/lib/trial/trial-status.ts)
-- must equal the grant below. normalizeTrialStatus rejects any other value.
--
-- Wallets already granted with 6 are not touched: a customer who was promised
-- three packs keeps them.

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

  -- Only ad-studio trial-plan workspaces participate in the no-card trial.
  update public.workspaces w
  set trial_started_at = p_delivery_at,
      trial_ends_at = p_delivery_at + interval '14 days',
      trial_state = 'active',
      updated_at = now()
  from public.workspace_plans wp
  where w.id = p_workspace_id
    and wp.id = w.plan_id
    and wp.key = 'trial'
    and w.mode = 'ad_studio'
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
      2,
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
    and w.mode = 'ad_studio'
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
        2,
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
  if v_signup_flow <> 'trial_ad_studio' then
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
    'ad_studio',
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
    2,
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
  'Idempotently creates or resumes one ad-studio trial workspace after authoritative email verification. The 14-day trial starts later, on first Meta-reported delivery.';

-- Fail loudly rather than leaving one function on the old grant.
do $$
declare
  r record;
  body text;
  checked integer := 0;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('bootstrap_verified_trial_workspace', 'start_trial_on_first_delivery')
  loop
    body := pg_get_functiondef(r.oid);
    -- The grant amount is the only bare integer argument on a line of its own
    -- in either body, so a line reading "6," is the old grant.
    if body ~ '\n\s*6,\n' then
      raise exception '% still grants six trial renders', r.proname;
    end if;
    if body !~ '\n\s*2,\n' then
      raise exception '% does not grant two trial renders', r.proname;
    end if;
    checked := checked + 1;
  end loop;

  if checked <> 2 then
    raise exception 'expected both trial grant functions, found %', checked;
  end if;
end
$$;
