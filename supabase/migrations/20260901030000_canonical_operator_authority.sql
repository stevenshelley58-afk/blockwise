-- Canonicalize platform operator authority and prevent membership escalation.
--
-- Membership role 'operator' remains a workspace-local legacy/access role for
-- existing rows, but it can no longer grant global operator access or be
-- assigned/changed by authenticated workspace owners/admins. Existing
-- membership-only rows are intentionally not promoted; inventory them first:
--   select wm.workspace_id, wm.profile_id
--   from public.workspace_members wm
--   left join public.profiles p on p.id = wm.profile_id
--   where wm.role = 'operator' and not coalesce(p.is_operator, false);
--
-- Rollback is additive-safe: restore the prior helper definitions and drop the
-- new membership trigger/RPC only after a reviewed data migration.

create or replace function public.is_operator()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select p.is_operator = true
      and p.operator_role in ('owner', 'support')
    from public.profiles p
    where p.id = (select auth.uid())
  ), false);
$$;

comment on function public.is_operator() is
  'True only for profiles with is_operator=true and operator_role owner/support.';

create or replace function private.is_operator()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select p.is_operator = true
      and p.operator_role in ('owner', 'support')
    from public.profiles p
    where p.id = (select auth.uid())
  ), false);
$$;

create or replace function private.adstudio_has_workspace_access(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.profile_id = (select auth.uid())
  )
  or private.is_operator();
$$;

create or replace function public.protect_workspace_operator_membership()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
begin
  if coalesce(v_jwt_role, '') in ('service_role', 'postgres')
     or current_user = 'postgres'
     or current_setting('is_superuser', true) = 'on' then
    return new;
  end if;

  if new.role = 'operator' or (tg_op = 'UPDATE' and old.role = 'operator') then
    raise exception 'workspace operator membership is service-managed';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_workspace_operator_membership on public.workspace_members;
create trigger protect_workspace_operator_membership
  before insert or update on public.workspace_members
  for each row execute function public.protect_workspace_operator_membership();

revoke all on function public.protect_workspace_operator_membership() from public, anon, authenticated;
grant execute on function public.protect_workspace_operator_membership() to service_role;

create or replace function public.set_operator_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_caller_id uuid;
  v_caller_is_owner boolean := false;
  v_target_is_owner boolean := false;
  v_owner_count integer := 0;
  v_effective_role text := coalesce(current_setting('role', true), current_user);
begin
  if p_role is not null and p_role not in ('owner', 'support') then
    raise exception 'invalid_operator_role';
  end if;
  if p_user_id is null then
    raise exception 'invalid_user';
  end if;

  if not (v_effective_role in ('postgres') or current_setting('is_superuser', true) = 'on') then
    begin
      v_caller_id := (nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid;
    exception when others then
      v_caller_id := null;
    end;
    if v_caller_id is null then
      raise exception 'operator_owner_required';
    end if;
    select bool_or(p.is_operator and p.operator_role = 'owner')
      into v_caller_is_owner
    from public.profiles p where p.id = v_caller_id;
    if v_caller_is_owner is not true then
      raise exception 'operator_owner_required';
    end if;
  end if;

  select p.is_operator and p.operator_role = 'owner'
    into v_target_is_owner
  from public.profiles p where p.id = p_user_id;
  if not found then
    raise exception 'operator_user_not_found';
  end if;

  if v_target_is_owner and p_role is distinct from 'owner' then
    select count(*)::integer into v_owner_count
    from public.profiles
    where is_operator = true and operator_role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'last_operator_owner';
    end if;
  end if;

  perform set_config('app.bypass_operator_role_guard', 'on', true);
  update public.profiles
  set operator_role = p_role,
      is_operator = (p_role is not null),
      operator_since = case
        when p_role is null then null
        else coalesce(operator_since, now())
      end
  where id = p_user_id;
end;
$$;

revoke all on function public.set_operator_role(uuid, text) from public, anon;
grant execute on function public.set_operator_role(uuid, text) to authenticated, service_role;
