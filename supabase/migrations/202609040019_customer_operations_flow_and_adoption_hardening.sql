-- Customer-operations flow-action and adoption hardening.
--
-- Production databases already recorded migration 202609040018 in an earlier
-- form, so the remaining deltas ship here as idempotent create-or-replace
-- statements:
--   1. enqueue_ops_action accepts the three Mautic flow actions.
--   2. ops_action_payload_is_valid validates the flowId alias payload.
--   3. Adopted Chatwoot conversations can never be rebound across tenants.
--   4. Published thread senders match Frank's strict projection schema.
begin;

create or replace function public.enqueue_ops_action(
  p_action_id uuid, p_idempotency_key text, p_workspace_id uuid, p_customer_id uuid,
  p_action_type text, p_target_type text, p_target_id uuid,
  p_actor_operator_id uuid, p_actor_role text, p_actor_aal text,
  p_expected_version bigint, p_reason text, p_created_at timestamptz,
  p_expires_at timestamptz, p_payload jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_existing_action_id uuid;
  v_existing_version bigint;
  v_capability text;
  v_status text := 'pending';
  v_error text := null;
  v_operator boolean;
  v_operator_role text;
  v_old record;
begin
  if p_action_id is null or nullif(btrim(p_idempotency_key), '') is null or char_length(p_idempotency_key) > 256
    or p_workspace_id is null or p_customer_id is distinct from p_workspace_id or p_target_id is null
    or p_idempotency_key <> btrim(p_idempotency_key) or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:._/-]*$'
    or p_action_type is null or p_action_type not in (
      'team_invite', 'team_resend', 'team_cancel', 'team_role_change', 'team_suspend', 'team_reactivate', 'session_revoke',
      'consent_grant', 'consent_withdraw', 'consent_unsubscribe', 'suppression_add', 'suppression_remove',
      'flow_enroll', 'flow_pause', 'flow_resume',
    'enquiry_assign', 'enquiry_close', 'enquiry_reply', 'enquiry_reopen', 'booking_cancel', 'booking_reschedule',
      'billing_reconcile', 'billing_cancel_at_period_end', 'billing_portal_link'
    )
    or p_target_type is null or p_target_type not in ('workspace', 'invitation', 'profile', 'session', 'enquiry', 'booking', 'billing')
    or p_actor_operator_id is null or p_actor_role is null or p_actor_role not in ('owner', 'support') or p_actor_aal is null or p_actor_aal <> 'aal2'
    or p_expected_version is null or p_expected_version < 1
    or nullif(btrim(p_reason), '') is null or char_length(p_reason) > 500
    or p_created_at is null or p_expires_at is null or p_expires_at <= p_created_at
    or p_expires_at > p_created_at + interval '24 hours'
  then raise exception 'invalid operations action identity' using errcode = '22023'; end if;
  if p_action_type = 'team_invite' and p_target_type <> 'workspace' then raise exception 'invalid operations action target' using errcode = '22023'; end if;
  if p_action_type in ('team_resend', 'team_cancel') and p_target_type <> 'invitation' then raise exception 'invalid operations action target' using errcode = '22023'; end if;
  if p_action_type in ('team_role_change', 'team_suspend', 'team_reactivate', 'consent_grant', 'consent_withdraw', 'consent_unsubscribe', 'suppression_add', 'suppression_remove', 'flow_enroll', 'flow_pause', 'flow_resume') and p_target_type <> 'profile' then raise exception 'invalid operations action target' using errcode = '22023'; end if;
  if p_action_type = 'session_revoke' and p_target_type <> 'session' then raise exception 'invalid operations action target' using errcode = '22023'; end if;
  if p_action_type in ('enquiry_assign', 'enquiry_close', 'enquiry_reply', 'enquiry_reopen') and p_target_type <> 'enquiry' then raise exception 'invalid operations action target' using errcode = '22023'; end if;
  if p_action_type in ('booking_cancel', 'booking_reschedule') and p_target_type <> 'booking' then raise exception 'invalid operations action target' using errcode = '22023'; end if;
  if p_action_type in ('billing_reconcile', 'billing_cancel_at_period_end', 'billing_portal_link') and p_target_type <> 'billing' then raise exception 'invalid operations action target' using errcode = '22023'; end if;
  if p_action_type in ('team_role_change', 'team_suspend', 'team_reactivate', 'session_revoke', 'billing_cancel_at_period_end') and p_actor_role <> 'owner' then raise exception 'owner_role_required' using errcode = '42501'; end if;
  if not public.ops_action_payload_is_valid(p_action_type, coalesce(p_payload, '{}'::jsonb)) then raise exception 'operations action payload is invalid' using errcode = '22023'; end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then raise exception 'operations action workspace does not exist' using errcode = '23503'; end if;
  select is_operator, operator_role into v_operator, v_operator_role from public.profiles where id = p_actor_operator_id;
  if not coalesce(v_operator, false) or v_operator_role is distinct from p_actor_role then raise exception 'operator provenance is invalid' using errcode = '42501'; end if;
  select id, action_id into v_id, v_existing_action_id from public.ops_action_outbox where idempotency_key = p_idempotency_key;
  if found then
    if v_existing_action_id <> p_action_id then raise exception 'idempotency key is already bound to another action' using errcode = '23505'; end if;
    return v_id;
  end if;
  select id into v_id from public.ops_action_outbox where action_id = p_action_id;
  if found then raise exception 'action_id is already in use' using errcode = '23505'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_target_type || ':' || p_target_id::text, 0));
  select expected_version into v_existing_version
  from public.ops_action_outbox
  where workspace_id = p_workspace_id and target_type = p_target_type and target_id = p_target_id
    and status not in ('rejected', 'expired', 'superseded') and expected_version >= p_expected_version
  order by expected_version desc, created_at desc limit 1;
  if found then raise exception 'operations action version conflict' using errcode = '40001'; end if;

  for v_old in select action_id from public.ops_action_outbox
    where workspace_id = p_workspace_id and target_type = p_target_type and target_id = p_target_id
      and expected_version < p_expected_version and status in ('pending', 'processing')
    for update loop
    update public.ops_action_outbox set status = 'superseded', superseded_at = now(), last_error = 'superseded_by_newer_action_version', lease_token = null, lease_expires_at = null, updated_at = now() where action_id = v_old.action_id;
    perform public.ops_record_action_receipt(v_old.action_id, 'superseded', '{}', 'superseded_by_newer_action_version');
  end loop;
  select capability_state into v_capability from public.ops_action_capabilities where action_type = p_action_type;
  if v_capability is null then raise exception 'operations action capability is not registered' using errcode = '22023'; end if;
  if v_capability <> 'available' then v_status := 'rejected'; v_error := v_capability; end if;
  insert into public.ops_action_outbox (action_id, idempotency_key, workspace_id, customer_id, actor_operator_id, actor_role, actor_aal, action_type, target_type, target_id, expected_version, reason, payload, status, last_error, created_at, expires_at, run_after)
  values (p_action_id, p_idempotency_key, p_workspace_id, p_customer_id, p_actor_operator_id, p_actor_role, p_actor_aal, p_action_type, p_target_type, p_target_id, p_expected_version, public.redact_ops_text(p_reason), coalesce(p_payload, '{}'::jsonb), v_status, v_error, p_created_at, p_expires_at, p_created_at);
  select id into v_id from public.ops_action_outbox where action_id = p_action_id;
  perform public.ops_record_action_receipt(p_action_id, v_status, '{}', v_error);
  return v_id;
end;
$$;

revoke all on function public.enqueue_ops_action(uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,bigint,text,timestamp with time zone,timestamp with time zone,jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_ops_action(uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,bigint,text,timestamp with time zone,timestamp with time zone,jsonb) to service_role;

create or replace function public.ops_action_payload_is_valid(p_action_type text, p_payload jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_allowed text[];
  v_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or not public.ops_payload_is_safe(p_payload) then return false; end if;
  v_allowed := case p_action_type
    when 'team_invite' then array['email', 'role']
    when 'team_role_change' then array['role']
    when 'consent_grant' then array['topic']
    when 'consent_withdraw' then array['topic']
    when 'suppression_add' then array['reason']
    when 'suppression_remove' then array['reason']
    when 'flow_enroll' then array['flowId']
    when 'flow_pause' then array['flowId']
    when 'flow_resume' then array['flowId']
    when 'enquiry_assign' then array['assigneeProfileId']
    when 'enquiry_reply' then array['body']
    when 'booking_reschedule' then array['scheduledStartAt', 'scheduledEndAt']
    when 'billing_cancel_at_period_end' then array['cancelAtPeriodEnd']
    else array[]::text[]
  end;
  for v_key in select jsonb_object_keys(p_payload) loop
    if not (v_key = any(v_allowed)) then return false; end if;
  end loop;
  if exists (select 1 from jsonb_each(p_payload) where jsonb_typeof(value) not in ('string', 'boolean', 'null')) then return false; end if;
  if p_action_type = 'team_invite' then
    return nullif(btrim(p_payload ->> 'email'), '') is not null
      and char_length(p_payload ->> 'email') <= 320
      and position('@' in p_payload ->> 'email') > 1
      and p_payload ->> 'role' in ('admin', 'member', 'viewer');
  elsif p_action_type = 'team_role_change' then
    return p_payload ->> 'role' in ('admin', 'member', 'viewer');
  elsif p_action_type = 'consent_grant' then
    return char_length(coalesce(p_payload ->> 'topic', '')) between 1 and 128;
  elsif p_action_type = 'consent_withdraw' then
    return not (p_payload ? 'topic')
      or (jsonb_typeof(p_payload -> 'topic') = 'string' and char_length(p_payload ->> 'topic') between 1 and 128);
  elsif p_action_type in ('suppression_add', 'suppression_remove') then
    return char_length(coalesce(p_payload ->> 'reason', '')) between 1 and 500;
  elsif p_action_type in ('flow_enroll', 'flow_pause', 'flow_resume') then
    return char_length(coalesce(p_payload ->> 'flowId', '')) between 1 and 128
      and (p_payload ->> 'flowId') ~ '^[A-Za-z0-9._:-]+$';
  elsif p_action_type = 'enquiry_assign' then
    return p_payload ? 'assigneeProfileId' and (p_payload -> 'assigneeProfileId' = 'null'::jsonb or (p_payload ->> 'assigneeProfileId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
  elsif p_action_type = 'enquiry_reply' then
    return char_length(coalesce(p_payload ->> 'body', '')) between 1 and 4000;
  elsif p_action_type = 'booking_reschedule' then
    return (p_payload ->> 'scheduledStartAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
      and (not (p_payload ? 'scheduledEndAt') or (jsonb_typeof(p_payload -> 'scheduledEndAt') = 'string' and (p_payload ->> 'scheduledEndAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'));
  elsif p_action_type = 'billing_cancel_at_period_end' then
    return jsonb_typeof(p_payload -> 'cancelAtPeriodEnd') = 'boolean';
  end if;
  return (select count(*) from jsonb_object_keys(p_payload)) = 0;
end;
$$;

revoke all on function public.ops_action_payload_is_valid(text,jsonb) from public, anon, authenticated, service_role;

create or replace function public.record_ops_chatwoot_webhook_adopt(
  p_event_id text, p_payload_hash text, p_account_id text, p_inbox_id text,
  p_event_type text, p_provider_conversation_id text, p_provider_message_id text,
  p_contact_id_digest text, p_conversation_ciphertext text, p_status text, p_body text,
  p_occurred_at text default null, p_sender_display text default null, p_attachments jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_enquiry uuid; v_existing text; v_updated integer;
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
    if v_enquiry is null then select id into v_enquiry from public.ops_enquiry_associations where source_system='chatwoot' and source_id='conversation:'||encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex') and workspace_id is not distinct from v_workspace for update; end if;
    -- A conversation is bound to exactly one tenant. If it already belongs to a
    -- different workspace (or to the global queue while a workspace contact is
    -- claiming it), ignore the delivery rather than rebinding it across tenants.
    if v_enquiry is null and exists (
      select 1 from public.ops_enquiry_associations e
        where e.source_system='chatwoot' and e.source_id='conversation:'||encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex')
          and e.workspace_id is distinct from v_workspace
    ) then return jsonb_build_object('status','ignored','rebound',false); end if;
    insert into private.ops_provider_operation_ledger(operation_key,workspace_id,provider,aggregate_type,aggregate_id,source_version,intent,provider_conversation_id_digest)
      values('chatwoot:conversation:'||encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex'),v_workspace,'chatwoot','enquiry',v_enquiry::text,1,jsonb_build_object('accountId',p_account_id,'inboxId',p_inbox_id),encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex')) on conflict(operation_key) do nothing;
    update private.ops_provider_operation_ledger set provider_conversation_id_ciphertext=left(p_conversation_ciphertext,2048), provider_conversation_id_digest=encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex') where operation_key='chatwoot:conversation:'||encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex');
  end if;
  update private.ops_provider_operation_ledger set provider_conversation_id_ciphertext=left(p_conversation_ciphertext,2048), provider_conversation_id_digest=encode(extensions.digest(p_provider_conversation_id,'sha256'),'hex') where aggregate_type='enquiry' and aggregate_id=v_enquiry::text and provider='chatwoot';
  -- Atomic replay/hash guard: insert first, then verify the stored hash. Two
  -- concurrent deliveries of the same event with different payloads can never
  -- both pass, because only one insert wins and the loser re-reads the stored
  -- hash after the conflict and raises on mismatch.
  insert into private.ops_chatwoot_webhook_events(event_id,payload_hash,provider_conversation_id,event_type) values(left(p_event_id,256),p_payload_hash,p_provider_conversation_id,p_event_type) on conflict(event_id) do nothing;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    select payload_hash into v_existing from private.ops_chatwoot_webhook_events where event_id=left(p_event_id,256);
    if v_existing is null or v_existing <> p_payload_hash then raise exception 'Chatwoot webhook event hash mismatch' using errcode='22023'; end if;
  end if;
  if p_event_type like 'message_%' and p_provider_message_id ~ '^[0-9]+$' and nullif(btrim(p_body),'') is not null then
    insert into private.ops_enquiry_messages(provider_message_id,workspace_id,enquiry_id,body,direction,occurred_at,sender_display,attachment_metadata) values(encode(extensions.digest(p_provider_message_id,'sha256'),'hex'),v_workspace,v_enquiry,left(p_body,4000),'incoming',coalesce(p_occurred_at::timestamptz,now()),left(p_sender_display,256),coalesce(p_attachments,'[]'::jsonb)) on conflict(provider_message_id) do nothing;
  end if;
  if p_status in ('open','pending','resolved','closed') then update public.ops_enquiry_associations set status=case when p_status='resolved' then 'closed' else p_status end,updated_at=now() where id=v_enquiry and workspace_id is not distinct from v_workspace; end if;
  update private.ops_chatwoot_webhook_events set status='processed',processed_at=now() where event_id=left(p_event_id,256);
  return jsonb_build_object('status','processed','workspaceId',v_workspace::text,'enquiryId',v_enquiry::text);
end; $$;

revoke all on function public.record_ops_chatwoot_webhook_adopt(text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_ops_chatwoot_webhook_adopt(text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb) to service_role;

create or replace function public.resolve_ops_enquiry_threads()
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('enquiry_id',m.enquiry_id,'messages',m.messages)), '[]'::jsonb)
  from (select e.enquiry_id, jsonb_agg(jsonb_build_object('id',e.provider_message_id,'body',e.body,'direction',e.direction,'occurred_at',e.occurred_at,'sender',left(e.sender_display,120),'attachments',e.attachment_metadata) order by e.occurred_at asc, e.provider_message_id asc) filter (where e.rn <= 50) messages
        from (select m.*, row_number() over (partition by m.enquiry_id order by m.occurred_at desc, m.provider_message_id desc) rn from private.ops_enquiry_messages m) e group by e.enquiry_id) m;
$$;

revoke all on function public.resolve_ops_enquiry_threads() from public,anon,authenticated;
grant execute on function public.resolve_ops_enquiry_threads() to service_role;


commit;
