-- Contract completion: official Chatwoot source binding, durable step fencing,
-- lead association repair, tenant-authoritative mail ownership, and bounded
-- initial backfill. All provider calls remain outside the database transaction.
begin;

alter table public.email_outbox add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;
create index if not exists email_outbox_workspace_created_idx on public.email_outbox(workspace_id, created_at desc) where workspace_id is not null;
comment on column public.email_outbox.workspace_id is 'Authoritative tenant supplied by the enqueue source; NULL means intentionally unassigned and is never inferred from recipient email.';

alter table private.ops_provider_operation_ledger add column if not exists completed_steps text[] not null default '{}';
alter table private.ops_provider_operation_ledger add column if not exists step_digests jsonb not null default '{}';
revoke all on private.ops_provider_operation_ledger from service_role;

create or replace function public.record_ops_provider_step(
  p_operation_key text, p_step text, p_resource text default null,
  p_provider_id_ciphertext text default null, p_provider_id_digest text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if p_step is null or p_step !~ '^[a-z][a-z0-9_.-]{1,95}$'
    or (p_resource is not null and p_resource not in ('contact','conversation'))
    or (p_provider_id_digest is not null and p_provider_id_digest !~ '^[0-9a-f]{64}$') then
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

-- A lead is a source row, not an association. Create the explicit association
-- first; the existing association trigger then enqueues the association UUID,
-- which resolve_ops_projection_data can authoritatively resolve.
create or replace function public.ops_record_lead_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ops_enquiry_associations(workspace_id,source_system,source_id,enquiry_type,status,subject,requester_email,requester_name)
    values(new.workspace_id,'blockwise',new.id::text,'sales','open','Website lead',left(lower(btrim(new.email)),320),left(new.full_name,256))
    on conflict(source_system,source_id) do update set workspace_id=excluded.workspace_id,requester_email=excluded.requester_email,requester_name=excluded.requester_name,updated_at=now();
  return new;
end; $$;
drop trigger if exists ops_lead_association on public.leads;
create trigger ops_lead_association after insert or update on public.leads for each row execute function public.ops_record_lead_association();
revoke all on function public.ops_record_lead_association() from public, anon, authenticated;
grant execute on function public.ops_record_lead_association() to service_role;

-- Existing rows are backfilled only through explicit foreign keys/source IDs;
-- recipient email is never used to select a workspace. Limits keep migration
-- work bounded on a large installation; the idempotent worker can continue the
-- same deterministic keys in a later maintenance run.
do $$ declare r record; v_version bigint; begin
  for r in select l.* from public.leads l order by l.created_at,l.id limit 10000 loop
    insert into public.ops_enquiry_associations(workspace_id,source_system,source_id,enquiry_type,status,subject,requester_email,requester_name)
      values(r.workspace_id,'blockwise',r.id::text,'sales','open','Website lead',left(lower(btrim(r.email)),320),left(r.full_name,256))
      on conflict(source_system,source_id) do update set workspace_id=excluded.workspace_id,requester_email=excluded.requester_email,requester_name=excluded.requester_name,updated_at=now();
    select nextval('public.ops_projection_source_version_seq') into v_version;
    perform public.enqueue_ops_projection(r.workspace_id,'chatwoot','enquiry',r.id::text,'upsert','lead-backfill:'||r.id::text||':'||v_version::text,v_version,'{}'::jsonb);
  end loop;
  for r in select b.* from public.workspace_onboarding_bookings b order by b.created_at,b.id limit 10000 loop
    select nextval('public.ops_projection_source_version_seq') into v_version;
    perform public.enqueue_ops_projection(r.workspace_id,'chatwoot','support',r.id::text,'upsert','booking-backfill:'||r.id::text||':'||v_version::text,v_version,'{}'::jsonb);
  end loop;
  for r in select wm.workspace_id,wm.profile_id from public.workspace_members wm order by wm.created_at,wm.workspace_id,wm.profile_id limit 10000 loop
    select nextval('public.ops_projection_source_version_seq') into v_version;
    perform public.enqueue_ops_projection(r.workspace_id,'mautic','contact',r.profile_id::text,'upsert','member-backfill:'||r.workspace_id::text||':'||r.profile_id::text||':'||v_version::text,v_version,'{}'::jsonb);
  end loop;
  for r in select a.workspace_id from public.customer_activations a order by a.updated_at,a.workspace_id limit 10000 loop
    select nextval('public.ops_projection_source_version_seq') into v_version;
    perform public.enqueue_ops_projection(r.workspace_id,'mautic','lifecycle',r.workspace_id::text,'upsert','activation-backfill:'||r.workspace_id::text||':'||v_version::text,v_version,'{}'::jsonb);
  end loop;
  for r in select e.* from public.ops_enquiry_associations e where e.workspace_id is not null order by e.updated_at,e.id limit 10000 loop
    select nextval('public.ops_projection_source_version_seq') into v_version;
    perform public.enqueue_ops_projection(r.workspace_id,'chatwoot',case when r.enquiry_type='support' then 'support' else 'enquiry' end,r.id::text,'upsert','enquiry-backfill:'||r.id::text||':'||v_version::text,v_version,'{}'::jsonb);
  end loop;
end $$;

-- Replace the pre-008 resolver in-place for already migrated installations:
-- email rows are projected only when their enqueue source supplied the
-- authoritative workspace_id; no profile-email join can cross tenants.
create or replace function public.resolve_ops_frank_bundle() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_revision text := 'unbound'; v_workspaces jsonb; v_workspace_ids text[]; v_receipts text[]; v_members jsonb; v_bookings jsonb; v_billing jsonb; v_email jsonb; v_flows jsonb; v_mautic jsonb; v_enquiries jsonb; v_activity jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',s.workspace_id,'workspace_id',s.workspace_id,'name',s.workspace_name,'mode',s.mode,'region',s.region,'country_code',s.country_code,'managed_service_enabled',s.managed_service_enabled,'billing_access_state',s.billing_access_state,'stripe_subscription_status',s.stripe_subscription_status,'stripe_latest_invoice_status',s.stripe_latest_invoice_status,'created_at',s.created_at,'updated_at',s.updated_at,'email',s.owner_email,'display_name',s.owner_name) order by s.workspace_id),'[]'::jsonb), coalesce(array_agg(s.workspace_id::text order by s.workspace_id),'{}'::text[]) into v_workspaces,v_workspace_ids from public.ops_customer_summary s;
  select coalesce(array_agg(r.receipt order by r.receipt), '{}'::text[]) into v_receipts from (select distinct 'receipt:ops/source-'||lower(left(regexp_replace(o.source_event_id,'[^A-Za-z0-9_-]','','g'),96)) as receipt from public.ops_projection_outbox o where o.workspace_id=any(v_workspace_ids::uuid[]) union select distinct 'receipt:ops/snapshot-'||lower(left(regexp_replace(s.source_event_id,'[^A-Za-z0-9_-]','','g'),96)) from public.ops_provider_snapshots s where s.workspace_id=any(v_workspace_ids::uuid[]) union select distinct 'receipt:ops/global-'||g.id::text from public.ops_global_projection_outbox g) r;
  select coalesce(jsonb_agg(jsonb_build_object('id','member:'||wm.workspace_id::text||':'||wm.profile_id::text,'customer_id',wm.workspace_id,'workspace_id',wm.workspace_id,'profile_id',p.id,'email',p.email,'full_name',p.full_name,'role',wm.role,'status','active','created_at',wm.created_at) order by wm.created_at),'[]'::jsonb) into v_members from public.workspace_members wm join public.profiles p on p.id=wm.profile_id where wm.workspace_id=any(v_workspace_ids::uuid[]);
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'customer_id',b.workspace_id,'workspace_id',b.workspace_id,'booking_ref',b.id::text,'status',b.status,'provider',b.provider,'scheduled_start_at',b.scheduled_start_at,'scheduled_end_at',b.scheduled_end_at,'booked_at',b.booked_at,'cancelled_at',b.cancelled_at,'completed_at',b.completed_at,'created_at',b.created_at,'updated_at',b.updated_at) order by b.updated_at desc),'[]'::jsonb) into v_bookings from public.workspace_onboarding_bookings b where b.workspace_id=any(v_workspace_ids::uuid[]);
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'customer_id',a.workspace_id,'workspace_id',a.workspace_id,'status','customer','plan',a.offer_key,'currency',a.currency,'first_invoice_amount',a.first_invoice_amount,'renewal_amount',a.renewal_amount,'accepted_at',a.accepted_at,'offer_key',a.offer_key,'offer_version',a.offer_version) order by a.accepted_at desc),'[]'::jsonb) into v_billing from public.billing_offer_acceptances a where a.workspace_id=any(v_workspace_ids::uuid[]);
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text||':'||e.workspace_id::text,'customer_id',e.workspace_id,'workspace_id',e.workspace_id,'template',e.template_id,'subject',left(coalesce(e.payload->>'subject',''),512),'status',e.status,'delivery_status',e.status,'created_at',e.created_at,'sent_at',e.sent_at,'updated_at',coalesce(e.sent_at,e.created_at),'failure_reason',public.redact_ops_text(e.last_error),'provider','stalwart','kind',e.message_type,'suppression_state',case when e.status='suppressed' then 'suppressed' else 'allowed' end,'provider_record_suffix',case when e.provider_message_id is null then null else '****'||right(e.provider_message_id,4) end) order by e.created_at desc),'[]'::jsonb) into v_email from public.email_outbox e where e.workspace_id is not null and e.workspace_id=any(v_workspace_ids::uuid[]);
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'customer_id',s.workspace_id,'workspace_id',s.workspace_id,'name','Mautic '||coalesce(s.stage,'lifecycle'),'type','lifecycle','status',s.status,'stage',s.stage,'campaign',coalesce(s.safe_data->>'campaign_status','not_configured'),'enrolled_at',s.created_at,'last_activity_at',s.last_activity_at,'updated_at',s.updated_at,'snapshot_kind',s.snapshot_kind,'source_event_id',s.source_event_id,'source_version',s.source_version) order by s.updated_at desc),'[]'::jsonb) into v_flows from public.ops_provider_snapshots s where s.provider='mautic' and s.snapshot_kind in ('flow','lifecycle') and s.workspace_id=any(v_workspace_ids::uuid[]);
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'customer_id',s.workspace_id,'workspace_id',s.workspace_id,'stage',s.stage,'status',s.status,'provider_record_suffix',s.provider_record_suffix,'snapshot_kind',s.snapshot_kind,'source_event_id',s.source_event_id,'source_version',s.source_version,'updated_at',s.updated_at) order by s.updated_at desc),'[]'::jsonb) into v_mautic from public.ops_provider_snapshots s where s.provider='mautic' and s.snapshot_kind='lifecycle' and s.workspace_id=any(v_workspace_ids::uuid[]);
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'customer_id',e.workspace_id,'workspace_id',e.workspace_id,'subject',e.subject,'status',e.status,'enquiry_type',e.enquiry_type,'requester_email',e.requester_email,'requester_name',e.requester_name,'source_system',e.source_system,'created_at',e.created_at,'updated_at',e.updated_at) order by e.updated_at desc),'[]'::jsonb) into v_enquiries from public.ops_enquiry_associations e where e.workspace_id=any(v_workspace_ids::uuid[]) or e.workspace_id is null;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'customer_id',a.workspace_id,'workspace_id',a.workspace_id,'kind',a.target_type,'title',a.action,'occurred_at',a.created_at,'created_at',a.created_at) order by a.created_at desc),'[]'::jsonb) into v_activity from public.audit_logs a where a.workspace_id=any(v_workspace_ids::uuid[]);
  return jsonb_build_object('project_id','blockwise','source_revision',v_revision,'source_receipt_ids',to_jsonb(v_receipts),'workspace_ids',to_jsonb(v_workspace_ids),'fresh_until',(now()+interval '15 minutes'),'projections',jsonb_build_object('customers',v_workspaces,'email',v_email,'flows',v_flows,'mautic',v_mautic,'enquiries',v_enquiries,'bookings',v_bookings,'billing',v_billing,'activity',v_activity,'members',v_members));
end; $$;
revoke all on function public.resolve_ops_frank_bundle() from public, anon, authenticated;
grant execute on function public.resolve_ops_frank_bundle() to service_role;

-- Rollback of this migration is archive-first in scripts/ops/rollback-customer-operations.sql.
commit;
