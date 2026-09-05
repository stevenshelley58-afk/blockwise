-- Versioned operator action intent contract for Frank/Hermes.
--
-- This migration stores bounded, provider-neutral operator intents only. It
-- does not execute customer mutations or call providers. Actions without a
-- registered Blockwise capability are durably recorded as rejected with a
-- capability reason so no future worker can mistake them for implemented work.
--
-- Rollback is forward-only after deployment. To retire this contract, freeze
-- action writers, archive current rows from ops_action_outbox,
-- ops_action_receipts, and ops_action_capabilities into
-- legacy_archive.customer_operations_action_<run_id>, verify per-run row
-- counts, then use a separately reviewed migration to revoke RPC grants and
-- drop the tables. Never delete queued or immutable receipts in place.

begin;

create table if not exists public.ops_action_capabilities (
  action_type text primary key check (action_type in (
    'team_invite', 'team_resend', 'team_cancel', 'team_role_change', 'team_suspend', 'team_reactivate',
    'session_revoke',
    'consent_grant', 'consent_withdraw', 'consent_unsubscribe',
    'suppression_add', 'suppression_remove', 'flow_enroll', 'flow_pause', 'flow_resume',
    'enquiry_assign', 'enquiry_close', 'enquiry_reply', 'enquiry_reopen',
    'booking_cancel', 'booking_reschedule',
    'billing_reconcile', 'billing_cancel_at_period_end', 'billing_portal_link'
  )),
  capability_state text not null check (capability_state in ('available', 'capability_required', 'unsupported')),
  description text not null check (char_length(description) between 1 and 512),
  updated_at timestamptz not null default now()
);

insert into public.ops_action_capabilities (action_type, capability_state, description) values
  ('team_invite', 'available', 'existing team invitation reservation and delivery path'),
  ('team_resend', 'available', 'existing pending invitation resend path'),
  ('team_cancel', 'available', 'existing invitation cancellation RPC'),
  ('team_role_change', 'capability_required', 'operator role mutation executor is not registered'),
  ('team_suspend', 'unsupported', 'account suspension capability is not implemented'),
  ('team_reactivate', 'unsupported', 'account reactivation capability is not implemented'),
  ('session_revoke', 'available', 'existing owner-only session revocation RPC'),
  ('consent_grant', 'capability_required', 'operator consent mutation executor is not registered'),
  ('consent_withdraw', 'capability_required', 'operator consent mutation executor is not registered'),
  ('consent_unsubscribe', 'capability_required', 'operator unsubscribe executor is not registered'),
  ('suppression_add', 'capability_required', 'operator suppression mutation executor is not registered'),
  ('suppression_remove', 'capability_required', 'operator suppression mutation executor is not registered'),
  ('flow_enroll', 'capability_required', 'allowlisted Mautic flow enrollment executor is not registered'),
  ('flow_pause', 'capability_required', 'allowlisted Mautic flow pause executor is not registered'),
  ('flow_resume', 'capability_required', 'allowlisted Mautic flow resume executor is not registered'),
  ('enquiry_assign', 'available', 'existing explicit enquiry association RPC'),
  ('enquiry_close', 'capability_required', 'operator enquiry close executor is not registered'),
  ('enquiry_reply', 'capability_required', 'operator reply executor is not registered'),
  ('enquiry_reopen', 'capability_required', 'operator reopen executor is not registered'),
  ('booking_cancel', 'capability_required', 'operator booking cancellation executor is not registered'),
  ('booking_reschedule', 'capability_required', 'operator booking reschedule executor is not registered'),
  ('billing_reconcile', 'available', 'existing billing reconciliation path'),
  ('billing_cancel_at_period_end', 'capability_required', 'operator cancellation executor is not registered'),
  ('billing_portal_link', 'capability_required', 'operator billing portal-link executor is not registered')
on conflict (action_type) do update set capability_state = excluded.capability_state,
  description = excluded.description, updated_at = now();

create table if not exists public.ops_action_outbox (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique,
  idempotency_key text not null unique,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  customer_id uuid not null references public.workspaces (id) on delete cascade,
  actor_operator_id uuid not null references public.profiles (id),
  actor_role text not null check (actor_role in ('owner', 'support')),
  actor_aal text not null check (actor_aal = 'aal2'),
  action_type text not null check (action_type in (
    'team_invite', 'team_resend', 'team_cancel', 'team_role_change', 'team_suspend', 'team_reactivate',
    'session_revoke',
    'consent_grant', 'consent_withdraw', 'consent_unsubscribe',
    'suppression_add', 'suppression_remove', 'flow_enroll', 'flow_pause', 'flow_resume',
    'enquiry_assign', 'enquiry_close', 'enquiry_reply', 'enquiry_reopen',
    'booking_cancel', 'booking_reschedule',
    'billing_reconcile', 'billing_cancel_at_period_end', 'billing_portal_link'
  )),
  target_type text not null check (target_type in ('workspace', 'invitation', 'profile', 'session', 'enquiry', 'booking', 'billing')),
  target_id uuid not null,
  expected_version bigint not null check (expected_version > 0),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'expired', 'superseded', 'rejected')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 25),
  run_after timestamptz not null default now(),
  expires_at timestamptz not null,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  superseded_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (customer_id = workspace_id),
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  check ((lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)),
  check (last_error is null or char_length(last_error) <= 512),
  check (not (payload ?| array['authorization', 'cookie', 'password', 'secret', 'token', 'raw_payload', 'portalUrl', 'url']))
);

create index if not exists ops_action_outbox_claim_idx
  on public.ops_action_outbox (run_after, created_at, id)
  where status = 'pending';
create index if not exists ops_action_outbox_target_version_idx
  on public.ops_action_outbox (workspace_id, target_type, target_id, expected_version desc);

create table if not exists public.ops_action_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.ops_action_outbox (action_id) on delete restrict,
  status text not null check (status in ('pending', 'processing', 'completed', 'failed', 'expired', 'superseded', 'rejected')),
  safe_result jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_result) = 'object'),
  safe_error text check (safe_error is null or char_length(safe_error) <= 512),
  created_at timestamptz not null default now(),
  unique (action_id, status)
);
create index if not exists ops_action_receipts_action_idx
  on public.ops_action_receipts (action_id, created_at desc);

alter table public.ops_action_capabilities enable row level security;
alter table public.ops_action_outbox enable row level security;
alter table public.ops_action_receipts enable row level security;
revoke all on public.ops_action_capabilities, public.ops_action_outbox, public.ops_action_receipts from public, anon, authenticated;
revoke insert, update, delete on public.ops_action_outbox from service_role;
revoke insert, update, delete on public.ops_action_receipts from service_role;
grant select on public.ops_action_capabilities, public.ops_action_outbox, public.ops_action_receipts to service_role;

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
    return p_payload ->> 'topic' is null or char_length(p_payload ->> 'topic') between 1 and 128;
  elsif p_action_type in ('suppression_add', 'suppression_remove') then
    return char_length(coalesce(p_payload ->> 'reason', '')) between 1 and 500;
  elsif p_action_type = 'enquiry_assign' then
    return p_payload ? 'assigneeProfileId' and (p_payload -> 'assigneeProfileId' = 'null'::jsonb or (p_payload ->> 'assigneeProfileId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
  elsif p_action_type = 'enquiry_reply' then
    return char_length(coalesce(p_payload ->> 'body', '')) between 1 and 4000;
  elsif p_action_type = 'booking_reschedule' then
    return (p_payload ->> 'scheduledStartAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
      and (p_payload ->> 'scheduledEndAt' is null or (p_payload ->> 'scheduledEndAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$');
  elsif p_action_type = 'billing_cancel_at_period_end' then
    return jsonb_typeof(p_payload -> 'cancelAtPeriodEnd') = 'boolean';
  end if;
  return jsonb_object_length(p_payload) = 0;
end;
$$;

create or replace function public.ops_action_result_is_safe(p_result jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p_result is not null
    and jsonb_typeof(p_result) = 'object'
    and char_length(p_result::text) <= 4096
    and p_result::text !~* '(https?://|portal|provider|external[_-]?id|authorization|bearer|token|secret|password|cookie|raw[_-]?payload)';
$$;

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
  on conflict (action_id, status) do nothing returning receipt_id into v_receipt_id;
  if v_receipt_id is not null then
    insert into public.audit_logs (workspace_id, actor_profile_id, action, target_type, target_id, correlation_id, metadata)
    values (v_workspace_id, v_actor_id, 'ops.action.' || p_status, 'ops_action', p_action_id, p_action_id::text,
      jsonb_build_object('actionType', v_action_type, 'status', p_status, 'receiptId', v_receipt_id::text));
  end if;
  return coalesce(v_receipt_id, (select receipt_id from public.ops_action_receipts where action_id = p_action_id and status = p_status));
end;
$$;

create or replace function public.ops_action_receipts_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'operations action receipts are immutable' using errcode = '42501';
end;
$$;
drop trigger if exists ops_action_receipts_immutable on public.ops_action_receipts;
create trigger ops_action_receipts_immutable before update or delete on public.ops_action_receipts
  for each row execute function public.ops_action_receipts_immutable();

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
      'consent_grant', 'consent_withdraw', 'consent_unsubscribe', 'suppression_add', 'suppression_remove', 'flow_enroll', 'flow_pause', 'flow_resume',
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

create or replace function public.claim_ops_action(p_lease_seconds integer default 600)
returns table (
  id uuid, action_id uuid, workspace_id uuid, customer_id uuid, actor_operator_id uuid, actor_role text,
  action_type text, target_type text, target_id uuid, expected_version bigint, reason text, payload jsonb,
  attempts integer, max_attempts integer, expires_at timestamptz, lease_token uuid
)
language sql security definer set search_path = '' as $$
  update public.ops_action_outbox as o set status = 'processing', attempts = o.attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 600), 3600))), updated_at = now()
  where o.id = (select candidate.id from public.ops_action_outbox candidate
    where candidate.status = 'pending' and candidate.run_after <= now() and candidate.expires_at > now() and candidate.attempts < candidate.max_attempts
      and not exists (select 1 from public.ops_action_outbox newer where newer.workspace_id = candidate.workspace_id and newer.target_type = candidate.target_type and newer.target_id = candidate.target_id and newer.expected_version > candidate.expected_version and newer.status not in ('rejected', 'expired', 'superseded'))
    order by candidate.run_after, candidate.created_at, candidate.id for update skip locked limit 1)
  returning o.id, o.action_id, o.workspace_id, o.customer_id, o.actor_operator_id, o.actor_role,
    o.action_type, o.target_type, o.target_id, o.expected_version, o.reason, o.payload,
    o.attempts, o.max_attempts, o.expires_at, o.lease_token;
$$;

create or replace function public.heartbeat_ops_action(p_id uuid, p_lease_token uuid, p_lease_seconds integer default 600)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_action public.ops_action_outbox%rowtype;
begin
  select * into v_action from public.ops_action_outbox where id = p_id and status = 'processing' and lease_token = p_lease_token and lease_expires_at > now() for update;
  if not found then return false; end if;
  if exists (select 1 from public.ops_action_outbox newer where newer.workspace_id = v_action.workspace_id and newer.target_type = v_action.target_type and newer.target_id = v_action.target_id and newer.expected_version > v_action.expected_version and newer.status not in ('rejected', 'expired', 'superseded')) then
    update public.ops_action_outbox set status = 'superseded', superseded_at = now(), last_error = 'superseded_by_newer_action_version', lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id;
    perform public.ops_record_action_receipt(v_action.action_id, 'superseded', '{}', 'superseded_by_newer_action_version');
    return false;
  end if;
  update public.ops_action_outbox set lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 600), 3600))), updated_at = now() where id = p_id;
  return true;
end;
$$;

create or replace function public.complete_ops_action(p_id uuid, p_lease_token uuid, p_safe_result jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_action public.ops_action_outbox%rowtype;
begin
  if not public.ops_action_result_is_safe(coalesce(p_safe_result, '{}'::jsonb)) then raise exception 'operations action result is unsafe' using errcode = '22023'; end if;
  select * into v_action from public.ops_action_outbox where id = p_id and status = 'processing' and lease_token = p_lease_token and lease_expires_at > now() for update;
  if not found then return false; end if;
  if exists (select 1 from public.ops_action_outbox newer where newer.workspace_id = v_action.workspace_id and newer.target_type = v_action.target_type and newer.target_id = v_action.target_id and newer.expected_version > v_action.expected_version and newer.status not in ('rejected', 'expired', 'superseded')) then
    update public.ops_action_outbox set status = 'superseded', superseded_at = now(), last_error = 'superseded_by_newer_action_version', lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id;
    perform public.ops_record_action_receipt(v_action.action_id, 'superseded', '{}', 'superseded_by_newer_action_version');
    return false;
  end if;
  update public.ops_action_outbox set status = 'completed', completed_at = now(), lease_token = null, lease_expires_at = null, last_error = null, updated_at = now() where id = p_id;
  perform public.ops_record_action_receipt(v_action.action_id, 'completed', coalesce(p_safe_result, '{}'::jsonb), null);
  return true;
end;
$$;

create or replace function public.fail_ops_action(p_id uuid, p_lease_token uuid, p_error text, p_retryable boolean default true)
returns text language plpgsql security definer set search_path = '' as $$
declare v_action public.ops_action_outbox%rowtype; v_status text;
begin
  select * into v_action from public.ops_action_outbox where id = p_id and status = 'processing' and lease_token = p_lease_token and lease_expires_at > now() for update;
  if not found then return null; end if;
  if exists (select 1 from public.ops_action_outbox newer where newer.workspace_id = v_action.workspace_id and newer.target_type = v_action.target_type and newer.target_id = v_action.target_id and newer.expected_version > v_action.expected_version and newer.status not in ('rejected', 'expired', 'superseded')) then
    v_status := 'superseded';
  elsif p_retryable and v_action.attempts < v_action.max_attempts then
    v_status := 'pending';
  else
    v_status := 'failed';
  end if;
  update public.ops_action_outbox set status = v_status, last_error = public.redact_ops_text(p_error), run_after = case when v_status = 'pending' then now() + least(power(2, v_action.attempts) * interval '1 second', interval '10 minutes') else run_after end, superseded_at = case when v_status = 'superseded' then now() else superseded_at end, lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id;
  perform public.ops_record_action_receipt(v_action.action_id, v_status, '{}', p_error);
  return v_status;
end;
$$;

create or replace function public.reap_ops_actions()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_action public.ops_action_outbox%rowtype; v_count integer := 0;
begin
  for v_action in select * from public.ops_action_outbox
    where (status = 'processing' and lease_expires_at <= now()) or (status = 'pending' and expires_at <= now())
    for update skip locked loop
    if v_action.status = 'pending' then
      update public.ops_action_outbox set status = 'expired', last_error = 'action_expired_before_claim', updated_at = now() where id = v_action.id;
      perform public.ops_record_action_receipt(v_action.action_id, 'expired', '{}', 'action_expired_before_claim');
    elsif v_action.attempts >= v_action.max_attempts then
      update public.ops_action_outbox set status = 'failed', last_error = coalesce(v_action.last_error, 'action lease expired'), lease_token = null, lease_expires_at = null, updated_at = now() where id = v_action.id;
      perform public.ops_record_action_receipt(v_action.action_id, 'failed', '{}', coalesce(v_action.last_error, 'action lease expired'));
    else
      update public.ops_action_outbox set status = 'pending', last_error = coalesce(v_action.last_error, 'action lease expired'), run_after = now() + interval '5 seconds', lease_token = null, lease_expires_at = null, updated_at = now() where id = v_action.id;
      perform public.ops_record_action_receipt(v_action.action_id, 'pending', '{}', coalesce(v_action.last_error, 'action lease expired'));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.ops_action_payload_is_valid(text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.ops_action_result_is_safe(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.ops_record_action_receipt(uuid,text,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function public.ops_action_receipts_immutable() from public, anon, authenticated, service_role;
revoke all on function public.enqueue_ops_action(uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,bigint,text,timestamptz,timestamptz,jsonb) from public, anon, authenticated;
revoke all on function public.claim_ops_action(integer) from public, anon, authenticated;
revoke all on function public.heartbeat_ops_action(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.complete_ops_action(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.fail_ops_action(uuid,uuid,text,boolean) from public, anon, authenticated;
revoke all on function public.reap_ops_actions() from public, anon, authenticated;
grant execute on function public.enqueue_ops_action(uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,bigint,text,timestamptz,timestamptz,jsonb) to service_role;
grant execute on function public.claim_ops_action(integer) to service_role;
grant execute on function public.heartbeat_ops_action(uuid,uuid,integer) to service_role;
grant execute on function public.complete_ops_action(uuid,uuid,jsonb) to service_role;
grant execute on function public.fail_ops_action(uuid,uuid,text,boolean) to service_role;
grant execute on function public.reap_ops_actions() to service_role;

comment on table public.ops_action_outbox is 'Provider-neutral, bounded operator action intents. Mutations and leases are RPC-only; Hermes executes only registered capabilities.';
comment on table public.ops_action_receipts is 'Append-only action status receipts. Direct DML is revoked and update/delete are rejected by trigger.';

commit;
