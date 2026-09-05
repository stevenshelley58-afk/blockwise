-- Customer-operations management mutations. The control edge supplies an
-- already leased action; this RPC is the final tenant/CAS boundary. Provider
-- effects remain in the Hermes projection worker and are never performed here.
begin;

alter table public.ops_action_capabilities add column if not exists verified_at timestamptz;
alter table public.ops_action_capabilities add column if not exists expires_at timestamptz;
alter table public.ops_action_capabilities add column if not exists verification_error text;

-- The action enum is a CHECK in the original outbox migration; extend it for
-- already-migrated databases as well as fresh replays.
alter table public.ops_action_capabilities drop constraint if exists ops_action_capabilities_action_type_check;
alter table public.ops_action_capabilities add constraint ops_action_capabilities_action_type_check check (action_type in (
  'team_invite','team_resend','team_cancel','team_role_change','team_suspend','team_reactivate','session_revoke',
  'consent_grant','consent_withdraw','consent_unsubscribe','suppression_add','suppression_remove','flow_enroll','flow_pause','flow_resume',
  'enquiry_assign','enquiry_close','enquiry_reply','enquiry_reopen','booking_cancel','booking_reschedule',
  'billing_reconcile','billing_cancel_at_period_end','billing_portal_link'));
alter table public.ops_action_outbox drop constraint if exists ops_action_outbox_action_type_check;
alter table public.ops_action_outbox add constraint ops_action_outbox_action_type_check check (action_type in (
  'team_invite','team_resend','team_cancel','team_role_change','team_suspend','team_reactivate','session_revoke',
  'consent_grant','consent_withdraw','consent_unsubscribe','suppression_add','suppression_remove','flow_enroll','flow_pause','flow_resume',
  'enquiry_assign','enquiry_close','enquiry_reply','enquiry_reopen','booking_cancel','booking_reschedule',
  'billing_reconcile','billing_cancel_at_period_end','billing_portal_link'));
insert into public.ops_action_capabilities(action_type, capability_state, description)
values ('enquiry_reopen','capability_required','action-bound Chatwoot reopen executor is not registered')
on conflict (action_type) do nothing;
insert into public.ops_action_capabilities(action_type, capability_state, description)
values ('flow_enroll','capability_required','allowlisted Mautic flow enrollment executor is not registered'),
       ('flow_pause','capability_required','allowlisted Mautic flow pause executor is not registered'),
       ('flow_resume','capability_required','allowlisted Mautic flow resume executor is not registered')
on conflict (action_type) do nothing;

-- The worker lane is implemented but provider readiness is deployment state;
-- leave these disabled until a readiness check explicitly enables them.
update public.ops_action_capabilities set capability_state='capability_required', description='Hermes Chatwoot action lane requires verified provider readiness'
where action_type in ('enquiry_close','enquiry_reply','enquiry_reopen');
update public.ops_action_capabilities set capability_state='available', description='owner-only CAS role mutation with last-owner protection'
where action_type='team_role_change';

create or replace function public.set_ops_chatwoot_capability(p_enabled boolean, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.ops_action_capabilities set capability_state=case when p_enabled then 'available' else 'capability_required' end,
    description=left(coalesce(p_reason,'Chatwoot worker readiness unavailable'),256), updated_at=now(),
    verified_at=case when p_enabled then now() else null end,
    expires_at=case when p_enabled then now()+interval '2 minutes' else null end,
    verification_error=case when p_enabled then null else left(coalesce(p_reason,'unavailable'),512) end
    where action_type in ('enquiry_close','enquiry_reply','enquiry_reopen');
  return true;
end;
$$;
revoke all on function public.set_ops_chatwoot_capability(boolean,text) from public,anon,authenticated;
grant execute on function public.set_ops_chatwoot_capability(boolean,text) to service_role;

-- Provider-owned actions have a dedicated Hermes claimer. The generic
-- control-edge lane must never complete one after the web executor returns.
create or replace function public.claim_ops_action(p_lease_seconds integer default 600)
returns table (id uuid, action_id uuid, workspace_id uuid, customer_id uuid, actor_operator_id uuid, actor_role text,
  action_type text, target_type text, target_id uuid, expected_version bigint, reason text, payload jsonb,
  attempts integer, max_attempts integer, expires_at timestamptz, lease_token uuid)
language sql security definer set search_path = '' as $$
  update public.ops_action_outbox as o set status='processing', attempts=o.attempts+1,
    lease_token=gen_random_uuid(), lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,600),3600))), updated_at=now()
  where o.id=(select c.id from public.ops_action_outbox c where c.status='pending' and c.run_after<=now()
    and c.expires_at>now() and c.attempts<c.max_attempts
    and c.action_type not in ('enquiry_close','enquiry_reply','enquiry_reopen')
    and not exists (select 1 from public.ops_action_outbox newer where newer.workspace_id=c.workspace_id and newer.target_type=c.target_type and newer.target_id=c.target_id and newer.expected_version>c.expected_version and newer.status not in ('rejected','expired','superseded'))
    order by c.run_after,c.created_at,c.id for update skip locked limit 1)
  returning o.id,o.action_id,o.workspace_id,o.customer_id,o.actor_operator_id,o.actor_role,o.action_type,o.target_type,o.target_id,o.expected_version,o.reason,o.payload,o.attempts,o.max_attempts,o.expires_at,o.lease_token;
$$;

create or replace function public.resolve_ops_provider_action_identity(p_workspace_id uuid, p_enquiry_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('ciphertext', l.provider_conversation_id_ciphertext, 'digest', l.provider_conversation_id_digest)
  from private.ops_provider_operation_ledger l
  where l.workspace_id=p_workspace_id and l.provider='chatwoot' and l.aggregate_type='enquiry'
    and l.aggregate_id=p_enquiry_id::text and l.provider_conversation_id_ciphertext is not null
  order by l.source_version desc, l.updated_at desc limit 1;
$$;
revoke all on function public.resolve_ops_provider_action_identity(uuid,uuid) from public, anon, authenticated;
grant execute on function public.resolve_ops_provider_action_identity(uuid,uuid) to service_role;

create or replace function public.record_ops_enquiry_action_message(p_action_id uuid, p_workspace_id uuid, p_enquiry_id uuid, p_body text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_body is null or char_length(btrim(p_body)) not between 1 and 4000
    or not exists (select 1 from public.ops_action_outbox where action_id=p_action_id and workspace_id=p_workspace_id and target_type='enquiry' and target_id=p_enquiry_id)
    or not exists (select 1 from public.ops_enquiry_associations where id=p_enquiry_id and workspace_id=p_workspace_id) then
    raise exception 'invalid enquiry action message' using errcode='22023';
  end if;
  insert into private.ops_enquiry_action_messages(action_id,workspace_id,enquiry_id,body)
    values(p_action_id,p_workspace_id,p_enquiry_id,left(btrim(p_body),4000)) on conflict(action_id) do nothing;
  return true;
end;
$$;
revoke all on function public.record_ops_enquiry_action_message(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.record_ops_enquiry_action_message(uuid,uuid,uuid,text) to service_role;

create or replace function public.apply_ops_chatwoot_action_result(
  p_action_id uuid, p_workspace_id uuid, p_enquiry_id uuid, p_expected_version bigint, p_status text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_updated integer;
begin
  if p_status not in ('open','resolved') then raise exception 'invalid Chatwoot result status' using errcode='22023'; end if;
  update public.ops_enquiry_associations set status=p_status, updated_at=now()
    where id=p_enquiry_id and workspace_id=p_workspace_id and ops_version=p_expected_version
      and exists (select 1 from public.ops_action_outbox where action_id=p_action_id and workspace_id=p_workspace_id and action_type in ('enquiry_close','enquiry_reopen'));
  get diagnostics v_updated=row_count;
  if v_updated=1 then
    insert into public.audit_logs(workspace_id,action,target_type,target_id,correlation_id,metadata)
      select p_workspace_id,'ops.chatwoot.'||o.action_type,'enquiry',p_enquiry_id,p_action_id::text,jsonb_build_object('status',p_status,'expectedVersion',p_expected_version)
      from public.ops_action_outbox o where o.action_id=p_action_id;
  end if;
  return v_updated=1;
end;
$$;
revoke all on function public.apply_ops_chatwoot_action_result(uuid,uuid,uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.apply_ops_chatwoot_action_result(uuid,uuid,uuid,bigint,text) to service_role;

create table if not exists private.ops_chatwoot_webhook_events (
  event_id text primary key check (char_length(event_id) between 1 and 256),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  provider_conversation_id text not null check (provider_conversation_id ~ '^[0-9]+$'),
  event_type text not null check (event_type in ('message_created','message_updated','conversation_status_changed','conversation_updated')),
  status text not null default 'received' check (status in ('received','processed','ignored')),
  created_at timestamptz not null default now(), processed_at timestamptz
);
create table if not exists private.ops_enquiry_messages (
  provider_message_id text primary key check (provider_message_id ~ '^[0-9]+$'),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  enquiry_id uuid not null references public.ops_enquiry_associations(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 4000),
  direction text not null check (direction in ('incoming','outgoing')),
  created_at timestamptz not null default now()
);
alter table private.ops_chatwoot_webhook_events enable row level security;
alter table private.ops_enquiry_messages enable row level security;
alter table private.ops_enquiry_messages drop constraint if exists ops_enquiry_messages_provider_message_id_check;
alter table private.ops_enquiry_messages add constraint ops_enquiry_messages_provider_message_id_check check (provider_message_id ~ '^[0-9a-f]{64}$');
alter table private.ops_enquiry_messages alter column workspace_id drop not null;
alter table private.ops_enquiry_messages add column if not exists occurred_at timestamptz not null default now();
alter table private.ops_enquiry_messages add column if not exists sender_display text;
alter table private.ops_enquiry_messages add column if not exists attachment_metadata jsonb not null default '[]'::jsonb;
create unique index if not exists ops_chatwoot_enquiry_source_unique on public.ops_enquiry_associations(source_system,source_id) where source_system='chatwoot';

create or replace function public.sync_ops_chatwoot_enquiry_workspace()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update private.ops_provider_operation_ledger set workspace_id=new.workspace_id
    where provider='chatwoot' and aggregate_type='enquiry' and aggregate_id=new.id::text and new.workspace_id is not null;
  update private.ops_enquiry_messages set workspace_id=new.workspace_id where enquiry_id=new.id and new.workspace_id is not null;
  return new;
end; $$;
drop trigger if exists ops_chatwoot_enquiry_workspace_sync on public.ops_enquiry_associations;
create trigger ops_chatwoot_enquiry_workspace_sync after update of workspace_id on public.ops_enquiry_associations for each row execute function public.sync_ops_chatwoot_enquiry_workspace();
revoke all on function public.sync_ops_chatwoot_enquiry_workspace() from public, anon, authenticated, service_role;
revoke all on private.ops_chatwoot_webhook_events, private.ops_enquiry_messages from public,anon,authenticated,service_role;

create or replace function public.record_ops_chatwoot_webhook(
  p_event_id text, p_payload_hash text, p_account_id text, p_event_type text,
  p_provider_conversation_id text, p_provider_message_id text, p_status text, p_body text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_enquiry uuid; v_existing text; v_updated integer;
begin
  if nullif(btrim(p_event_id),'') is null or p_payload_hash !~ '^[0-9a-f]{64}$'
    or p_event_type not in ('message_created','message_updated','conversation_status_changed','conversation_updated')
    or p_provider_conversation_id !~ '^[0-9]+$' or char_length(coalesce(p_body,'')) > 4000 then raise exception 'invalid Chatwoot webhook' using errcode='22023'; end if;
  select e.workspace_id,e.id into v_workspace,v_enquiry
    from private.ops_provider_operation_ledger l join public.ops_enquiry_associations e on e.id=l.aggregate_id::uuid
    where l.provider='chatwoot' and l.aggregate_type='enquiry'
      and l.provider_conversation_id_digest=encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex')
      and e.workspace_id is not null limit 1;
  if v_workspace is null then return jsonb_build_object('status','ignored'); end if;
  select payload_hash into v_existing from private.ops_chatwoot_webhook_events where event_id=left(p_event_id,256);
  if v_existing is not null and v_existing <> p_payload_hash then raise exception 'Chatwoot webhook event hash mismatch' using errcode='22023'; end if;
  insert into private.ops_chatwoot_webhook_events(event_id,payload_hash,provider_conversation_id,event_type)
    values(left(p_event_id,256),p_payload_hash,p_provider_conversation_id,p_event_type)
    on conflict(event_id) do nothing;
  get diagnostics v_updated=row_count;
  if v_updated=0 then select status into v_existing from private.ops_chatwoot_webhook_events where event_id=left(p_event_id,256); return jsonb_build_object('status',coalesce(v_existing,'received'),'duplicate',true); end if;
  if p_event_type in ('message_created','message_updated') and p_provider_message_id ~ '^[0-9]+$' and nullif(btrim(p_body),'') is not null then
    insert into private.ops_enquiry_messages(provider_message_id,workspace_id,enquiry_id,body,direction)
      values(encode(extensions.digest(p_provider_message_id,'sha256'),'hex'),v_workspace,v_enquiry,left(p_body,4000),'incoming') on conflict(provider_message_id) do nothing;
  end if;
  if p_status in ('open','pending','resolved','closed') then
    update public.ops_enquiry_associations set status=case when p_status='resolved' then 'closed' else p_status end, updated_at=now() where id=v_enquiry and workspace_id=v_workspace;
  end if;
  update private.ops_chatwoot_webhook_events set status='processed',processed_at=now() where event_id=left(p_event_id,256);
  return jsonb_build_object('status','processed','workspaceId',v_workspace::text,'enquiryId',v_enquiry::text);
end;
$$;
revoke all on function public.record_ops_chatwoot_webhook(text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_ops_chatwoot_webhook(text,text,text,text,text,text,text,text) to service_role;

-- Adoption path for a first external conversation. The contact digest is the
-- only identity accepted from the provider payload; email is deliberately not
-- used to infer a tenant.
create or replace function public.record_ops_chatwoot_webhook_adopt(
  p_event_id text, p_payload_hash text, p_account_id text, p_inbox_id text,
  p_event_type text, p_provider_conversation_id text, p_provider_message_id text,
  p_contact_id_digest text, p_conversation_ciphertext text, p_status text, p_body text,
  p_occurred_at text default null, p_sender_display text default null, p_attachments jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_enquiry uuid; v_existing text;
begin
  if p_event_type not in ('conversation_created','message_created','message_updated','conversation_status_changed','conversation_updated')
    or p_account_id !~ '^[0-9]+$' or p_inbox_id !~ '^[0-9]+$'
    or p_provider_conversation_id !~ '^[0-9]+$' or p_contact_id_digest !~ '^[0-9a-f]{64}$' or p_conversation_ciphertext !~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
    or p_payload_hash !~ '^[0-9a-f]{64}$' or char_length(coalesce(p_body,'')) > 4000 or jsonb_typeof(coalesce(p_attachments,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_attachments,'[]'::jsonb)) > 10 then raise exception 'invalid Chatwoot adoption webhook' using errcode='22023'; end if;
  select l.workspace_id into v_workspace from private.ops_provider_operation_ledger l
    where l.provider='chatwoot' and l.provider_contact_id_digest=p_contact_id_digest
      and l.intent->>'accountId'=p_account_id and l.intent->>'inboxId'=p_inbox_id
    order by l.updated_at desc limit 1;
  select e.id into v_enquiry from private.ops_provider_operation_ledger l join public.ops_enquiry_associations e on e.id=l.aggregate_id::uuid
    where l.provider='chatwoot' and l.aggregate_type='enquiry' and l.provider_conversation_id_digest=encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex') and (e.workspace_id=v_workspace or (e.workspace_id is null and v_workspace is null)) limit 1;
  if v_enquiry is null then
    insert into public.ops_enquiry_associations(workspace_id,source_system,source_id,enquiry_type,status,subject)
      values(v_workspace,'chatwoot','conversation:'||encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex'),'support',case when p_status='resolved' then 'closed' else coalesce(nullif(p_status,''),'open') end,'Chatwoot enquiry') on conflict (source_system,source_id) where source_system='chatwoot' do nothing returning id into v_enquiry;
    if v_enquiry is null then select id into v_enquiry from public.ops_enquiry_associations where source_system='chatwoot' and source_id='conversation:'||encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex') for update; end if;
    insert into private.ops_provider_operation_ledger(operation_key,workspace_id,provider,aggregate_type,aggregate_id,source_version,intent,provider_conversation_id_digest)
      values('chatwoot:conversation:'||encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex'),v_workspace,'chatwoot','enquiry',v_enquiry::text,1,jsonb_build_object('accountId',p_account_id,'inboxId',p_inbox_id),encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex')) on conflict(operation_key) do nothing;
    update private.ops_provider_operation_ledger set provider_conversation_id_ciphertext=left(p_conversation_ciphertext,2048), provider_conversation_id_digest=encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex') where operation_key='chatwoot:conversation:'||encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex');
  end if;
  update private.ops_provider_operation_ledger set provider_conversation_id_ciphertext=left(p_conversation_ciphertext,2048), provider_conversation_id_digest=encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex') where aggregate_type='enquiry' and aggregate_id=v_enquiry::text and provider='chatwoot';
  select payload_hash into v_existing from private.ops_chatwoot_webhook_events where event_id=left(p_event_id,256);
  if v_existing is not null and v_existing <> p_payload_hash then raise exception 'Chatwoot webhook event hash mismatch' using errcode='22023'; end if;
  insert into private.ops_chatwoot_webhook_events(event_id,payload_hash,provider_conversation_id,event_type) values(left(p_event_id,256),p_payload_hash,p_provider_conversation_id,p_event_type) on conflict(event_id) do nothing;
  if p_event_type like 'message_%' and p_provider_message_id ~ '^[0-9]+$' and nullif(btrim(p_body),'') is not null then
    insert into private.ops_enquiry_messages(provider_message_id,workspace_id,enquiry_id,body,direction,occurred_at,sender_display,attachment_metadata) values(encode(extensions.digest(p_provider_message_id,'sha256'),'hex'),v_workspace,v_enquiry,left(p_body,4000),'incoming',coalesce(p_occurred_at::timestamptz,now()),left(p_sender_display,256),coalesce(p_attachments,'[]'::jsonb)) on conflict(provider_message_id) do nothing;
  end if;
  if p_status in ('open','pending','resolved','closed') then update public.ops_enquiry_associations set status=case when p_status='resolved' then 'closed' else p_status end,updated_at=now() where id=v_enquiry and workspace_id=v_workspace; end if;
  update private.ops_chatwoot_webhook_events set status='processed',processed_at=now() where event_id=left(p_event_id,256);
  return jsonb_build_object('status','processed','workspaceId',v_workspace::text,'enquiryId',v_enquiry::text);
end; $$;
revoke all on function public.record_ops_chatwoot_webhook_adopt(text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_ops_chatwoot_webhook_adopt(text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb) to service_role;

create or replace function public.resolve_ops_enquiry_threads()
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('enquiry_id',m.enquiry_id,'messages',m.messages)), '[]'::jsonb)
  from (select e.enquiry_id, jsonb_agg(jsonb_build_object('id',e.provider_message_id,'body',e.body,'direction',e.direction,'occurred_at',e.occurred_at,'sender',e.sender_display,'attachments',e.attachment_metadata) order by e.occurred_at desc, e.provider_message_id desc) filter (where e.rn <= 50) messages
        from (select m.*, row_number() over (partition by m.enquiry_id order by m.occurred_at desc, m.provider_message_id desc) rn from private.ops_enquiry_messages m) e group by e.enquiry_id) m;
$$;
revoke all on function public.resolve_ops_enquiry_threads() from public,anon,authenticated;
grant execute on function public.resolve_ops_enquiry_threads() to service_role;

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
revoke all on private.ops_enquiry_action_messages from public, anon, authenticated, service_role;
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
    or p_action_type not in ('team_role_change','enquiry_close','enquiry_reply','enquiry_reopen','flow_enroll','flow_pause','flow_resume','consent_grant','consent_withdraw','consent_unsubscribe','suppression_add','suppression_remove')
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
revoke all on function public.execute_ops_customer_action(uuid,uuid,uuid,text,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.execute_ops_customer_action(uuid,uuid,uuid,text,bigint,uuid,jsonb) to service_role;
commit;
