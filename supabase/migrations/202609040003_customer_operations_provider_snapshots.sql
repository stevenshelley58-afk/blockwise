-- Normalized provider observations written by the Hermes settlement worker.
-- Provider credentials, raw IDs, headers and payloads never belong here.
-- aggregate_id/source_event_id are Blockwise envelope identities, never
-- provider-returned identifiers. The only provider identifier permitted is a
-- masked suffix containing '*'.
begin;

create table if not exists public.ops_provider_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('mautic', 'chatwoot')),
  snapshot_kind text not null check (snapshot_kind in ('delivery', 'flow', 'lifecycle', 'conversation')),
  aggregate_type text not null check (aggregate_type in ('contact', 'lifecycle', 'enquiry', 'support')),
  aggregate_id text not null,
  status text,
  stage text,
  subject text,
  channel text,
  delivery_status text,
  provider_record_suffix text,
  occurred_at timestamptz,
  last_activity_at timestamptz,
  source_event_id text not null,
  source_version bigint not null check (source_version > 0),
  safe_data jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_data) = 'object'),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, provider, snapshot_kind, aggregate_type, aggregate_id),
  check (char_length(aggregate_id) between 1 and 256),
  check (char_length(source_event_id) between 1 and 256),
  check (status is null or char_length(status) <= 64),
  check (stage is null or char_length(stage) <= 64),
  check (subject is null or char_length(subject) <= 512),
  check (channel is null or char_length(channel) <= 32),
  check (delivery_status is null or char_length(delivery_status) <= 64),
  check (provider_record_suffix is null or provider_record_suffix ~ '^[A-Za-z0-9*_-]{0,12}$')
);
create index if not exists ops_provider_snapshots_workspace_idx
  on public.ops_provider_snapshots (workspace_id, updated_at desc, id desc);
alter table public.ops_provider_snapshots enable row level security;
revoke all on public.ops_provider_snapshots from public, anon, authenticated;
grant select on public.ops_provider_snapshots to service_role;
revoke insert, update, delete on public.ops_provider_snapshots from service_role;

-- Associations are created by source triggers and changed through the audited
-- RPC below; service-role callers must not bypass that workflow with a table
-- write.
revoke insert, update, delete on public.ops_enquiry_associations from service_role;

-- Suppression is globally authoritative, while an explicit workspace link is
-- optional for projection refreshes. Reconcile case variants before enforcing
-- canonical lower(email) uniqueness. Discarded duplicates are archived first.
create schema if not exists legacy_archive;
create table if not exists legacy_archive.customer_operations_consent_reconciliation_202609040003 (
  archived_at timestamptz not null default now(),
  source_table text not null,
  row_id text not null,
  reason text not null,
  row_data jsonb not null
);
alter table public.email_suppressions add column if not exists workspace_id uuid references public.workspaces (id) on delete set null;
with ranked as (
  select id, row_number() over (partition by lower(btrim(email)), reason order by created_at desc, id desc) as rn
  from public.email_suppressions
)
insert into legacy_archive.customer_operations_consent_reconciliation_202609040003 (source_table, row_id, reason, row_data)
select 'email_suppressions', s.id::text, 'duplicate_canonical_email_reason', to_jsonb(s)
from public.email_suppressions s join ranked r on r.id = s.id where r.rn > 1;
with ranked as (
  select id, row_number() over (partition by lower(btrim(email)), reason order by created_at desc, id desc) as rn
  from public.email_suppressions
)
delete from public.email_suppressions s using ranked r where s.id = r.id and r.rn > 1;
update public.email_suppressions set email = lower(btrim(email));
create unique index if not exists email_suppressions_lower_reason_key on public.email_suppressions (lower(email), reason);

-- Preferences are also canonicalized because the marketing guard compares
-- lower(email). Keep the newest row for a workspace/address, but carry every
-- restrictive unsubscribe/suppression state forward so dedupe cannot
-- resurrect permission. Discarded rows are archived before removal.
with ranked as (
  select id, row_number() over (partition by workspace_id, lower(btrim(email)) order by updated_at desc, created_at desc, id desc) as rn
  from public.customer_communication_preferences
)
insert into legacy_archive.customer_operations_consent_reconciliation_202609040003 (source_table, row_id, reason, row_data)
select 'customer_communication_preferences', p.id::text, 'duplicate_canonical_workspace_email', to_jsonb(p)
from public.customer_communication_preferences p join ranked r on r.id = p.id where r.rn > 1;
with grouped as (
  select workspace_id, lower(btrim(email)) as email_key,
    bool_or(coalesce(suppressed, false)) as any_suppressed,
    max(unsubscribed_at) as latest_unsubscribed_at,
    bool_or(marketing_consent = 'withdrawn') as any_withdrawn,
    bool_or(marketing_consent = 'denied') as any_denied,
    max(suppression_reason) filter (where suppression_reason is not null) as any_suppression_reason
  from public.customer_communication_preferences
  group by workspace_id, lower(btrim(email))
), ranked as (
  select p.*, row_number() over (partition by workspace_id, lower(btrim(email)) order by updated_at desc, created_at desc, id desc) as rn
  from public.customer_communication_preferences p
), winners as (
  select r.id, g.any_suppressed, g.latest_unsubscribed_at, g.any_withdrawn, g.any_denied, g.any_suppression_reason
  from ranked r join grouped g on g.workspace_id = r.workspace_id and g.email_key = lower(btrim(r.email))
  where r.rn = 1
)
update public.customer_communication_preferences p set
  suppressed = p.suppressed or w.any_suppressed,
  unsubscribed_at = coalesce(p.unsubscribed_at, w.latest_unsubscribed_at),
  marketing_consent = case when w.any_withdrawn then 'withdrawn' when w.any_denied then 'denied' else p.marketing_consent end,
  suppression_reason = coalesce(p.suppression_reason, w.any_suppression_reason),
  email = lower(btrim(p.email))
from winners w where p.id = w.id;
with ranked as (
  select id, row_number() over (partition by workspace_id, lower(btrim(email)) order by updated_at desc, created_at desc, id desc) as rn
  from public.customer_communication_preferences
)
delete from public.customer_communication_preferences p using ranked r where p.id = r.id and r.rn > 1;
update public.customer_communication_preferences set email = lower(btrim(email));
create unique index if not exists customer_communication_preferences_workspace_lower_email_key
  on public.customer_communication_preferences (workspace_id, lower(email));

create or replace function public.upsert_ops_provider_snapshot(
  p_workspace_id uuid, p_provider text, p_snapshot_kind text,
  p_aggregate_type text, p_aggregate_id text, p_status text,
  p_stage text, p_subject text, p_channel text, p_delivery_status text,
  p_provider_record_suffix text, p_occurred_at timestamptz,
  p_last_activity_at timestamptz, p_source_event_id text,
  p_source_version bigint, p_safe_data jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_data jsonb := coalesce(p_safe_data, '{}'::jsonb);
begin
  if p_workspace_id is null or p_provider not in ('mautic','chatwoot')
    or p_snapshot_kind not in ('delivery','flow','lifecycle','conversation')
    or p_aggregate_type not in ('contact','lifecycle','enquiry','support')
    or nullif(btrim(p_aggregate_id), '') is null or char_length(p_aggregate_id) > 256
    or nullif(btrim(p_source_event_id), '') is null or char_length(p_source_event_id) > 256
    or p_source_version is null or p_source_version < 1
    or (p_provider_record_suffix is not null and (p_provider_record_suffix !~ '\*' or p_provider_record_suffix !~ '^[A-Za-z0-9*_-]{0,12}$'))
  then raise exception 'invalid provider snapshot identity' using errcode = '22023'; end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then raise exception 'provider snapshot workspace does not exist' using errcode = '23503'; end if;
  if jsonb_typeof(v_data) <> 'object' or not public.ops_payload_is_safe(v_data) then raise exception 'provider snapshot data contains a forbidden field' using errcode = '22023'; end if;
  -- Persist only the normalized observation vocabulary. This prevents a
  -- future worker from smuggling arbitrary provider payload fields into the
  -- service-owned table even when they do not match a secret name.
  v_data := jsonb_strip_nulls(jsonb_build_object(
    'deliveryStatus', left(v_data ->> 'deliveryStatus', 64),
    'flow', left(v_data ->> 'flow', 128),
    'conversationStatus', left(v_data ->> 'conversationStatus', 64),
    'detail', left(public.redact_ops_text(v_data ->> 'detail'), 512)
  ));
  insert into public.ops_provider_snapshots (workspace_id, provider, snapshot_kind, aggregate_type, aggregate_id, status, stage, subject, channel, delivery_status, provider_record_suffix, occurred_at, last_activity_at, source_event_id, source_version, safe_data)
  values (p_workspace_id, p_provider, p_snapshot_kind, p_aggregate_type, p_aggregate_id, left(p_status,64), left(p_stage,64), left(p_subject,512), left(p_channel,32), left(p_delivery_status,64), left(p_provider_record_suffix,12), p_occurred_at, p_last_activity_at, p_source_event_id, p_source_version, v_data)
  on conflict (workspace_id, provider, snapshot_kind, aggregate_type, aggregate_id) do update set status = excluded.status, stage = excluded.stage, subject = excluded.subject, channel = excluded.channel, delivery_status = excluded.delivery_status, provider_record_suffix = excluded.provider_record_suffix, occurred_at = excluded.occurred_at, last_activity_at = excluded.last_activity_at, source_event_id = excluded.source_event_id, source_version = excluded.source_version, safe_data = excluded.safe_data, updated_at = now()
    where public.ops_provider_snapshots.source_version <= excluded.source_version
  returning id into v_id;
  if v_id is null then select id into v_id from public.ops_provider_snapshots where workspace_id = p_workspace_id and provider = p_provider and snapshot_kind = p_snapshot_kind and aggregate_type = p_aggregate_type and aggregate_id = p_aggregate_id; end if;
  return v_id;
end;
$$;

-- Explicit association API for a CRM operator. The source enquiry is locked,
-- the association is audited first, and its update trigger appends the
-- Chatwoot projection. No shared-email inference is possible.
create or replace function public.associate_ops_enquiry(
  p_enquiry_id uuid, p_workspace_id uuid, p_actor_profile_id uuid default null,
  p_reason text default 'explicit_crm_association'
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_workspace_id is null or not exists (select 1 from public.workspaces where id = p_workspace_id) then raise exception 'enquiry association workspace does not exist' using errcode = '23503'; end if;
  select id into v_id from public.ops_enquiry_associations where id = p_enquiry_id and workspace_id is null for update;
  if not found then raise exception 'enquiry is missing or already associated' using errcode = '22023'; end if;
  insert into public.audit_logs (workspace_id, actor_profile_id, action, target_type, target_id, metadata)
    values (p_workspace_id, p_actor_profile_id, 'ops.enquiry.associated', 'enquiry', p_enquiry_id, jsonb_build_object('reason', left(coalesce(p_reason, 'explicit_crm_association'), 256), 'associationId', p_enquiry_id::text));
  update public.ops_enquiry_associations set workspace_id = p_workspace_id, updated_at = now() where id = p_enquiry_id;
  return v_id;
end;
$$;

revoke all on function public.upsert_ops_provider_snapshot(uuid,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.upsert_ops_provider_snapshot(uuid,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,text,bigint,jsonb) to service_role;
revoke all on function public.associate_ops_enquiry(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.associate_ops_enquiry(uuid,uuid,uuid,text) to service_role;

commit;
