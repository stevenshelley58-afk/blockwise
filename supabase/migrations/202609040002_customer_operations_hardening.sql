-- Customer operations hardening: explicit enquiry associations, trigger-backed
-- transactional projections, stale-version fencing, and suppression authority.
-- No provider is called by these triggers. They only append a durable row or
-- an explicit association after the source row is written in the same commit.
--
-- Rollback is executable with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ops/rollback-customer-operations.sql

begin;

create sequence if not exists public.ops_projection_source_version_seq;

create table if not exists public.ops_enquiry_associations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete set null,
  source_system text not null check (source_system in ('blockwise', 'crm', 'audit')),
  source_id text not null,
  enquiry_type text not null check (enquiry_type in ('demo_request', 'report_email_lead', 'support', 'sales', 'audit')),
  external_id text,
  status text not null default 'open' check (status in ('open', 'pending', 'resolved', 'closed')),
  subject text,
  requester_email text,
  requester_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_id),
  check (char_length(source_id) between 1 and 256),
  check (external_id is null or char_length(external_id) <= 256),
  check (subject is null or char_length(subject) <= 512),
  check (requester_email is null or char_length(requester_email) between 3 and 320),
  check (requester_name is null or char_length(requester_name) <= 256)
);
alter table public.ops_enquiry_associations drop constraint if exists ops_enquiry_associations_enquiry_type_check;
alter table public.ops_enquiry_associations add constraint ops_enquiry_associations_enquiry_type_check
  check (enquiry_type in ('demo_request', 'report_email_lead', 'support', 'sales', 'audit'));
create index if not exists ops_enquiry_associations_workspace_idx
  on public.ops_enquiry_associations (workspace_id, created_at desc, id desc);
create index if not exists ops_enquiry_associations_public_idx
  on public.ops_enquiry_associations (created_at desc, id desc);
alter table public.ops_enquiry_associations enable row level security;
revoke all on public.ops_enquiry_associations from public, anon, authenticated;
grant select, insert, update on public.ops_enquiry_associations to service_role;

-- All operation identifiers and persisted errors are bounded. This function is
-- deliberately conservative: it removes credentials and caps worker text so
-- provider responses cannot become a second secret store.
create or replace function public.redact_ops_text(p_value text)
returns text language sql immutable set search_path = '' as $$
  select left(regexp_replace(
    coalesce(p_value, ''),
    '(?i)(authorization|bearer|token|secret|password|api[_-]?key|cookie)[[:space:]]*[:=]?[[:space:]]*[^,;[:space:]]+',
    '\1=[redacted]', 'g'), 512);
$$;

create or replace function public.ops_payload_is_safe(p_value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_entry record;
begin
  if p_value is null then return true; end if;
  if jsonb_typeof(p_value) = 'object' then
    for v_entry in select key, value from jsonb_each(p_value) loop
      if v_entry.key ~* '(token|secret|password|authorization|cookie|api[_-]?key|raw[_-]?payload|metadata|headers)' then return false; end if;
      if jsonb_typeof(v_entry.value) in ('object','array') and not public.ops_payload_is_safe(v_entry.value) then return false; end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_entry in select value from jsonb_array_elements(p_value) loop
      if jsonb_typeof(v_entry.value) in ('object','array') and not public.ops_payload_is_safe(v_entry.value) then return false; end if;
    end loop;
  end if;
  return true;
end;
$$;

alter table public.ops_projection_outbox
  add column if not exists superseded_at timestamptz;
-- Existing installations may contain longer provider errors from before this
-- contract. Normalize them before installing the bounded constraint.
update public.ops_projection_outbox
set last_error = public.redact_ops_text(last_error)
where last_error is not null and char_length(last_error) > 512;
alter table public.ops_projection_outbox
  drop constraint if exists ops_projection_outbox_identifier_length_check;
alter table public.ops_projection_outbox
  add constraint ops_projection_outbox_identifier_length_check check (
    char_length(aggregate_id) <= 256 and char_length(source_event_id) <= 256
    and char_length(idempotency_key) <= 1024
    and (last_error is null or char_length(last_error) <= 512)
  );

create or replace function public.enqueue_ops_projection(
  p_workspace_id uuid, p_provider text, p_aggregate_type text,
  p_aggregate_id text, p_operation text, p_source_event_id text,
  p_source_version bigint, p_payload jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_id uuid;
  v_key text;
begin
  if p_workspace_id is null or p_provider not in ('mautic', 'chatwoot')
    or p_aggregate_type not in ('contact', 'lifecycle', 'enquiry', 'support')
    or p_operation <> 'upsert' or nullif(btrim(p_aggregate_id), '') is null
    or nullif(btrim(p_source_event_id), '') is null
    or char_length(p_aggregate_id) > 256 or char_length(p_source_event_id) > 256
    or p_source_version is null or p_source_version < 1
  then raise exception 'invalid operations projection identity' using errcode = '22023'; end if;
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'operations projection payload must be a JSON object' using errcode = '22023';
  end if;
  if not public.ops_payload_is_safe(v_payload) then
    raise exception 'operations projection payload contains a forbidden field' using errcode = '22023';
  end if;
  if nullif(v_payload ->> 'workspaceId', '') is not null and v_payload ->> 'workspaceId' <> p_workspace_id::text then
    raise exception 'operations projection workspace mismatch' using errcode = '22023';
  end if;
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id) then
    raise exception 'operations projection workspace does not exist' using errcode = '23503';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_provider || ':' || p_aggregate_type || ':' || p_aggregate_id || ':' || p_operation, 0));
  select id into v_id from public.ops_projection_outbox
   where workspace_id = p_workspace_id and provider = p_provider and aggregate_type = p_aggregate_type
     and aggregate_id = p_aggregate_id and operation = p_operation and source_version >= p_source_version
   order by source_version desc, created_at desc limit 1;
  if found then return v_id; end if;
  v_payload := v_payload || jsonb_build_object('workspaceId', p_workspace_id::text);
  v_key := left(p_provider || ':' || p_workspace_id::text || ':' || p_aggregate_type || ':' || p_aggregate_id || ':' || p_operation || ':' || p_source_event_id, 1024);
  update public.ops_projection_outbox set status = 'completed', completed_at = now(), superseded_at = now(),
    last_error = 'superseded_by_newer_source_version', updated_at = now(), lease_token = null, lease_expires_at = null
   where workspace_id = p_workspace_id and provider = p_provider and aggregate_type = p_aggregate_type
     and aggregate_id = p_aggregate_id and operation = p_operation and source_version < p_source_version and status in ('pending', 'processing');
  insert into public.ops_projection_outbox (workspace_id, provider, aggregate_type, aggregate_id, operation, source_event_id, source_version, idempotency_key, payload)
   values (p_workspace_id, p_provider, p_aggregate_type, p_aggregate_id, p_operation, p_source_event_id, p_source_version, v_key, v_payload)
   on conflict (idempotency_key) do update set updated_at = now() returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.claim_ops_projection(p_provider text default null, p_lease_seconds integer default 600)
returns table (id uuid, workspace_id uuid, provider text, aggregate_type text, aggregate_id text, operation text,
  source_event_id text, source_version bigint, payload jsonb, attempts integer, max_attempts integer, lease_token uuid)
language sql security definer set search_path = '' as $$
  update public.ops_projection_outbox as o set status = 'processing', attempts = o.attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 600), 3600))), updated_at = now()
   where o.id = (select candidate.id from public.ops_projection_outbox candidate
     where candidate.status = 'pending' and candidate.run_after <= now() and candidate.attempts < candidate.max_attempts
       and (p_provider is null or candidate.provider = p_provider)
       and not exists (select 1 from public.ops_projection_outbox newer where newer.workspace_id = candidate.workspace_id
         and newer.provider = candidate.provider and newer.aggregate_type = candidate.aggregate_type and newer.aggregate_id = candidate.aggregate_id
         and newer.operation = candidate.operation and newer.source_version > candidate.source_version)
     order by candidate.run_after, candidate.created_at, candidate.id for update skip locked limit 1)
   returning o.id, o.workspace_id, o.provider, o.aggregate_type, o.aggregate_id, o.operation, o.source_event_id,
     o.source_version, o.payload, o.attempts, o.max_attempts, o.lease_token;
$$;

create or replace function public.complete_ops_projection(p_workspace_id uuid, p_id uuid, p_lease_token uuid)
returns boolean language sql security definer set search_path = '' as $$
  with settled as (update public.ops_projection_outbox o set status = 'completed', completed_at = now(), updated_at = now(), lease_token = null, lease_expires_at = null, last_error = null
   where o.id = p_id and o.workspace_id = p_workspace_id and o.status = 'processing' and o.lease_token = p_lease_token and o.lease_expires_at > now()
     and not exists (select 1 from public.ops_projection_outbox newer where newer.workspace_id = o.workspace_id and newer.provider = o.provider
       and newer.aggregate_type = o.aggregate_type and newer.aggregate_id = o.aggregate_id and newer.operation = o.operation and newer.source_version > o.source_version)
   returning 1) select exists(select 1 from settled);
$$;

create or replace function public.heartbeat_ops_projection(p_workspace_id uuid, p_id uuid, p_lease_token uuid, p_lease_seconds integer default 600)
returns boolean language sql security definer set search_path = '' as $$
  with touched as (update public.ops_projection_outbox o set lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 600), 3600))), updated_at = now()
   where o.id = p_id and o.workspace_id = p_workspace_id and o.status = 'processing' and o.lease_token = p_lease_token and o.lease_expires_at > now()
     and not exists (select 1 from public.ops_projection_outbox newer where newer.workspace_id = o.workspace_id and newer.provider = o.provider
       and newer.aggregate_type = o.aggregate_type and newer.aggregate_id = o.aggregate_id and newer.operation = o.operation and newer.source_version > o.source_version)
   returning 1) select exists(select 1 from touched);
$$;

create or replace function public.fail_ops_projection(p_workspace_id uuid, p_id uuid, p_lease_token uuid, p_error text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_row public.ops_projection_outbox%rowtype;
begin
  select * into v_row from public.ops_projection_outbox o where o.id = p_id and o.workspace_id = p_workspace_id and o.status = 'processing'
    and o.lease_token = p_lease_token and o.lease_expires_at > now()
    and not exists (select 1 from public.ops_projection_outbox newer where newer.workspace_id = o.workspace_id and newer.provider = o.provider
      and newer.aggregate_type = o.aggregate_type and newer.aggregate_id = o.aggregate_id and newer.operation = o.operation and newer.source_version > o.source_version)
    for update;
  if not found then return null; end if;
  if v_row.attempts >= v_row.max_attempts then
    update public.ops_projection_outbox set status = 'failed', last_error = public.redact_ops_text(p_error), lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id;
    return 'failed';
  end if;
  update public.ops_projection_outbox set status = 'pending', last_error = public.redact_ops_text(p_error), run_after = now() + least(power(2, v_row.attempts) * interval '1 second', interval '10 minutes'), lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id;
  return 'pending';
end;
$$;

create or replace function public.can_send_marketing(p_workspace_id uuid, p_email text, p_topic text)
returns table (allowed boolean, reason text) language sql security definer set search_path = '' as $$
  select case when p_workspace_id is null or nullif(lower(btrim(p_email)), '') is null then false
    when pref.id is null then false when exists (select 1 from public.email_suppressions s where lower(s.email) = lower(btrim(p_email))) then false
    when pref.suppressed then false when pref.unsubscribed_at is not null then false when pref.marketing_consent <> 'granted' then false
    when nullif(lower(btrim(p_topic)), '') is null or not exists (select 1 from unnest(pref.topics) t(topic) where lower(t.topic) = lower(btrim(p_topic))) then false else true end,
  case when pref.id is null then 'no_consent_record' when exists (select 1 from public.email_suppressions s where lower(s.email) = lower(btrim(p_email))) then 'suppressed'
    when pref.suppressed then 'suppressed' when pref.unsubscribed_at is not null then 'unsubscribed' when pref.marketing_consent <> 'granted' then 'consent_not_granted'
    when nullif(lower(btrim(p_topic)), '') is null or not exists (select 1 from unnest(pref.topics) t(topic) where lower(t.topic) = lower(btrim(p_topic))) then 'topic_not_consented' else 'allowed' end
  from (select 1) required left join public.customer_communication_preferences pref on pref.workspace_id = p_workspace_id and lower(pref.email) = lower(btrim(p_email));
$$;

-- Explicit association event sources. A demo request has no workspace until a
-- human/CRM association is written; it is never attached by matching email.
create or replace function public.ops_record_enquiry_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'demo_requests' then
    insert into public.ops_enquiry_associations (workspace_id, source_system, source_id, enquiry_type, status, subject, requester_email, requester_name)
      values (null, 'blockwise', new.id::text, 'demo_request', 'open', 'Demo request', left(lower(btrim(new.email)), 320), left(new.name, 256)) on conflict (source_system, source_id) do nothing;
  elsif tg_table_name = 'report_email_leads' then
    insert into public.ops_enquiry_associations (workspace_id, source_system, source_id, enquiry_type, status, subject, requester_email)
      values (null, 'blockwise', new.id::text, 'report_email_lead', 'open', 'Suburb report', left(lower(btrim(new.email)), 320)) on conflict (source_system, source_id) do nothing;
  elsif tg_table_name = 'audit_logs' and new.workspace_id is not null and new.target_type in ('enquiry', 'support') and new.action <> 'ops.enquiry.associated' then
    insert into public.ops_enquiry_associations (workspace_id, source_system, source_id, enquiry_type, status, subject)
      values (new.workspace_id, 'audit', new.id::text, case when new.target_type = 'support' then 'support' else 'audit' end, 'open', left(new.action, 512)) on conflict (source_system, source_id) do nothing;
  elsif tg_table_name = 'workspace_onboarding_bookings' then
    insert into public.ops_enquiry_associations (workspace_id, source_system, source_id, enquiry_type, status, subject)
      values (new.workspace_id, 'blockwise', new.id::text, 'support', case when new.status in ('cancelled','completed') then 'closed' else 'open' end, 'Onboarding booking') on conflict (source_system, source_id) do update set workspace_id = excluded.workspace_id, status = excluded.status, updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists ops_demo_request_association on public.demo_requests;
create trigger ops_demo_request_association after insert on public.demo_requests for each row execute function public.ops_record_enquiry_association();
drop trigger if exists ops_report_email_lead_association on public.report_email_leads;
create trigger ops_report_email_lead_association after insert on public.report_email_leads for each row execute function public.ops_record_enquiry_association();
drop trigger if exists ops_audit_enquiry_association on public.audit_logs;
create trigger ops_audit_enquiry_association after insert on public.audit_logs for each row execute function public.ops_record_enquiry_association();
drop trigger if exists ops_booking_association on public.workspace_onboarding_bookings;
create trigger ops_booking_association after insert or update on public.workspace_onboarding_bookings for each row execute function public.ops_record_enquiry_association();

create or replace function public.ops_enqueue_enquiry_projection()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_version bigint;
begin
  if new.workspace_id is null then return new; end if;
  v_version := nextval('public.ops_projection_source_version_seq');
  perform public.enqueue_ops_projection(new.workspace_id, 'chatwoot', 'enquiry', new.id::text, 'upsert',
    'enquiry-association:' || new.id::text || ':' || v_version::text, v_version,
    jsonb_build_object('workspaceId', new.workspace_id::text, 'sourceEventId', new.source_id, 'sourceVersion', v_version,
      'subject', coalesce(new.subject, ''), 'status', new.status));
  return new;
end;
$$;
drop trigger if exists ops_enquiry_projection on public.ops_enquiry_associations;
create trigger ops_enquiry_projection after insert or update of workspace_id, status, subject on public.ops_enquiry_associations
  for each row execute function public.ops_enqueue_enquiry_projection();

create or replace function public.ops_enqueue_source_projection()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_version bigint := nextval('public.ops_projection_source_version_seq'); v_workspace_id uuid; v_profile_id uuid; v_email text; v_name text; v_stage text;
begin
  if tg_table_name = 'workspaces' then
    -- Workspace is the lifecycle aggregate, never a synthetic Mautic contact.
    -- Contacts are keyed only by a real profile below.
    return new;
  elsif tg_table_name = 'customer_activations' then
    v_stage := case when new.activation_completed_at is not null then 'active' when new.checkout_completed_at is not null then 'activated' when new.email_verified_at is not null then 'trial' else 'lead' end;
    perform public.enqueue_ops_projection(new.workspace_id, 'mautic', 'lifecycle', new.workspace_id::text, 'upsert', 'activation:' || new.workspace_id::text || ':' || v_version::text, v_version, jsonb_build_object('workspaceId', new.workspace_id::text, 'sourceEventId', 'activation', 'stage', v_stage));
    for v_profile_id, v_email, v_name in select p.id, p.email, p.full_name from public.workspace_members wm join public.profiles p on p.id = wm.profile_id where wm.workspace_id = new.workspace_id loop
      perform public.enqueue_ops_projection(new.workspace_id, 'mautic', 'contact', v_profile_id::text, 'upsert', 'activation-contact:' || v_profile_id::text || ':' || v_version::text, v_version, jsonb_build_object('workspaceId', new.workspace_id::text, 'sourceEventId', 'activation', 'email', left(lower(btrim(v_email)), 320), 'name', left(coalesce(v_name, ''), 512), 'activationStage', v_stage));
    end loop;
  elsif tg_table_name = 'workspace_onboarding_bookings' then
    perform public.enqueue_ops_projection(new.workspace_id, 'chatwoot', 'support', new.id::text, 'upsert', 'booking:' || new.id::text || ':' || v_version::text, v_version, jsonb_build_object('workspaceId', new.workspace_id::text, 'sourceEventId', 'booking', 'subject', 'Onboarding booking', 'status', new.status));
    for v_profile_id, v_email, v_name in select p.id, p.email, p.full_name from public.workspace_members wm join public.profiles p on p.id = wm.profile_id where wm.workspace_id = new.workspace_id loop
      perform public.enqueue_ops_projection(new.workspace_id, 'mautic', 'contact', v_profile_id::text, 'upsert', 'booking-contact:' || v_profile_id::text || ':' || v_version::text, v_version, jsonb_build_object('workspaceId', new.workspace_id::text, 'sourceEventId', 'booking', 'email', left(lower(btrim(v_email)), 320), 'name', left(coalesce(v_name, ''), 512), 'bookingSubject', 'Onboarding booking', 'bookingStatus', new.status));
    end loop;
  elsif tg_table_name = 'profiles' then
    for v_workspace_id in select wm.workspace_id from public.workspace_members wm where wm.profile_id = new.id loop
      perform public.enqueue_ops_projection(v_workspace_id, 'mautic', 'contact', new.id::text, 'upsert', 'profile:' || new.id::text || ':' || v_version::text, v_version, jsonb_build_object('workspaceId', v_workspace_id::text, 'sourceEventId', 'profile', 'email', left(lower(btrim(new.email)), 320), 'name', left(coalesce(new.full_name, ''), 512)));
    end loop;
  elsif tg_table_name = 'workspace_members' then
    select p.email, p.full_name into v_email, v_name from public.profiles p where p.id = new.profile_id;
    perform public.enqueue_ops_projection(new.workspace_id, 'mautic', 'contact', new.profile_id::text, 'upsert', 'member:' || new.workspace_id::text || ':' || new.profile_id::text || ':' || v_version::text, v_version, jsonb_build_object('workspaceId', new.workspace_id::text, 'sourceEventId', 'member', 'profileId', new.profile_id::text, 'email', left(lower(btrim(v_email)), 320), 'name', left(coalesce(v_name, ''), 512)));
  elsif tg_table_name = 'leads' then
    perform public.enqueue_ops_projection(new.workspace_id, 'chatwoot', 'enquiry', new.id::text, 'upsert', 'lead:' || new.id::text || ':' || v_version::text, v_version, jsonb_build_object('workspaceId', new.workspace_id::text, 'sourceEventId', 'lead', 'email', left(lower(coalesce(new.email, '')), 320), 'name', left(coalesce(new.full_name, ''), 512), 'status', 'open'));
  elsif tg_table_name = 'lead_events' then
    perform public.enqueue_ops_projection(new.workspace_id, 'chatwoot', 'support', new.lead_id::text, 'upsert', 'lead-event:' || new.id::text || ':' || v_version::text, v_version, jsonb_build_object('workspaceId', new.workspace_id::text, 'sourceEventId', 'lead-event', 'eventType', left(new.event_type, 128)));
  elsif tg_table_name = 'billing_offer_acceptances' then
    perform public.enqueue_ops_projection(new.workspace_id, 'mautic', 'lifecycle', new.workspace_id::text, 'upsert', 'billing:' || new.id::text || ':' || v_version::text, v_version, jsonb_build_object('workspaceId', new.workspace_id::text, 'sourceEventId', 'billing', 'stage', 'customer'));
  elsif tg_table_name = 'customer_communication_preferences' then
    perform public.enqueue_ops_projection(new.workspace_id, 'mautic', 'lifecycle', new.workspace_id::text, 'upsert', 'preference:' || new.id::text || ':' || v_version::text, v_version, jsonb_build_object('workspaceId', new.workspace_id::text, 'sourceEventId', 'preference', 'stage', case when new.marketing_consent = 'granted' then 'active' else 'unknown' end));
  end if;
  return new;
end;
$$;

drop trigger if exists ops_workspace_projection on public.workspaces;
create trigger ops_workspace_projection after insert or update on public.workspaces for each row execute function public.ops_enqueue_source_projection();
drop trigger if exists ops_activation_projection on public.customer_activations;
create trigger ops_activation_projection after insert or update on public.customer_activations for each row execute function public.ops_enqueue_source_projection();
drop trigger if exists ops_booking_projection on public.workspace_onboarding_bookings;
create trigger ops_booking_projection after insert or update on public.workspace_onboarding_bookings for each row execute function public.ops_enqueue_source_projection();
drop trigger if exists ops_profile_projection on public.profiles;
create trigger ops_profile_projection after insert or update on public.profiles for each row execute function public.ops_enqueue_source_projection();
drop trigger if exists ops_member_projection on public.workspace_members;
create trigger ops_member_projection after insert or update on public.workspace_members for each row execute function public.ops_enqueue_source_projection();
drop trigger if exists ops_lead_projection on public.leads;
create trigger ops_lead_projection after insert or update on public.leads for each row execute function public.ops_enqueue_source_projection();
drop trigger if exists ops_lead_event_projection on public.lead_events;
create trigger ops_lead_event_projection after insert or update on public.lead_events for each row execute function public.ops_enqueue_source_projection();
drop trigger if exists ops_billing_projection on public.billing_offer_acceptances;
create trigger ops_billing_projection after insert on public.billing_offer_acceptances for each row execute function public.ops_enqueue_source_projection();
drop trigger if exists ops_preference_projection on public.customer_communication_preferences;
create trigger ops_preference_projection after insert or update on public.customer_communication_preferences for each row execute function public.ops_enqueue_source_projection();

revoke all on function public.redact_ops_text(text) from public, anon, authenticated;
revoke all on function public.ops_payload_is_safe(jsonb) from public, anon, authenticated;
revoke all on function public.ops_record_enquiry_association() from public, anon, authenticated;
revoke all on function public.ops_enqueue_source_projection() from public, anon, authenticated;
revoke all on function public.ops_enqueue_enquiry_projection() from public, anon, authenticated;
grant execute on function public.enqueue_ops_projection(uuid,text,text,text,text,text,bigint,jsonb) to service_role;
grant execute on function public.claim_ops_projection(text,integer) to service_role;
grant execute on function public.complete_ops_projection(uuid,uuid,uuid) to service_role;
grant execute on function public.heartbeat_ops_projection(uuid,uuid,uuid,integer) to service_role;
grant execute on function public.fail_ops_projection(uuid,uuid,uuid,text) to service_role;
grant execute on function public.can_send_marketing(uuid,text,text) to service_role;

commit;
