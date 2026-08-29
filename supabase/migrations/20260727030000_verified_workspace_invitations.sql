begin;

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  email_normalized text not null,
  role text not null check (role in ('admin', 'member', 'viewer')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'cancelled', 'expired')),
  invited_by uuid not null references public.profiles (id),
  accepted_by uuid references public.profiles (id),
  accepted_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  provider_user_id uuid,
  send_attempt_count integer not null default 0 check (send_attempt_count >= 0),
  last_sent_at timestamptz,
  last_send_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_invitations_normalized_email_check
    check (
      email_normalized = lower(btrim(email))
      and email_normalized <> ''
    ),
  constraint workspace_invitations_terminal_state_check
    check (
      (status = 'accepted' and accepted_by is not null and accepted_at is not null)
      or (status = 'cancelled' and cancelled_at is not null)
      or status in ('pending', 'expired')
    )
);

create unique index workspace_invitations_one_pending_email_idx
  on public.workspace_invitations (workspace_id, email_normalized)
  where status = 'pending';

create index workspace_invitations_workspace_status_expiry_idx
  on public.workspace_invitations (workspace_id, status, expires_at);

create index workspace_invitations_email_status_idx
  on public.workspace_invitations (email_normalized, status, expires_at);

alter table public.workspace_invitations enable row level security;

create policy workspace_invitations_select_managers
  on public.workspace_invitations
  for select
  to authenticated
  using (
    public.is_operator()
    or private.has_workspace_role(workspace_id, array['owner', 'admin', 'operator'])
  );

-- Membership creation is server-owned. This removes the legacy client INSERT
-- path while retaining owner/admin role changes and removals.
drop policy if exists workspace_members_admin_write on public.workspace_members;

drop function if exists public.allocate_paid_workspace_member_seat(uuid, uuid, text, uuid);

create policy workspace_members_admin_update
  on public.workspace_members
  for update
  to authenticated
  using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'operator']))
  with check (private.has_workspace_role(workspace_id, array['owner', 'admin', 'operator']));

create policy workspace_members_admin_delete
  on public.workspace_members
  for delete
  to authenticated
  using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'operator']));

create or replace function public.enforce_verified_workspace_member_seat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_named_members integer;
  v_pending_invitations integer;
  v_verified_at timestamptz;
begin
  if new.role = 'operator' then
    return new;
  end if;

  select coalesce(u.email_confirmed_at, u.confirmed_at)
  into v_verified_at
  from auth.users u
  where u.id = new.profile_id;

  if v_verified_at is null then
    raise exception 'Email verification is required before workspace membership';
  end if;

  perform 1
  from public.workspaces w
  where w.id = new.workspace_id
  for update;

  if not found then
    raise exception 'Workspace was not found';
  end if;

  select count(*)::integer
  into v_named_members
  from public.workspace_members wm
  join public.profiles p on p.id = wm.profile_id
  where wm.workspace_id = new.workspace_id
    and wm.profile_id <> new.profile_id
    and wm.role <> 'operator'
    and not p.is_operator;

  select count(*)::integer
  into v_pending_invitations
  from public.workspace_invitations wi
  where wi.workspace_id = new.workspace_id
    and wi.status = 'pending'
    and wi.expires_at > now();

  if v_named_members + v_pending_invitations >= 5 then
    raise exception 'All five named workspace seats are reserved';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_verified_workspace_member_seat
  on public.workspace_members;
create trigger enforce_verified_workspace_member_seat
  before insert on public.workspace_members
  for each row execute function public.enforce_verified_workspace_member_seat();

revoke all on function public.enforce_verified_workspace_member_seat()
  from public, anon, authenticated;

create or replace function public.reserve_verified_workspace_invitation(
  p_workspace_id uuid,
  p_email text,
  p_role text,
  p_actor_profile_id uuid
)
returns table (
  outcome text,
  invitation_id uuid,
  member_count integer,
  pending_count integer,
  seats_remaining integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_billing_state text;
  v_workspace_mode public.workspace_mode;
  v_email text;
  v_invitation_id uuid;
  v_member_count integer;
  v_pending_count integer;
begin
  v_email := lower(btrim(coalesce(p_email, '')));

  if v_email = '' or position('@' in v_email) <= 1 then
    return query select 'invalid_email'::text, null::uuid, 0, 0, 0;
    return;
  end if;

  if p_role not in ('admin', 'member', 'viewer') then
    return query select 'invalid_role'::text, null::uuid, 0, 0, 0;
    return;
  end if;

  select w.billing_access_state, w.mode
  into v_billing_state, v_workspace_mode
  from public.workspaces w
  where w.id = p_workspace_id
  for update;

  if not found then
    return query select 'workspace_not_found'::text, null::uuid, 0, 0, 0;
    return;
  end if;

  if v_workspace_mode <> 'self_serve' or v_billing_state <> 'paid' then
    return query select 'paid_plan_required'::text, null::uuid, 0, 0, 0;
    return;
  end if;

  if not (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.profile_id = p_actor_profile_id
        and wm.role = 'owner'
    )
    or exists (
      select 1
      from public.profiles p
      where p.id = p_actor_profile_id
        and p.is_operator
    )
  ) then
    return query select 'owner_required'::text, null::uuid, 0, 0, 0;
    return;
  end if;

  with expired as (
    update public.workspace_invitations wi
    set status = 'expired',
        updated_at = now()
    where wi.workspace_id = p_workspace_id
      and wi.status = 'pending'
      and wi.expires_at <= now()
    returning wi.id, wi.workspace_id
  )
  insert into public.audit_logs (
    workspace_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    metadata
  )
  select
    expired.workspace_id,
    p_actor_profile_id,
    'team.invitation_expired',
    'workspace_invitation',
    expired.id,
    jsonb_build_object('reason', 'expiry_sweep')
  from expired;

  if exists (
    select 1
    from public.workspace_members wm
    join public.profiles p on p.id = wm.profile_id
    where wm.workspace_id = p_workspace_id
      and lower(btrim(p.email)) = v_email
  ) then
    select count(*)::integer
    into v_member_count
    from public.workspace_members wm
    join public.profiles p on p.id = wm.profile_id
    where wm.workspace_id = p_workspace_id
      and wm.role <> 'operator'
      and not p.is_operator;

    select count(*)::integer
    into v_pending_count
    from public.workspace_invitations wi
    where wi.workspace_id = p_workspace_id
      and wi.status = 'pending'
      and wi.expires_at > now();

    return query
      select
        'already_member'::text,
        null::uuid,
        v_member_count,
        v_pending_count,
        greatest(0, 5 - v_member_count - v_pending_count);
    return;
  end if;

  if exists (
    select 1
    from public.profiles p
    where lower(btrim(p.email)) = v_email
      and p.is_operator
  ) then
    return query select 'invalid_member'::text, null::uuid, 0, 0, 0;
    return;
  end if;

  select wi.id
  into v_invitation_id
  from public.workspace_invitations wi
  where wi.workspace_id = p_workspace_id
    and wi.email_normalized = v_email
    and wi.status = 'pending'
    and wi.expires_at > now()
  limit 1;

  select count(*)::integer
  into v_member_count
  from public.workspace_members wm
  join public.profiles p on p.id = wm.profile_id
  where wm.workspace_id = p_workspace_id
    and wm.role <> 'operator'
    and not p.is_operator;

  select count(*)::integer
  into v_pending_count
  from public.workspace_invitations wi
  where wi.workspace_id = p_workspace_id
    and wi.status = 'pending'
    and wi.expires_at > now();

  if v_invitation_id is not null then
    return query
      select
        'already_pending'::text,
        v_invitation_id,
        v_member_count,
        v_pending_count,
        greatest(0, 5 - v_member_count - v_pending_count);
    return;
  end if;

  if v_member_count + v_pending_count >= 5 then
    return query
      select 'seat_limit_reached'::text, null::uuid, v_member_count, v_pending_count, 0;
    return;
  end if;

  insert into public.workspace_invitations (
    workspace_id,
    email,
    email_normalized,
    role,
    invited_by
  )
  values (
    p_workspace_id,
    btrim(p_email),
    v_email,
    p_role,
    p_actor_profile_id
  )
  returning id into v_invitation_id;

  insert into public.audit_logs (
    workspace_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    p_workspace_id,
    p_actor_profile_id,
    'team.invitation_reserved',
    'workspace_invitation',
    v_invitation_id,
    jsonb_build_object('role', p_role, 'expiresInDays', 7)
  );

  v_pending_count := v_pending_count + 1;
  return query
    select
      'reserved'::text,
      v_invitation_id,
      v_member_count,
      v_pending_count,
      greatest(0, 5 - v_member_count - v_pending_count);
end;
$$;

create or replace function public.cancel_workspace_invitation(
  p_workspace_id uuid,
  p_invitation_id uuid,
  p_actor_profile_id uuid,
  p_reason text default 'cancelled_by_owner'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  perform 1
  from public.workspaces w
  where w.id = p_workspace_id
  for update;

  if not found then
    return 'workspace_not_found';
  end if;

  if not (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.profile_id = p_actor_profile_id
        and wm.role = 'owner'
    )
    or exists (
      select 1
      from public.profiles p
      where p.id = p_actor_profile_id
        and p.is_operator
    )
  ) then
    return 'owner_required';
  end if;

  select wi.status
  into v_status
  from public.workspace_invitations wi
  where wi.id = p_invitation_id
    and wi.workspace_id = p_workspace_id
  for update;

  if not found then
    return 'invitation_not_found';
  end if;

  if v_status <> 'pending' then
    return v_status;
  end if;

  update public.workspace_invitations
  set status = case when expires_at <= now() then 'expired' else 'cancelled' end,
      cancelled_at = case when expires_at > now() then now() else cancelled_at end,
      updated_at = now()
  where id = p_invitation_id;

  select wi.status
  into v_status
  from public.workspace_invitations wi
  where wi.id = p_invitation_id;

  insert into public.audit_logs (
    workspace_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    p_workspace_id,
    p_actor_profile_id,
    case when v_status = 'expired'
      then 'team.invitation_expired'
      else 'team.invitation_cancelled'
    end,
    'workspace_invitation',
    p_invitation_id,
    jsonb_build_object('reason', left(coalesce(p_reason, 'cancelled_by_owner'), 160))
  );

  return v_status;
end;
$$;

create or replace function public.accept_verified_workspace_invitations(
  p_verified_user_id uuid
)
returns table (
  invitation_id uuid,
  workspace_id uuid,
  outcome text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user auth.users;
  v_email text;
  v_candidate record;
  v_invitation public.workspace_invitations;
  v_billing_state text;
  v_workspace_mode public.workspace_mode;
begin
  select u.*
  into v_user
  from auth.users u
  where u.id = p_verified_user_id;

  if not found then
    raise exception 'Verified auth user was not found';
  end if;

  if coalesce(v_user.email_confirmed_at, v_user.confirmed_at) is null then
    raise exception 'Email verification is required before accepting a workspace invitation';
  end if;

  v_email := lower(btrim(coalesce(v_user.email, '')));
  if v_email = '' then
    raise exception 'A verified email is required before accepting a workspace invitation';
  end if;

  insert into public.profiles (id, email)
  values (v_user.id, v_user.email)
  on conflict (id) do update
  set email = excluded.email,
      updated_at = now();

  for v_candidate in
    select wi.id, wi.workspace_id
    from public.workspace_invitations wi
    where wi.email_normalized = v_email
      and wi.status = 'pending'
    order by wi.workspace_id, wi.created_at, wi.id
  loop
    select w.billing_access_state, w.mode
    into v_billing_state, v_workspace_mode
    from public.workspaces w
    where w.id = v_candidate.workspace_id
    for update;

    if not found then
      continue;
    end if;

    select wi.*
    into v_invitation
    from public.workspace_invitations wi
    where wi.id = v_candidate.id
      and wi.workspace_id = v_candidate.workspace_id
      and wi.email_normalized = v_email
      and wi.status = 'pending'
    for update;

    if not found then
      continue;
    end if;

    if v_invitation.expires_at <= now() then
      update public.workspace_invitations
      set status = 'expired',
          updated_at = now()
      where id = v_invitation.id;

      insert into public.audit_logs (
        workspace_id,
        actor_profile_id,
        action,
        target_type,
        target_id,
        metadata
      )
      values (
        v_invitation.workspace_id,
        p_verified_user_id,
        'team.invitation_expired',
        'workspace_invitation',
        v_invitation.id,
        jsonb_build_object('reason', 'expired_before_acceptance')
      );

      invitation_id := v_invitation.id;
      workspace_id := v_invitation.workspace_id;
      outcome := 'expired';
      return next;
      continue;
    end if;

    if v_workspace_mode <> 'self_serve' or v_billing_state <> 'paid' then
      update public.workspace_invitations
      set status = 'cancelled',
          cancelled_at = now(),
          updated_at = now()
      where id = v_invitation.id;

      insert into public.audit_logs (
        workspace_id,
        actor_profile_id,
        action,
        target_type,
        target_id,
        metadata
      )
      values (
        v_invitation.workspace_id,
        p_verified_user_id,
        'team.invitation_cancelled',
        'workspace_invitation',
        v_invitation.id,
        jsonb_build_object('reason', 'paid_plan_inactive')
      );

      invitation_id := v_invitation.id;
      workspace_id := v_invitation.workspace_id;
      outcome := 'paid_plan_required';
      return next;
      continue;
    end if;

    update public.workspace_invitations
    set status = 'accepted',
        accepted_by = p_verified_user_id,
        accepted_at = now(),
        updated_at = now()
    where id = v_invitation.id;

    if exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = v_invitation.workspace_id
        and wm.profile_id = p_verified_user_id
    ) then
      outcome := 'already_member';
    else
      insert into public.workspace_members (workspace_id, profile_id, role)
      values (v_invitation.workspace_id, p_verified_user_id, v_invitation.role);
      outcome := 'accepted';
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
      v_invitation.workspace_id,
      p_verified_user_id,
      'team.invitation_accepted',
      'workspace_invitation',
      v_invitation.id,
      jsonb_build_object('role', v_invitation.role, 'outcome', outcome)
    );

    invitation_id := v_invitation.id;
    workspace_id := v_invitation.workspace_id;
    return next;
  end loop;
end;
$$;

comment on table public.workspace_invitations is
  'Durable paid workspace seat reservations accepted only by a verified auth user with the matching normalized email.';
comment on function public.reserve_verified_workspace_invitation(uuid, text, text, uuid) is
  'Atomically reserves one of five named seats under the workspace row lock.';
comment on function public.accept_verified_workspace_invitations(uuid) is
  'Idempotently accepts active invitations using authoritative verified auth.users identity.';

revoke all on table public.workspace_invitations from public, anon, authenticated;
grant select on table public.workspace_invitations to authenticated;

revoke all on function public.reserve_verified_workspace_invitation(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_verified_workspace_invitation(uuid, text, text, uuid)
  to service_role;

revoke all on function public.cancel_workspace_invitation(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancel_workspace_invitation(uuid, uuid, uuid, text)
  to service_role;

revoke all on function public.accept_verified_workspace_invitations(uuid)
  from public, anon, authenticated;
grant execute on function public.accept_verified_workspace_invitations(uuid)
  to service_role;

commit;
