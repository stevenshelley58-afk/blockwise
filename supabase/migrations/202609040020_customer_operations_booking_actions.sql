-- Customer-operations SnagTime booking action lane.
--
-- Enables the action worker to execute booking_cancel / booking_reschedule
-- against SnagTime's private signed API:
--   1. ledger, operation and snapshot provider domains accept 'snagtime'
--   2. the claim RPC also leases booking actions under the same fencing
--   3. resolve_ops_booking_action_target binds a workspace booking to its
--      SnagTime booking id and last-known provider mutation version
--   4. settle_ops_booking_provider_operation advances the version from the
--      provider receipt so the next action uses fresh CAS input
--
-- Provider RPC bodies are carried forward verbatim from their original
-- migrations with only the allowlist widened.
begin;

alter table private.ops_provider_operation_ledger drop constraint if exists ops_provider_operation_ledger_provider_check;
alter table private.ops_provider_operation_ledger add constraint ops_provider_operation_ledger_provider_check
  check (provider in ('mautic','chatwoot','snagtime'));

create or replace function public.begin_ops_provider_operation(
  p_operation_key text, p_workspace_id uuid, p_provider text, p_aggregate_type text,
  p_aggregate_id text, p_source_version bigint, p_intent jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row private.ops_provider_operation_ledger%rowtype;
begin
  if nullif(btrim(p_operation_key),'') is null or (p_workspace_id is null and p_aggregate_type <> 'global_enquiry') or p_provider not in ('mautic','chatwoot','snagtime')
    or nullif(btrim(p_aggregate_id),'') is null or p_source_version is null or p_source_version < 1 or jsonb_typeof(coalesce(p_intent,'{}')) <> 'object'
    or not public.ops_payload_is_safe(coalesce(p_intent,'{}')) then
    raise exception 'invalid provider operation intent' using errcode='22023';
  end if;
  insert into private.ops_provider_operation_ledger(operation_key,workspace_id,provider,aggregate_type,aggregate_id,source_version,intent)
  values (left(p_operation_key,512),p_workspace_id,p_provider,left(p_aggregate_type,64),left(p_aggregate_id,256),p_source_version,coalesce(p_intent,'{}'))
  on conflict(operation_key) do update set updated_at=now(), source_version=greatest(private.ops_provider_operation_ledger.source_version,excluded.source_version);
  select * into v_row from private.ops_provider_operation_ledger where operation_key=left(p_operation_key,512);
  return jsonb_build_object('state',v_row.state,'provider_id_ciphertext',v_row.provider_id_ciphertext,'provider_id_digest',v_row.provider_id_digest,'provider_contact_id_ciphertext',v_row.provider_contact_id_ciphertext,'provider_contact_id_digest',v_row.provider_contact_id_digest,'provider_conversation_id_ciphertext',v_row.provider_conversation_id_ciphertext,'provider_conversation_id_digest',v_row.provider_conversation_id_digest);
end; $$;
revoke all on function public.begin_ops_provider_operation(text,uuid,text,text,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.begin_ops_provider_operation(text,uuid,text,text,text,bigint,jsonb) to service_role;
create or replace function public.claim_ops_provider_action(p_lease_seconds integer default 600)
returns table (id uuid, action_id uuid, workspace_id uuid, customer_id uuid, actor_operator_id uuid, actor_role text,
  action_type text, target_type text, target_id uuid, expected_version bigint, reason text, payload jsonb,
  attempts integer, max_attempts integer, expires_at timestamptz, lease_token uuid)
language sql security definer set search_path = '' as $$
  update public.ops_action_outbox as o set status='processing', attempts=o.attempts+1,
    lease_token=gen_random_uuid(), lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,600),3600))), updated_at=now()
  where o.id=(select c.id from public.ops_action_outbox c where c.status='pending' and c.run_after<=now()
    and c.expires_at>now() and c.attempts<c.max_attempts
    and c.action_type in ('enquiry_close','enquiry_reply','enquiry_reopen','booking_cancel','booking_reschedule')
    and not exists (select 1 from public.ops_action_outbox newer where newer.workspace_id=c.workspace_id and newer.target_type=c.target_type and newer.target_id=c.target_id and newer.expected_version>c.expected_version and newer.status not in ('rejected','expired','superseded'))
    order by c.run_after,c.created_at,c.id for update skip locked limit 1)
  returning o.id,o.action_id,o.workspace_id,o.customer_id,o.actor_operator_id,o.actor_role,o.action_type,o.target_type,o.target_id,o.expected_version,o.reason,o.payload,o.attempts,o.max_attempts,o.expires_at,o.lease_token;
$$;
revoke all on function public.claim_ops_provider_action(integer) from public, anon, authenticated;
grant execute on function public.claim_ops_provider_action(integer) to service_role;


create or replace function public.resolve_ops_booking_action_target(p_workspace_id uuid, p_booking_id uuid)
returns table (provider_booking_id text, provider_mutation_version bigint)
language plpgsql security definer set search_path = '' as $$
declare v_booking public.workspace_onboarding_bookings%rowtype; v_version bigint;
begin
  if p_workspace_id is null or p_booking_id is null then raise exception 'invalid booking action target' using errcode='22023'; end if;
  select * into v_booking from public.workspace_onboarding_bookings
    where id=p_booking_id and workspace_id=p_workspace_id
      and provider='snagtime' and provider_booking_id is not null;
  if not found then raise exception 'booking action target unavailable' using errcode='22023'; end if;
  insert into private.ops_provider_operation_ledger(operation_key,workspace_id,provider,aggregate_type,aggregate_id,source_version,intent)
  values ('snagtime:booking:'||v_booking.provider_booking_id,p_workspace_id,'snagtime','booking',v_booking.id::text,1,
    jsonb_build_object('providerBookingIdDigest',encode(extensions.digest(v_booking.provider_booking_id,'sha256'),'hex')))
  on conflict(operation_key) do update set updated_at=now();
  select source_version into v_version from private.ops_provider_operation_ledger where operation_key='snagtime:booking:'||v_booking.provider_booking_id;
  return query select v_booking.provider_booking_id, greatest(v_version - 1, 0);
end; $$;
revoke all on function public.resolve_ops_booking_action_target(uuid,uuid) from public, anon, authenticated;
grant execute on function public.resolve_ops_booking_action_target(uuid,uuid) to service_role;

create or replace function public.settle_ops_booking_provider_operation(
  p_operation_key text, p_expected_source_version bigint,
  p_provider_id_ciphertext text, p_provider_id_digest text, p_new_mutation_version bigint
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if nullif(btrim(p_operation_key),'') is null or p_expected_source_version is null or p_expected_source_version < 1
    or nullif(btrim(p_provider_id_ciphertext),'') is null
    or p_provider_id_ciphertext !~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
    or p_provider_id_digest !~ '^[0-9a-f]{64}$'
    or p_new_mutation_version is null or p_new_mutation_version < 0 then
    raise exception 'invalid booking operation settle' using errcode='22023';
  end if;
  update private.ops_provider_operation_ledger set state='settled', source_version=p_new_mutation_version + 1,
      provider_id_ciphertext=left(p_provider_id_ciphertext,2048), provider_id_digest=p_provider_id_digest, updated_at=now()
    where operation_key=left(p_operation_key,512) and source_version=p_expected_source_version
      and state in ('prepared','remote_succeeded');
  return found;
end; $$;
revoke all on function public.settle_ops_booking_provider_operation(text,bigint,text,text,bigint) from public, anon, authenticated;
grant execute on function public.settle_ops_booking_provider_operation(text,bigint,text,text,bigint) to service_role;

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
  if p_workspace_id is null or p_provider not in ('mautic','chatwoot','snagtime')
    or p_snapshot_kind not in ('delivery','flow','lifecycle','conversation','booking')
    or p_aggregate_type not in ('contact','lifecycle','enquiry','support','booking')
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
revoke all on function public.upsert_ops_provider_snapshot(uuid,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.upsert_ops_provider_snapshot(uuid,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,text,bigint,jsonb) to service_role;
create or replace function public.record_ops_provider_step(
  p_operation_key text, p_step text, p_resource text default null,
  p_provider_id_ciphertext text default null, p_provider_id_digest text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if p_step is null or p_step !~ '^[a-z][a-z0-9_.-]{1,95}$'
    or (p_resource is not null and p_resource not in ('contact','conversation','booking'))
    or (p_provider_id_ciphertext is not null and (nullif(btrim(p_provider_id_ciphertext),'') is null or p_provider_id_ciphertext !~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$' or p_provider_id_digest is null or p_provider_id_digest !~ '^[0-9a-f]{64}$'))
    or (p_provider_id_ciphertext is null and p_provider_id_digest is not null) then
    raise exception 'invalid provider operation step' using errcode = '22023';
  end if;
  update private.ops_provider_operation_ledger
     set completed_steps = case when p_step = any(completed_steps) then completed_steps else array_append(completed_steps,p_step) end,
         step_digests = case when p_provider_id_digest is null then step_digests else jsonb_set(step_digests, array[p_step], to_jsonb(p_provider_id_digest), true) end,
         provider_contact_id_ciphertext = case when p_resource='contact' and p_provider_id_ciphertext is not null then left(p_provider_id_ciphertext,2048) else provider_contact_id_ciphertext end,
         provider_contact_id_digest = case when p_resource='contact' and p_provider_id_digest is not null then p_provider_id_digest else provider_contact_id_digest end,
         provider_conversation_id_ciphertext = case when p_resource='conversation' and p_provider_id_ciphertext is not null then left(p_provider_id_ciphertext,2048) else provider_conversation_id_ciphertext end,
         provider_conversation_id_digest = case when p_resource='conversation' and p_provider_id_digest is not null then p_provider_id_digest else provider_conversation_id_digest end,
         state='remote_succeeded', updated_at=now()
   where operation_key=left(p_operation_key,512) and state in ('prepared','remote_succeeded');
  get diagnostics v_count = row_count;
  return v_count = 1;
end; $$;
revoke all on function public.record_ops_provider_step(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.record_ops_provider_step(text,text,text,text,text) to service_role;

-- 7. Booking capability truth: the worker flips these rows only after the
--    SnagTime provider health check succeeds; they expire like Chatwoot's.
create or replace function public.set_ops_snagtime_capability(p_enabled boolean, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.ops_action_capabilities set capability_state=case when p_enabled then 'available' else 'capability_required' end,
    description=left(coalesce(p_reason,'SnagTime worker readiness unavailable'),256), updated_at=now(),
    verified_at=case when p_enabled then now() else null end,
    expires_at=case when p_enabled then now()+interval '2 minutes' else null end,
    verification_error=case when p_enabled then null else left(coalesce(p_reason,'unavailable'),512) end
    where action_type in ('booking_cancel','booking_reschedule');
  return true;
end;
$$;
revoke all on function public.set_ops_snagtime_capability(boolean,text) from public,anon,authenticated;
grant execute on function public.set_ops_snagtime_capability(boolean,text) to service_role;

commit;
