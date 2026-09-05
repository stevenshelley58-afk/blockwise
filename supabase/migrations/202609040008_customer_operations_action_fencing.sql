-- Forward-only repair for action payload optionality, target binding, and
-- transition receipts. Source rows remain authoritative; an action cannot be
-- enqueued unless its target is already owned by the requested workspace.
begin;

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

alter table public.ops_action_receipts
  add column if not exists transition_seq bigint generated always as identity;
alter table public.ops_action_receipts
  drop constraint if exists ops_action_receipts_action_id_status_key;
create unique index if not exists ops_action_receipts_transition_idx
  on public.ops_action_receipts (action_id, transition_seq);

create or replace function public.ops_record_action_receipt(
  p_action_id uuid, p_status text, p_safe_result jsonb default '{}'::jsonb, p_safe_error text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_receipt_id uuid;
  v_workspace_id uuid;
  v_actor_id uuid;
  v_action_type text;
begin
  if p_status not in ('pending', 'processing', 'completed', 'failed', 'expired', 'superseded', 'rejected')
    or not public.ops_action_result_is_safe(coalesce(p_safe_result, '{}'::jsonb))
  then raise exception 'invalid operations action receipt' using errcode = '22023'; end if;
  select workspace_id, actor_operator_id, action_type into v_workspace_id, v_actor_id, v_action_type
  from public.ops_action_outbox where action_id = p_action_id;
  if not found then raise exception 'operations action does not exist' using errcode = '23503'; end if;
  insert into public.ops_action_receipts (action_id, status, safe_result, safe_error)
  values (p_action_id, p_status, coalesce(p_safe_result, '{}'::jsonb), case when p_safe_error is null then null else public.redact_ops_text(p_safe_error) end)
  returning receipt_id into v_receipt_id;
  insert into public.audit_logs (workspace_id, actor_profile_id, action, target_type, target_id, correlation_id, metadata)
  values (v_workspace_id, v_actor_id, 'ops.action.' || p_status, 'ops_action', p_action_id, p_action_id::text,
    jsonb_build_object('actionType', v_action_type, 'status', p_status, 'receiptId', v_receipt_id::text));
  return v_receipt_id;
end;
$$;

create or replace function public.ops_action_target_binding()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_exists boolean := false;
begin
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
  elsif new.action_type in ('enquiry_assign', 'enquiry_close', 'enquiry_reply') then
    v_exists := new.target_type = 'enquiry'
      and exists (select 1 from public.ops_enquiry_associations where id = new.target_id and workspace_id = new.workspace_id for update);
  elsif new.action_type in ('booking_cancel', 'booking_reschedule') then
    v_exists := new.target_type = 'booking'
      and exists (select 1 from public.workspace_onboarding_bookings where id = new.target_id and workspace_id = new.workspace_id for update);
  end if;
  if not v_exists then
    raise exception 'operations action target is not owned by workspace' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists ops_action_target_binding on public.ops_action_outbox;
create trigger ops_action_target_binding before insert on public.ops_action_outbox
  for each row execute function public.ops_action_target_binding();

create or replace function public.ops_action_processing_receipt()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status is distinct from new.status and new.status = 'processing' then
    perform public.ops_record_action_receipt(new.action_id, 'processing', '{}', null);
  end if;
  return new;
end;
$$;
drop trigger if exists ops_action_processing_receipt on public.ops_action_outbox;
create trigger ops_action_processing_receipt after update of status on public.ops_action_outbox
  for each row execute function public.ops_action_processing_receipt();

revoke insert, update, delete on public.ops_action_capabilities from service_role;
grant select on public.ops_action_capabilities to service_role;
revoke all on function public.ops_action_target_binding() from public, anon, authenticated, service_role;
revoke all on function public.ops_action_processing_receipt() from public, anon, authenticated, service_role;
revoke all on function public.ops_action_payload_is_valid(text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.ops_record_action_receipt(uuid,text,jsonb,text) from public, anon, authenticated, service_role;
comment on table public.ops_action_receipts is 'Append-only action transition receipts. Each status transition receives a monotonic transition_seq and audit row; direct DML is revoked.';

commit;
