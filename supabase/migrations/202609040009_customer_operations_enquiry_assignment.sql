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

-- Global enquiries are intentionally visible in Frank's unassigned queue. Only
-- the assignment action may claim one for a destination workspace; close/reply
-- remain strictly workspace-bound in the target guard below.
create or replace function public.ops_action_target_binding()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_exists boolean := false;
begin
  if new.action_type = 'enquiry_assign' then
    v_exists := new.target_type = 'enquiry'
      and exists (
        select 1 from public.ops_enquiry_associations
        where id = new.target_id
          and (workspace_id is null or workspace_id = new.workspace_id)
        for update
      );
  elsif new.action_type in ('enquiry_close', 'enquiry_reply') then
    v_exists := new.target_type = 'enquiry'
      and exists (
        select 1 from public.ops_enquiry_associations
        where id = new.target_id and workspace_id = new.workspace_id
        for update
      );
  else
    -- Preserve the fencing behavior for every non-enquiry action from 008.
    if new.action_type = 'team_invite' or new.action_type in ('billing_reconcile', 'billing_cancel_at_period_end', 'billing_portal_link') then
      v_exists := new.target_type = case when new.action_type = 'team_invite' then 'workspace' else 'billing' end
        and new.target_id = new.workspace_id
        and exists (select 1 from public.workspaces where id = new.workspace_id for update);
    elsif new.action_type in ('team_resend', 'team_cancel') then
      v_exists := new.target_type = 'invitation'
        and exists (select 1 from public.workspace_invitations where id = new.target_id and workspace_id = new.workspace_id for update);
    elsif new.action_type in ('team_role_change', 'team_suspend', 'team_reactivate', 'consent_grant', 'consent_withdraw', 'consent_unsubscribe', 'suppression_add', 'suppression_remove') then
      v_exists := new.target_type = 'profile'
        and exists (select 1 from public.workspace_members where workspace_id = new.workspace_id and profile_id = new.target_id for update);
    elsif new.action_type = 'session_revoke' then
      v_exists := new.target_type = 'session'
        and exists (select 1 from public.workspace_members where workspace_id = new.workspace_id and profile_id = new.target_id for update)
        and exists (select 1 from auth.users where id = new.target_id);
    elsif new.action_type in ('booking_cancel', 'booking_reschedule') then
      v_exists := new.target_type = 'booking'
        and exists (select 1 from public.workspace_onboarding_bookings where id = new.target_id and workspace_id = new.workspace_id for update);
    end if;
  end if;
  if not v_exists then
    raise exception 'operations action target is not owned by workspace' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.ops_action_target_binding() from public, anon, authenticated, service_role;

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
  perform 1 from public.workspaces where id = p_workspace_id for update;
  if not found then
    raise exception 'workspace_not_found' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_actor_profile_id and is_operator = true and operator_role in ('owner', 'support')
  ) then
    raise exception 'operator_required' using errcode = '42501';
  end if;
  if p_assignee_profile_id is not null and not exists (
    select 1 from public.workspace_members where workspace_id = p_workspace_id and profile_id = p_assignee_profile_id
  ) then
    raise exception 'enquiry assignee is not a workspace member' using errcode = '42501';
  end if;
  update public.ops_enquiry_associations
  set workspace_id = p_workspace_id, assignee_profile_id = p_assignee_profile_id
  where id = p_enquiry_id
    and (workspace_id is null or workspace_id = p_workspace_id)
    and ops_version = p_expected_version;
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
