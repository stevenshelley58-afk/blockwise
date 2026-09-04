-- Customer-operations management mutations. The control edge supplies an
-- already leased action; this RPC is the final tenant/CAS boundary. Provider
-- effects remain in the Hermes projection worker and are never performed here.
begin;

-- The action enum is a CHECK in the original outbox migration; extend it for
-- already-migrated databases as well as fresh replays.
alter table public.ops_action_capabilities drop constraint if exists ops_action_capabilities_action_type_check;
alter table public.ops_action_capabilities add constraint ops_action_capabilities_action_type_check check (action_type in (
  'team_invite','team_resend','team_cancel','team_role_change','team_suspend','team_reactivate','session_revoke',
  'consent_grant','consent_withdraw','consent_unsubscribe','suppression_add','suppression_remove',
  'enquiry_assign','enquiry_close','enquiry_reply','enquiry_reopen','booking_cancel','booking_reschedule',
  'billing_reconcile','billing_cancel_at_period_end','billing_portal_link'));
alter table public.ops_action_outbox drop constraint if exists ops_action_outbox_action_type_check;
alter table public.ops_action_outbox add constraint ops_action_outbox_action_type_check check (action_type in (
  'team_invite','team_resend','team_cancel','team_role_change','team_suspend','team_reactivate','session_revoke',
  'consent_grant','consent_withdraw','consent_unsubscribe','suppression_add','suppression_remove',
  'enquiry_assign','enquiry_close','enquiry_reply','enquiry_reopen','booking_cancel','booking_reschedule',
  'billing_reconcile','billing_cancel_at_period_end','billing_portal_link'));
insert into public.ops_action_capabilities(action_type, capability_state, description)
values ('enquiry_reopen','capability_required','action-bound Chatwoot reopen executor is not registered')
on conflict (action_type) do nothing;

-- Chatwoot action execution is owned by Hermes; local mutation-only actions
-- below remain capability_required until their provider adapters are present.
update public.ops_action_capabilities set capability_state='available', description=case action_type
  when 'enquiry_close' then 'Hermes action-bound Chatwoot status executor'
  when 'enquiry_reply' then 'Hermes action-bound Chatwoot reply executor'
  when 'enquiry_reopen' then 'Hermes action-bound Chatwoot reopen executor'
  else description end
where action_type in ('enquiry_close','enquiry_reply','enquiry_reopen');

create or replace function public.claim_ops_provider_action(p_lease_seconds integer default 600)
returns table (id uuid, action_id uuid, workspace_id uuid, customer_id uuid, actor_operator_id uuid, actor_role text,
  action_type text, target_type text, target_id uuid, expected_version bigint, reason text, payload jsonb,
  attempts integer, max_attempts integer, expires_at timestamptz, lease_token uuid)
language sql security definer set search_path = '' as $$
  update public.ops_action_outbox as o set status='processing', attempts=o.attempts+1,
    lease_token=gen_random_uuid(), lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,600),3600))), updated_at=now()
  where o.id=(select c.id from public.ops_action_outbox c where c.status='pending' and c.run_after<=now()
    and c.expires_at>now() and c.attempts<c.max_attempts
    and c.action_type in ('enquiry_close','enquiry_reply','enquiry_reopen')
    and not exists (select 1 from public.ops_action_outbox newer where newer.workspace_id=c.workspace_id and newer.target_type=c.target_type and newer.target_id=c.target_id and newer.expected_version>c.expected_version and newer.status not in ('rejected','expired','superseded'))
    order by c.run_after,c.created_at,c.id for update skip locked limit 1)
  returning o.id,o.action_id,o.workspace_id,o.customer_id,o.actor_operator_id,o.actor_role,o.action_type,o.target_type,o.target_id,o.expected_version,o.reason,o.payload,o.attempts,o.max_attempts,o.expires_at,o.lease_token;
$$;
revoke all on function public.claim_ops_provider_action(integer) from public, anon, authenticated;
grant execute on function public.claim_ops_provider_action(integer) to service_role;

create table if not exists private.ops_enquiry_action_messages (
  action_id uuid primary key references public.ops_action_outbox(action_id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  enquiry_id uuid not null references public.ops_enquiry_associations(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
alter table private.ops_enquiry_action_messages enable row level security;
revoke all on private.ops_enquiry_action_messages from public, anon, authenticated;
grant select, insert on private.ops_enquiry_action_messages to service_role;
create or replace function public.ops_enquiry_action_messages_immutable()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'enquiry action messages are immutable' using errcode='42501'; end;
$$;
drop trigger if exists ops_enquiry_action_messages_immutable on private.ops_enquiry_action_messages;
create trigger ops_enquiry_action_messages_immutable before update or delete on private.ops_enquiry_action_messages
for each row execute function public.ops_enquiry_action_messages_immutable();

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
    or p_action_type not in ('team_role_change','enquiry_close','enquiry_reply','enquiry_reopen','consent_grant','consent_withdraw','consent_unsubscribe','suppression_add','suppression_remove')
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
  elsif p_action_type like 'enquiry_%' then
    select * into v_enquiry from public.ops_enquiry_associations
      where id=p_target_id and workspace_id=p_workspace_id for update;
    if not found then raise exception 'operations enquiry target is not owned by workspace' using errcode='42501'; end if;
    if v_enquiry.ops_version <> p_expected_version then raise exception 'operations action target version is stale' using errcode='40001'; end if;
    if p_action_type in ('enquiry_close','enquiry_reopen') then
      update public.ops_enquiry_associations set status=case when p_action_type='enquiry_close' then 'closed' else 'open' end, updated_at=now()
        where id=p_target_id and workspace_id=p_workspace_id and ops_version=p_expected_version;
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then raise exception 'enquiry version conflict' using errcode='40001'; end if;
      v_status := case when p_action_type='enquiry_close' then 'closed' else 'open' end;
    else
      v_status := v_enquiry.status;
      if nullif(btrim(p_payload->>'body'),'') is null then raise exception 'enquiry reply body is required' using errcode='22023'; end if;
      insert into private.ops_enquiry_action_messages(action_id,workspace_id,enquiry_id,body)
        values(p_action_id,p_workspace_id,p_target_id,left(p_payload->>'body',4000))
        on conflict(action_id) do nothing;
      v_projection := public.enqueue_ops_projection(
        p_workspace_id, 'chatwoot', 'enquiry', p_target_id::text, 'upsert',
        'ops-action:' || p_action_id::text, nextval('public.ops_projection_source_version_seq'),
        jsonb_build_object('workspaceId',p_workspace_id::text,'sourceEventId',p_action_id::text,
          'status',v_enquiry.status,'subject',coalesce(v_enquiry.subject,''),
          'reply',left(coalesce(p_payload->>'body',''),4000),
          'requesterEmail',left(coalesce(v_enquiry.requester_email,''),320),
          'requesterName',left(coalesce(v_enquiry.requester_name,''),256)));
    end if;
    insert into public.audit_logs(workspace_id,actor_profile_id,action,target_type,target_id,correlation_id,metadata)
      values(p_workspace_id,p_actor_profile_id,'ops.'||p_action_type,'enquiry',p_target_id,p_action_id::text,
        jsonb_build_object('expectedVersion',p_expected_version,'status',v_status));
    return jsonb_build_object('status',v_status,'projectionQueued',v_projection is not null);
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
revoke all on function public.execute_ops_customer_action(uuid,uuid,uuid,text,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.execute_ops_customer_action(uuid,uuid,uuid,text,bigint,uuid,jsonb) to service_role;
commit;
