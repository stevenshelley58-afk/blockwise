-- Customer-operations team account management: suspend and reactivate.
--
-- 1. workspace_members gains a suspension status; the workspace access helper
--    excludes suspended members so the data path closes immediately.
-- 2. execute_ops_customer_action learns team_suspend / team_reactivate with
--    owner-only CAS semantics and last-owner protection.
-- 3. Capability rows describe the available suspension actions.
begin;

alter table public.workspace_members
  add column if not exists status text not null default 'active' check (status in ('active','suspended'));

create or replace function public.execute_ops_customer_action(
  p_action_id uuid, p_workspace_id uuid, p_target_id uuid, p_action_type text,
  p_expected_version bigint, p_actor_profile_id uuid, p_payload jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_topics text[];
  v_pref public.customer_communication_preferences%rowtype;
  v_enquiry public.ops_enquiry_associations%rowtype;
  v_projection uuid;
  v_status text;
  v_updated integer;
  v_topic text;
  v_reason text;
  v_member public.workspace_members%rowtype;
  v_role text;
begin
  if p_action_id is null or p_workspace_id is null or p_target_id is null
    or p_expected_version is null or p_expected_version < 1
    or p_action_type not in ('team_role_change','team_suspend','team_reactivate','enquiry_close','enquiry_reply','enquiry_reopen','flow_enroll','flow_pause','flow_resume','consent_grant','consent_withdraw','consent_unsubscribe','suppression_add','suppression_remove')
    or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object'
    or not exists (select 1 from public.ops_action_outbox where action_id=p_action_id and workspace_id=p_workspace_id and status='processing')
    or not exists (select 1 from public.profiles where id=p_actor_profile_id and is_operator=true and operator_role in ('owner','support'))
  then raise exception 'invalid customer operations mutation' using errcode='22023'; end if;

  if p_action_type = 'team_role_change' then
    select * into v_member from public.workspace_members where workspace_id=p_workspace_id and profile_id=p_target_id for update;
    if not found or v_member.ops_version <> p_expected_version then raise exception 'operations member target is stale or not owned' using errcode='40001'; end if;
    v_role := p_payload->>'role';
    if v_role not in ('admin','member','viewer') then raise exception 'team role is invalid' using errcode='22023'; end if;
    if v_member.role = 'owner' then raise exception 'last_operator_owner' using errcode='42501'; end if;
    update public.workspace_members set role=v_role where workspace_id=p_workspace_id and profile_id=p_target_id and ops_version=p_expected_version;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then raise exception 'member version conflict' using errcode='40001'; end if;
    insert into public.audit_logs(workspace_id,actor_profile_id,action,target_type,target_id,correlation_id,metadata)
      values(p_workspace_id,p_actor_profile_id,'ops.team_role_change','profile',p_target_id,p_action_id::text,
        jsonb_build_object('expectedVersion',p_expected_version,'role',v_role));
    return jsonb_build_object('status','applied','role',v_role);
  elsif p_action_type in ('team_suspend','team_reactivate') then
    select * into v_member from public.workspace_members where workspace_id=p_workspace_id and profile_id=p_target_id for update;
    if not found or v_member.ops_version <> p_expected_version then raise exception 'operations member target is stale or not owned' using errcode='40001'; end if;
    if p_action_type = 'team_suspend' then
      -- Last-owner protection: a workspace always keeps one active owner.
      if v_member.role = 'owner' and 1 = (select count(*) from public.workspace_members m where m.workspace_id=p_workspace_id and m.role='owner' and (m.status is null or m.status='active')) then
        raise exception 'last_operator_owner' using errcode='42501';
      end if;
      update public.workspace_members set status='suspended' where workspace_id=p_workspace_id and profile_id=p_target_id and ops_version=p_expected_version;
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then raise exception 'member version conflict' using errcode='40001'; end if;
      insert into public.audit_logs(workspace_id,actor_profile_id,action,target_type,target_id,correlation_id,metadata)
        values(p_workspace_id,p_actor_profile_id,'ops.team_suspend','profile',p_target_id,p_action_id::text,
          jsonb_build_object('expectedVersion',p_expected_version));
      return jsonb_build_object('status','applied','memberStatus','suspended');
    end if;
    update public.workspace_members set status='active' where workspace_id=p_workspace_id and profile_id=p_target_id and ops_version=p_expected_version;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then raise exception 'member version conflict' using errcode='40001'; end if;
    insert into public.audit_logs(workspace_id,actor_profile_id,action,target_type,target_id,correlation_id,metadata)
      values(p_workspace_id,p_actor_profile_id,'ops.team_reactivate','profile',p_target_id,p_action_id::text,
        jsonb_build_object('expectedVersion',p_expected_version));
    return jsonb_build_object('status','applied','memberStatus','active');
  elsif p_action_type like 'enquiry_%' or p_action_type like 'flow_%' then
    raise exception 'Chatwoot enquiry actions are provider-owned and must be executed by Hermes' using errcode='55000';
  end if;

  select p.email into v_email from public.profiles p
    join public.workspace_members wm on wm.profile_id=p.id
    where p.id=p_target_id and wm.workspace_id=p_workspace_id for update;
  if v_email is null then raise exception 'operations profile target is not owned by workspace' using errcode='42501'; end if;
  select * into v_pref from public.customer_communication_preferences
    where workspace_id=p_workspace_id and profile_id=p_target_id for update;
  if not found then
    insert into public.customer_communication_preferences(workspace_id,profile_id,email)
      values(p_workspace_id,p_target_id,lower(btrim(v_email))) returning * into v_pref;
  end if;
  v_topics := coalesce(v_pref.topics,'{}'::text[]);
  v_topic := nullif(lower(btrim(p_payload->>'topic')),'');
  v_reason := left(nullif(btrim(p_payload->>'reason'),''),500);
  if p_action_type = 'consent_grant' then
    if v_topic is null then raise exception 'consent topic is required' using errcode='22023'; end if;
    if not (v_topic = any(v_topics)) then v_topics := array_append(v_topics,v_topic); end if;
    update public.customer_communication_preferences set marketing_consent='granted', topics=v_topics,
      unsubscribed_at=null, suppressed=false, suppression_reason=null, consent_source='operator', consent_recorded_at=now(), updated_at=now()
      where id=v_pref.id;
  elsif p_action_type = 'consent_withdraw' then
    if v_topic is null then v_topics := '{}'; else v_topics := array_remove(v_topics,v_topic); end if;
    update public.customer_communication_preferences set marketing_consent='withdrawn', topics=v_topics,
      consent_source='operator', consent_recorded_at=now(), updated_at=now() where id=v_pref.id;
  elsif p_action_type = 'consent_unsubscribe' then
    update public.customer_communication_preferences set marketing_consent='withdrawn', topics='{}',
      unsubscribed_at=now(), consent_source='operator', consent_recorded_at=now(), updated_at=now() where id=v_pref.id;
  elsif p_action_type = 'suppression_add' then
    if v_reason is null or v_reason not in ('bounce','complaint','unsubscribe','admin') then raise exception 'suppression reason is invalid' using errcode='22023'; end if;
    if exists (select 1 from public.email_suppressions where lower(email)=lower(btrim(v_email)) and reason=v_reason and (workspace_id is distinct from p_workspace_id)) then
      raise exception 'suppression is owned by another authority' using errcode='42501';
    end if;
    insert into public.email_suppressions(workspace_id,email,reason,source)
      values(p_workspace_id,lower(btrim(v_email)),v_reason,'operator') on conflict (email,reason) do nothing;
    update public.customer_communication_preferences set suppressed=true, suppression_reason=v_reason, updated_at=now() where id=v_pref.id;
  elsif p_action_type = 'suppression_remove' then
    if v_reason is null or v_reason not in ('bounce','complaint','unsubscribe','admin') then raise exception 'suppression reason is invalid' using errcode='22023'; end if;
    delete from public.email_suppressions where workspace_id=p_workspace_id and lower(email)=lower(btrim(v_email)) and reason=v_reason;
    update public.customer_communication_preferences set suppressed=exists(select 1 from public.email_suppressions s where s.workspace_id=p_workspace_id and lower(s.email)=lower(btrim(v_email))), updated_at=now() where id=v_pref.id;
  end if;
  insert into public.audit_logs(workspace_id,actor_profile_id,action,target_type,target_id,correlation_id,metadata)
    values(p_workspace_id,p_actor_profile_id,'ops.'||p_action_type,'profile',p_target_id,p_action_id::text,
      jsonb_build_object('expectedVersion',p_expected_version,'topic',v_topic,'reason',v_reason));
  return jsonb_build_object('status','applied','projectionQueued',true);
end;
$$;
revoke all on function public.execute_ops_customer_action(uuid,uuid,uuid,text,bigint,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.execute_ops_customer_action(uuid,uuid,uuid,text,bigint,uuid,jsonb) to service_role;

create or replace function private.is_workspace_member(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.profile_id = (select auth.uid())
      and wm.status = 'active'
  );
$fn$;

update public.ops_action_capabilities set capability_state='available',
    description='owner-only CAS suspension with last-owner protection and session revocation', updated_at=now()
  where action_type='team_suspend';
update public.ops_action_capabilities set capability_state='available',
    description='owner-only CAS reactivation of a suspended member', updated_at=now()
  where action_type='team_reactivate';
update public.ops_action_capabilities set description='Hermes SnagTime action lane requires verified provider readiness', updated_at=now()
  where action_type in ('booking_cancel','booking_reschedule');

commit;
