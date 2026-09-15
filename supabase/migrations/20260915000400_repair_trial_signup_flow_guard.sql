-- Repair the ad-studio trial signup gate on databases that predate the rename.
--
-- WHY THIS EXISTS
--
-- The Ad studio rename rewrote migration files in place: the committed body of
-- 202606040004_self_serve_trial.sql and 20260727029000_verified_trial_workspace_bootstrap.sql
-- already spells the signup flow "trial_ad_studio", and 20260915000200 renamed
-- the trigger and its function with ALTER ... RENAME. ALTER RENAME moves object
-- names. It does not rewrite string literals inside a function body.
--
-- A database that predates the rename therefore still holds the old literal.
-- Verified on the live product database:
--
--   select pg_get_functiondef(oid) from pg_proc
--   where proname = 'bootstrap_verified_trial_workspace';
--   ->  if v_signup_flow <> 'trial_self_serve' then
--
-- while the application sends signup_flow = 'trial_ad_studio'
-- (src/components/signup-form.tsx). The guard therefore never matches, the RPC
-- returns eligible = false with no workspace, and the customer completes email
-- verification, receives a profile row, and lands in the studio with no
-- workspace at all. The trial cannot start and Checkout can never be reached.
--
-- The migrations that define this function are already in the ledger, so they
-- will never run again; no existing migration repairs the literal. This is a
-- forward migration by the repository's own rule for renames: an applied
-- filename is a frozen ledger key, so the repair ships as a new file.
--
-- The body below is copied verbatim from 20260906010000_no_card_trial_delivery_start.sql,
-- which is the repository's authoritative definition. Nothing else is changed,
-- so applying this is a no-op on any database already carrying the new literal.

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
  'Idempotently creates or resumes one ad-studio trial workspace after authoritative email verification. The 14-day trial starts later, on first Meta-reported delivery.';

-- Expose the trial state machine to the existing trial status reader.
drop function if exists public.get_trial_status(uuid);
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

-- Fail loudly rather than leaving the gate half-repaired.
do $$
declare
  body text;
  status_reader integer;
begin
  select pg_get_functiondef(p.oid) into body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'bootstrap_verified_trial_workspace';

  if body is null then
    raise exception 'bootstrap_verified_trial_workspace is missing after the repair';
  end if;
  if body like '%trial_self_serve%' then
    raise exception 'bootstrap_verified_trial_workspace still gates on the pre-rename signup_flow value';
  end if;
  if body not like '%trial_ad_studio%' then
    raise exception 'bootstrap_verified_trial_workspace does not gate on trial_ad_studio';
  end if;

  -- The first revision of this migration copied the source body up to the
  -- `drop function ... get_trial_status` and stopped, which silently removed the
  -- trial status reader. Assert the reader survived.
  select count(*) into status_reader
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_trial_status';

  if status_reader = 0 then
    raise exception 'get_trial_status was dropped by this migration and not restored';
  end if;
end
$$;
