-- Service-only provider operation ledger and explicit global enquiry queue.
-- Provider identifiers are client-encrypted before entering the private table.
begin;

create table if not exists private.ops_provider_operation_ledger (
  operation_key text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('mautic','chatwoot')),
  aggregate_type text not null,
  aggregate_id text not null,
  source_version bigint not null check (source_version > 0),
  state text not null default 'prepared' check (state in ('prepared','remote_succeeded','settled','failed')),
  intent jsonb not null default '{}'::jsonb check (jsonb_typeof(intent) = 'object'),
  provider_id_ciphertext text,
  provider_id_digest text,
  last_error text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table private.ops_provider_operation_ledger enable row level security;
revoke all on private.ops_provider_operation_ledger from public, anon, authenticated;
grant select, insert, update on private.ops_provider_operation_ledger to service_role;

create or replace function public.begin_ops_provider_operation(
  p_operation_key text, p_workspace_id uuid, p_provider text, p_aggregate_type text,
  p_aggregate_id text, p_source_version bigint, p_intent jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row private.ops_provider_operation_ledger%rowtype;
begin
  if nullif(btrim(p_operation_key),'') is null or p_workspace_id is null or p_provider not in ('mautic','chatwoot')
    or nullif(btrim(p_aggregate_id),'') is null or p_source_version is null or p_source_version < 1 or jsonb_typeof(coalesce(p_intent,'{}')) <> 'object'
    or not public.ops_payload_is_safe(coalesce(p_intent,'{}')) then
    raise exception 'invalid provider operation intent' using errcode='22023';
  end if;
  insert into private.ops_provider_operation_ledger(operation_key,workspace_id,provider,aggregate_type,aggregate_id,source_version,intent)
  values (left(p_operation_key,512),p_workspace_id,p_provider,left(p_aggregate_type,64),left(p_aggregate_id,256),p_source_version,coalesce(p_intent,'{}'))
  on conflict(operation_key) do update set updated_at=now(), source_version=greatest(private.ops_provider_operation_ledger.source_version,excluded.source_version);
  select * into v_row from private.ops_provider_operation_ledger where operation_key=left(p_operation_key,512);
  return jsonb_build_object('state',v_row.state,'provider_id_ciphertext',v_row.provider_id_ciphertext,'provider_id_digest',v_row.provider_id_digest);
end; $$;

create or replace function public.record_ops_provider_operation(
  p_operation_key text, p_provider_id_ciphertext text, p_provider_id_digest text, p_status text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status <> 'remote_succeeded' or nullif(btrim(p_provider_id_ciphertext),'') is null or p_provider_id_ciphertext !~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
    or p_provider_id_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid protected provider result' using errcode='22023'; end if;
  update private.ops_provider_operation_ledger set state='remote_succeeded', provider_id_ciphertext=left(p_provider_id_ciphertext,2048), provider_id_digest=p_provider_id_digest, updated_at=now() where operation_key=left(p_operation_key,512);
  return found;
end; $$;

create or replace function public.settle_ops_provider_operation(p_operation_key text, p_source_version bigint)
returns boolean language sql security definer set search_path = '' as $$
  update private.ops_provider_operation_ledger set state='settled', updated_at=now()
  where operation_key=left(p_operation_key,512) and source_version=p_source_version and state='remote_succeeded'
  returning true;
$$;
revoke all on function public.begin_ops_provider_operation(text,uuid,text,text,text,bigint,jsonb), public.record_ops_provider_operation(text,text,text,text), public.settle_ops_provider_operation(text,bigint) from public, anon, authenticated;
grant execute on function public.begin_ops_provider_operation(text,uuid,text,text,text,bigint,jsonb), public.record_ops_provider_operation(text,text,text,text), public.settle_ops_provider_operation(text,bigint) to service_role;

create table if not exists public.ops_global_projection_outbox (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.ops_enquiry_associations(id) on delete cascade,
  source_version bigint not null check (source_version > 0),
  operation text not null default 'upsert' check (operation='upsert'),
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 25),
  run_after timestamptz not null default now(), lease_token uuid, lease_expires_at timestamptz,
  last_error text, completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(enquiry_id, source_version), check ((lease_token is null and lease_expires_at is null) or (lease_token is not null and lease_expires_at is not null))
);
alter table public.ops_global_projection_outbox enable row level security;
revoke all on public.ops_global_projection_outbox from public, anon, authenticated;
grant select on public.ops_global_projection_outbox to service_role;

create or replace function public.enqueue_ops_global_projection() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.workspace_id is null then
    insert into public.ops_global_projection_outbox(enquiry_id,source_version) values(new.id,nextval('public.ops_projection_source_version_seq')) on conflict(enquiry_id,source_version) do nothing;
  end if;
  return new;
end; $$;
drop trigger if exists ops_global_enquiry_projection on public.ops_enquiry_associations;
create trigger ops_global_enquiry_projection after insert or update of status,subject,requester_email,requester_name on public.ops_enquiry_associations for each row execute function public.enqueue_ops_global_projection();

create or replace function public.claim_ops_global_projection(p_lease_seconds integer default 600)
returns table(id uuid,enquiry_id uuid,source_version bigint,operation text,lease_token uuid) language sql security definer set search_path='' as $$
  update public.ops_global_projection_outbox o set status='processing',attempts=o.attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,600),3600))),updated_at=now()
  where o.id=(select c.id from public.ops_global_projection_outbox c where c.status='pending' and c.run_after<=now() and c.attempts<c.max_attempts order by c.run_after,c.created_at for update skip locked limit 1)
  returning o.id,o.enquiry_id,o.source_version,o.operation,o.lease_token;
$$;
create or replace function public.resolve_global_ops_enquiry(p_enquiry_id uuid) returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('id',e.id::text,'subject',left(coalesce(e.subject,''),512),'status',e.status,'requester_email',left(coalesce(e.requester_email,''),320),'requester_name',left(coalesce(e.requester_name,''),256)) || coalesce((select case when e.source_system='blockwise' and d.message is not null then jsonb_build_object('message',left(d.message,2000)) else '{}'::jsonb end from public.demo_requests d where e.source_id=d.id::text),'{}') from public.ops_enquiry_associations e where e.id=p_enquiry_id and e.workspace_id is null;
$$;
create or replace function public.complete_ops_global_projection(p_id uuid,p_lease_token uuid) returns boolean language sql security definer set search_path='' as $$
  update public.ops_global_projection_outbox set status='completed',completed_at=now(),lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id and status='processing' and lease_token=p_lease_token and lease_expires_at>now() returning true;
$$;
create or replace function public.heartbeat_ops_global_projection(p_id uuid,p_lease_token uuid,p_lease_seconds integer default 600) returns boolean language sql security definer set search_path='' as $$
  update public.ops_global_projection_outbox set lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,600),3600))),updated_at=now() where id=p_id and status='processing' and lease_token=p_lease_token and lease_expires_at>now() returning true;
$$;
create or replace function public.reap_ops_global_projection(p_lease_seconds integer default 600) returns integer language sql security definer set search_path='' as $$
  with stale as (update public.ops_global_projection_outbox set status=case when attempts>=max_attempts then 'failed' else 'pending' end,last_error=coalesce(last_error,'global projection lease expired'),run_after=case when attempts>=max_attempts then run_after else now()+interval '5 seconds' end,lease_token=null,lease_expires_at=null,updated_at=now() where status='processing' and lease_expires_at<=now()-make_interval(secs=>greatest(0,least(coalesce(p_lease_seconds,600),3600))) returning 1) select count(*)::integer from stale;
$$;
create or replace function public.fail_ops_global_projection(p_id uuid,p_lease_token uuid,p_error text) returns text language plpgsql security definer set search_path='' as $$
declare v public.ops_global_projection_outbox%rowtype; begin select * into v from public.ops_global_projection_outbox where id=p_id and status='processing' and lease_token=p_lease_token and lease_expires_at>now() for update; if not found then return null; end if; if v.attempts>=v.max_attempts then update public.ops_global_projection_outbox set status='failed',last_error=public.redact_ops_text(p_error),lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id; return 'failed'; end if; update public.ops_global_projection_outbox set status='pending',last_error=public.redact_ops_text(p_error),run_after=now()+least(power(2,v.attempts)*interval '1 second',interval '10 minutes'),lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id; return 'pending'; end; $$;
revoke all on function public.enqueue_ops_global_projection(), public.claim_ops_global_projection(integer), public.resolve_global_ops_enquiry(uuid), public.complete_ops_global_projection(uuid,uuid), public.heartbeat_ops_global_projection(uuid,uuid,integer), public.reap_ops_global_projection(integer), public.fail_ops_global_projection(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.enqueue_ops_global_projection(), public.claim_ops_global_projection(integer), public.resolve_global_ops_enquiry(uuid), public.complete_ops_global_projection(uuid,uuid), public.heartbeat_ops_global_projection(uuid,uuid,integer), public.reap_ops_global_projection(integer), public.fail_ops_global_projection(uuid,uuid,text) to service_role;

-- The worker can publish the same schema Frank's read-only mount consumes. It
-- is deliberately a safe, normalized read model; providers are not queried.
create or replace function public.resolve_ops_frank_bundle() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_revision text := coalesce(nullif(current_setting('app.blockwise_revision', true), ''), 'worker'); v_workspaces jsonb; v_workspace_ids text[]; v_members jsonb; v_bookings jsonb; v_billing jsonb; v_email jsonb; v_mautic jsonb; v_enquiries jsonb; v_activity jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',s.workspace_id,'workspace_id',s.workspace_id,'name',s.workspace_name,'mode',s.mode,'region',s.region,'country_code',s.country_code,'managed_service_enabled',s.managed_service_enabled,'billing_access_state',s.billing_access_state,'stripe_subscription_status',s.stripe_subscription_status,'stripe_latest_invoice_status',s.stripe_latest_invoice_status,'created_at',s.created_at,'updated_at',s.updated_at,'email',s.owner_email,'display_name',s.owner_name) order by s.workspace_id),'[]'::jsonb), coalesce(array_agg(s.workspace_id::text order by s.workspace_id),'{}'::text[]) into v_workspaces,v_workspace_ids from public.ops_customer_summary s;
  select coalesce(jsonb_agg(jsonb_build_object('id','member:'||wm.workspace_id::text||':'||wm.profile_id::text,'customer_id',wm.workspace_id,'workspace_id',wm.workspace_id,'profile_id',p.id,'email',p.email,'full_name',p.full_name,'role',wm.role,'status','active','created_at',wm.created_at) order by wm.created_at),'[]'::jsonb) into v_members from public.workspace_members wm join public.profiles p on p.id=wm.profile_id where wm.workspace_id=any(v_workspace_ids::uuid[]);
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'customer_id',b.workspace_id,'workspace_id',b.workspace_id,'booking_ref',b.id::text,'status',b.status,'provider',b.provider,'scheduled_start_at',b.scheduled_start_at,'scheduled_end_at',b.scheduled_end_at,'booked_at',b.booked_at,'cancelled_at',b.cancelled_at,'completed_at',b.completed_at,'created_at',b.created_at,'updated_at',b.updated_at) order by b.updated_at desc),'[]'::jsonb) into v_bookings from public.workspace_onboarding_bookings b where b.workspace_id=any(v_workspace_ids::uuid[]);
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'customer_id',a.workspace_id,'workspace_id',a.workspace_id,'status','customer','plan',a.offer_key,'currency',a.currency,'first_invoice_amount',a.first_invoice_amount,'renewal_amount',a.renewal_amount,'accepted_at',a.accepted_at,'offer_key',a.offer_key,'offer_version',a.offer_version) order by a.accepted_at desc),'[]'::jsonb) into v_billing from public.billing_offer_acceptances a where a.workspace_id=any(v_workspace_ids::uuid[]);
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'customer_id',s.workspace_id,'workspace_id',s.workspace_id,'status',s.status,'delivery_status',s.delivery_status,'provider','mautic','provider_record_suffix',s.provider_record_suffix,'snapshot_kind',s.snapshot_kind,'source_event_id',s.source_event_id,'source_version',s.source_version,'updated_at',s.updated_at) order by s.updated_at desc),'[]'::jsonb) into v_email from public.ops_provider_snapshots s where s.provider='mautic' and s.snapshot_kind='delivery' and s.workspace_id=any(v_workspace_ids::uuid[]);
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'customer_id',s.workspace_id,'workspace_id',s.workspace_id,'stage',s.stage,'status',s.status,'provider_record_suffix',s.provider_record_suffix,'snapshot_kind',s.snapshot_kind,'source_event_id',s.source_event_id,'source_version',s.source_version,'updated_at',s.updated_at) order by s.updated_at desc),'[]'::jsonb) into v_mautic from public.ops_provider_snapshots s where s.provider='mautic' and s.snapshot_kind='lifecycle' and s.workspace_id=any(v_workspace_ids::uuid[]);
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'customer_id',e.workspace_id,'workspace_id',e.workspace_id,'subject',e.subject,'status',e.status,'enquiry_type',e.enquiry_type,'requester_email',e.requester_email,'requester_name',e.requester_name,'source_system',e.source_system,'created_at',e.created_at,'updated_at',e.updated_at) order by e.updated_at desc),'[]'::jsonb) into v_enquiries from public.ops_enquiry_associations e where e.workspace_id=any(v_workspace_ids::uuid[]) or e.workspace_id is null;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'customer_id',a.workspace_id,'workspace_id',a.workspace_id,'kind',a.target_type,'title',a.action,'occurred_at',a.created_at,'created_at',a.created_at) order by a.created_at desc),'[]'::jsonb) into v_activity from public.audit_logs a where a.workspace_id=any(v_workspace_ids::uuid[]);
  return jsonb_build_object('project_id','blockwise','source_revision',v_revision,'source_receipt_ids',jsonb_build_array('receipt:ops/worker-' || left(regexp_replace(v_revision,'[^A-Za-z0-9._:-]','','g'),128)),'workspace_ids',to_jsonb(v_workspace_ids),'fresh_until',(now()+interval '15 minutes'),'projections',jsonb_build_object('customers',v_workspaces,'email',v_email,'flows','[]'::jsonb,'mautic',v_mautic,'enquiries',v_enquiries,'bookings',v_bookings,'billing',v_billing,'activity',v_activity,'members',v_members));
end; $$;
revoke all on function public.resolve_ops_frank_bundle() from public, anon, authenticated;
grant execute on function public.resolve_ops_frank_bundle() to service_role;

commit;
