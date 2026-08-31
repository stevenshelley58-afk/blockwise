-- Protect operator role columns from client self-elevation.
--
-- profiles_update_self_or_operator lets every authenticated user update their
-- own profile row, so without column protection a user could set
-- operator_role to 'owner' and pass requireOperator(). Three controls:
--
--   1. BEFORE UPDATE trigger rejects ANY change to is_operator,
--      operator_role or operator_since when the effective role is a client
--      role (authenticated/anon). Service-role and database-owner paths
--      (supabase SQL editor, migrations, the owner RPC below) pass.
--   2. set_operator_role(p_user_id, p_role): SECURITY DEFINER RPC callable
--      only by an operator with operator_role='owner' (verified from the JWT
--      claims) or the database owner. This is the supported management path
--      for assigning support/owner roles.
--   3. requireOperator() in application code requires is_operator = true
--      together with a valid role (role alone never grants access).
--
-- Rollback:
--   drop function public.set_operator_role(uuid, text);
--   drop trigger if exists protect_operator_role_columns on public.profiles;
--   drop function public.protect_operator_role_columns();

create or replace function public.protect_operator_role_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_role text := coalesce(current_setting('role', true), current_user);
begin
  -- The management RPC sets this transaction-local flag after verifying the
  -- caller is an operator owner.
  if current_setting('app.bypass_operator_role_guard', true) = 'on' then
    return new;
  end if;

  if v_effective_role in ('service_role', 'postgres') or current_setting('is_superuser', true) = 'on' then
    return new;
  end if;

  if (new.is_operator is distinct from old.is_operator)
    or (new.operator_role is distinct from old.operator_role)
    or (new.operator_since is distinct from old.operator_since) then
    raise exception 'operator role columns are protected';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_operator_role_columns on public.profiles;
create trigger protect_operator_role_columns
  before update on public.profiles
  for each row execute function public.protect_operator_role_columns();

create or replace function public.set_operator_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid;
  v_caller_is_owner boolean := false;
  v_effective_role text := coalesce(current_setting('role', true), current_user);
begin
  if p_role not in ('owner', 'support') then
    raise exception 'invalid_operator_role';
  end if;
  if p_user_id is null then
    raise exception 'invalid_user';
  end if;

  -- Database-owner paths (SQL editor, migrations) manage roles directly.
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
    from public.profiles p
    where p.id = v_caller_id;
    if v_caller_is_owner is not true then
      raise exception 'operator_owner_required';
    end if;
  end if;

  perform set_config('app.bypass_operator_role_guard', 'on', true);

  update public.profiles
  set operator_role = p_role,
      is_operator = true,
      operator_since = coalesce(operator_since, now())
  where id = p_user_id;

  if not found then
    raise exception 'operator_user_not_found';
  end if;
end;
$$;

revoke all on function public.set_operator_role(uuid, text) from public, anon;
grant execute on function public.set_operator_role(uuid, text) to authenticated, service_role;
