-- Recovered verbatim from the production migration ledger (schema_migrations.statements).
-- Applied out-of-band to prod as version 20260608222515; restored to source control here.

-- Additive step: create the RLS helper functions in the unexposed `private` schema.
-- Pinned search_path='' (all refs schema-qualified) and (select auth.uid()) for initplan perf.
create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.is_operator()
returns boolean language sql stable security definer set search_path = '' as $fn$
  select coalesce((select p.is_operator from public.profiles p where p.id = (select auth.uid())), false);
$fn$;

create or replace function private.is_workspace_member(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.profile_id = (select auth.uid())
  );
$fn$;

create or replace function private.has_workspace_role(target_workspace_id uuid, roles text[])
returns boolean language sql stable security definer set search_path = '' as $fn$
  select private.is_operator()
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = target_workspace_id
        and wm.profile_id = (select auth.uid())
        and wm.role = any(roles)
    );
$fn$;

create or replace function private.adstudio_has_workspace_access(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.profile_id = (select auth.uid())
  )
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_operator = true
  );
$fn$;

create or replace function private.workspace_id_from_storage_path(object_name text)
returns uuid language plpgsql stable security definer set search_path = '' as $fn$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when others then
  return null;
end;
$fn$;

revoke all on function
  private.is_operator(),
  private.is_workspace_member(uuid),
  private.has_workspace_role(uuid, text[]),
  private.adstudio_has_workspace_access(uuid),
  private.workspace_id_from_storage_path(text)
from public;

grant execute on function
  private.is_operator(),
  private.is_workspace_member(uuid),
  private.has_workspace_role(uuid, text[]),
  private.adstudio_has_workspace_access(uuid),
  private.workspace_id_from_storage_path(text)
to anon, authenticated, service_role;
