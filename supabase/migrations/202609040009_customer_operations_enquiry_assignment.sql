begin;

alter table public.ops_enquiry_associations
  add column if not exists assignee_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists ops_version bigint not null default 1;

alter table public.ops_enquiry_associations
  drop constraint if exists ops_enquiry_associations_ops_version_check;
alter table public.ops_enquiry_associations
  add constraint ops_enquiry_associations_ops_version_check check (ops_version > 0);

create or replace function public.ops_enquiry_association_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.ops_version := old.ops_version + 1;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists ops_enquiry_association_version on public.ops_enquiry_associations;
create trigger ops_enquiry_association_version before update on public.ops_enquiry_associations
  for each row execute function public.ops_enquiry_association_version();

create or replace function public.assign_ops_enquiry(
  p_workspace_id uuid, p_enquiry_id uuid, p_assignee_profile_id uuid,
  p_expected_version bigint, p_actor_profile_id uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_updated integer;
begin
  if p_workspace_id is null or p_enquiry_id is null or p_expected_version is null or p_expected_version < 1 or p_actor_profile_id is null then
    raise exception 'invalid enquiry assignment identity' using errcode = '22023';
  end if;
  if p_assignee_profile_id is not null and not exists (
    select 1 from public.workspace_members where workspace_id = p_workspace_id and profile_id = p_assignee_profile_id
  ) then
    raise exception 'enquiry assignee is not a workspace member' using errcode = '42501';
  end if;
  update public.ops_enquiry_associations
  set assignee_profile_id = p_assignee_profile_id
  where id = p_enquiry_id and workspace_id = p_workspace_id and ops_version = p_expected_version;
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    insert into public.audit_logs (workspace_id, actor_profile_id, action, target_type, target_id, metadata)
    values (p_workspace_id, p_actor_profile_id, 'ops.enquiry_assigned', 'enquiry', p_enquiry_id,
      jsonb_build_object('assigneeProfileId', p_assignee_profile_id, 'expectedVersion', p_expected_version));
  end if;
  return v_updated = 1;
end;
$$;

revoke all on function public.ops_enquiry_association_version() from public, anon, authenticated, service_role;
revoke all on function public.assign_ops_enquiry(uuid,uuid,uuid,bigint,uuid) from public, anon, authenticated;
grant execute on function public.assign_ops_enquiry(uuid,uuid,uuid,bigint,uuid) to service_role;

commit;
