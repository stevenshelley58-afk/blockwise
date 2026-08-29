begin;

create or replace function public.allocate_paid_workspace_member_seat(
  p_workspace_id uuid,
  p_profile_id uuid,
  p_role text,
  p_actor_profile_id uuid
)
returns table (
  outcome text,
  member_count integer,
  seats_remaining integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_billing_state text;
  v_member_count integer;
begin
  if p_role not in ('admin', 'member', 'viewer') then
    return query select 'invalid_role'::text, 0, 0;
    return;
  end if;

  -- Serialize every seat decision for a workspace. The row lock protects the
  -- billing binding; the advisory transaction lock also serializes inserts
  -- when no membership row for the invited profile exists yet.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('paid-workspace-seats:' || p_workspace_id::text, 0)
  );

  select w.billing_access_state
  into v_billing_state
  from public.workspaces w
  where w.id = p_workspace_id
  for update;

  if not found then
    return query select 'workspace_not_found'::text, 0, 0;
    return;
  end if;

  if v_billing_state <> 'paid' then
    return query select 'paid_plan_required'::text, 0, 0;
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
    return query select 'owner_required'::text, 0, 0;
    return;
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and not p.is_operator
  ) then
    return query select 'invalid_member'::text, 0, 0;
    return;
  end if;

  select count(*)::integer
  into v_member_count
  from public.workspace_members wm
  join public.profiles p on p.id = wm.profile_id
  where wm.workspace_id = p_workspace_id
    and not p.is_operator;

  if exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.profile_id = p_profile_id
  ) then
    return query
      select
        'already_member'::text,
        v_member_count,
        greatest(0, 5 - v_member_count);
    return;
  end if;

  if v_member_count >= 5 then
    return query select 'seat_limit_reached'::text, v_member_count, 0;
    return;
  end if;

  insert into public.workspace_members (workspace_id, profile_id, role)
  values (p_workspace_id, p_profile_id, p_role);

  v_member_count := v_member_count + 1;
  return query
    select
      'added'::text,
      v_member_count,
      greatest(0, 5 - v_member_count);
end;
$$;

comment on function public.allocate_paid_workspace_member_seat(uuid, uuid, text, uuid) is
  'Atomically allocates one of five named paid self-serve seats under a workspace-scoped transaction lock.';

revoke all on function public.allocate_paid_workspace_member_seat(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.allocate_paid_workspace_member_seat(uuid, uuid, text, uuid)
  to service_role;

commit;
