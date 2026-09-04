\set ON_ERROR_STOP on
-- Run only against the intended product database:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ops/rollback-customer-operations.sql
-- This is intentionally explicit and archive-first. It will not silently
-- destroy queued work. Set confirm=ROLLBACK_CUSTOMER_OPERATIONS to proceed.
\if :{?confirm}
\else
  \echo 'Refusing rollback: pass -v confirm=ROLLBACK_CUSTOMER_OPERATIONS'
  \quit 3
\endif
begin;
do $$
begin
  if :'confirm' <> 'ROLLBACK_CUSTOMER_OPERATIONS' then
    raise exception 'rollback sentinel mismatch; refusing to mutate database';
  end if;
end $$;
-- Freeze every source and derived table before taking the archive counts. The
-- ACCESS EXCLUSIVE locks block writers and trigger-backed outbox inserts until
-- this transaction commits, so archive/count/drop is one consistent cut.
lock table public.audit_logs, public.billing_offer_acceptances,
  public.customer_activations, public.customer_communication_preferences,
  public.demo_requests, public.email_suppressions, public.lead_events,
  public.leads, public.ops_enquiry_associations, public.ops_projection_outbox,
  public.ops_provider_snapshots, public.ops_global_projection_outbox,
  public.ops_provider_correlations,
  private.ops_provider_operation_ledger, public.email_outbox, public.profiles,
  public.report_email_leads, public.workspace_members,
  public.workspace_onboarding_bookings, public.workspaces
  in access exclusive mode;
create schema if not exists legacy_archive;
create table if not exists legacy_archive.customer_operations_tables_archive (
  archived_at timestamptz not null default now(),
  run_id uuid not null,
  table_name text not null,
  row_id text not null,
  row_data jsonb not null
);
alter table legacy_archive.customer_operations_tables_archive add column if not exists run_id uuid;
update legacy_archive.customer_operations_tables_archive set run_id = gen_random_uuid() where run_id is null;
alter table legacy_archive.customer_operations_tables_archive alter column run_id set not null;
select gen_random_uuid() as rollback_run_id \gset

insert into legacy_archive.customer_operations_tables_archive (run_id, table_name, row_id, row_data)
select :'rollback_run_id', 'ops_projection_outbox', id::text, to_jsonb(o) from public.ops_projection_outbox o;
insert into legacy_archive.customer_operations_tables_archive (run_id, table_name, row_id, row_data)
select :'rollback_run_id', 'ops_enquiry_associations', id::text, to_jsonb(o) from public.ops_enquiry_associations o;
insert into legacy_archive.customer_operations_tables_archive (run_id, table_name, row_id, row_data)
select :'rollback_run_id', 'customer_communication_preferences', id::text, to_jsonb(o) from public.customer_communication_preferences o;
insert into legacy_archive.customer_operations_tables_archive (run_id, table_name, row_id, row_data)
select :'rollback_run_id', 'ops_provider_snapshots', id::text, to_jsonb(o) from public.ops_provider_snapshots o;
insert into legacy_archive.customer_operations_tables_archive (run_id, table_name, row_id, row_data)
select :'rollback_run_id', 'ops_global_projection_outbox', id::text, to_jsonb(o) from public.ops_global_projection_outbox o;
insert into legacy_archive.customer_operations_tables_archive (run_id, table_name, row_id, row_data)
-- row_data intentionally retains operation_key plus provider_id_ciphertext,
-- provider_contact_id_ciphertext, and provider_conversation_id_ciphertext.
select :'rollback_run_id', 'ops_provider_operation_ledger', operation_key, to_jsonb(o) from private.ops_provider_operation_ledger o;
insert into legacy_archive.customer_operations_tables_archive (run_id, table_name, row_id, row_data)
select :'rollback_run_id', 'email_outbox', id::text, to_jsonb(o) from public.email_outbox o;
insert into legacy_archive.customer_operations_tables_archive (run_id, table_name, row_id, row_data)
select :'rollback_run_id', 'ops_provider_correlations', workspace_id::text || ':' || provider || ':' || aggregate_type || ':' || aggregate_id, to_jsonb(o) from public.ops_provider_correlations o;
-- Preserve the complete suppression association/value before dropping the
-- customer-operations workspace_id extension. This archive is per rollback
-- run and is covered by the same writer-freeze locks and count check below.
insert into legacy_archive.customer_operations_tables_archive (run_id, table_name, row_id, row_data)
select :'rollback_run_id', 'email_suppressions', id::text, to_jsonb(s) from public.email_suppressions s;

do $$
declare v_live bigint; v_archived bigint; v_table text;
begin
  for v_table in select unnest(array['ops_projection_outbox','ops_enquiry_associations','customer_communication_preferences','ops_provider_snapshots','ops_global_projection_outbox','email_suppressions']) loop
    execute format('select count(*) from public.%I', v_table) into v_live;
    select count(*) into v_archived from legacy_archive.customer_operations_tables_archive where table_name = v_table and run_id = :'rollback_run_id';
    if v_live <> v_archived then raise exception 'rollback archive row-count mismatch for %: live %, archived %', v_table, v_live, v_archived; end if;
  end loop;
  select count(*) into v_live from private.ops_provider_operation_ledger;
  select count(*) into v_archived from legacy_archive.customer_operations_tables_archive where table_name = 'ops_provider_operation_ledger' and run_id = :'rollback_run_id';
  if v_live <> v_archived then raise exception 'rollback archive row-count mismatch for provider ledger: live %, archived %', v_live, v_archived; end if;
  select count(*) into v_live from public.email_outbox;
  select count(*) into v_archived from legacy_archive.customer_operations_tables_archive where table_name = 'email_outbox' and run_id = :'rollback_run_id';
  if v_live <> v_archived then raise exception 'rollback archive row-count mismatch for email_outbox: live %, archived %', v_live, v_archived; end if;
  select count(*) into v_live from public.ops_provider_correlations;
  select count(*) into v_archived from legacy_archive.customer_operations_tables_archive where table_name = 'ops_provider_correlations' and run_id = :'rollback_run_id';
  if v_live <> v_archived then raise exception 'rollback archive row-count mismatch for provider correlations: live %, archived %', v_live, v_archived; end if;
end $$;

drop trigger if exists ops_workspace_projection on public.workspaces;
drop trigger if exists ops_activation_projection on public.customer_activations;
drop trigger if exists ops_booking_projection on public.workspace_onboarding_bookings;
drop trigger if exists ops_demo_request_association on public.demo_requests;
drop trigger if exists ops_report_email_lead_association on public.report_email_leads;
drop trigger if exists ops_audit_enquiry_association on public.audit_logs;
drop trigger if exists ops_booking_association on public.workspace_onboarding_bookings;
drop trigger if exists ops_enquiry_projection on public.ops_enquiry_associations;
drop trigger if exists ops_profile_projection on public.profiles;
drop trigger if exists ops_member_projection on public.workspace_members;
drop trigger if exists ops_lead_projection on public.leads;
drop trigger if exists ops_lead_association on public.leads;
drop trigger if exists ops_lead_event_projection on public.lead_events;
drop trigger if exists ops_billing_projection on public.billing_offer_acceptances;
drop trigger if exists ops_preference_projection on public.customer_communication_preferences;
drop function if exists public.ops_enqueue_source_projection();
drop function if exists public.ops_record_enquiry_association();
drop function if exists public.ops_enqueue_enquiry_projection();
drop function if exists public.associate_ops_enquiry(uuid,uuid,uuid,text);
drop function if exists public.upsert_ops_provider_snapshot(uuid,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,text,bigint,jsonb);
drop function if exists public.redact_ops_text(text);
drop function if exists public.ops_payload_is_safe(jsonb);
drop function if exists public.can_send_marketing(uuid,text,text);
drop function if exists public.reap_ops_projections(integer);
drop function if exists public.fail_ops_projection(uuid,uuid,uuid,text);
drop function if exists public.heartbeat_ops_projection(uuid,uuid,uuid,integer);
drop function if exists public.complete_ops_projection(uuid,uuid,uuid);
drop function if exists public.claim_ops_projection(text,integer);
drop function if exists public.enqueue_ops_projection(uuid,text,text,text,text,text,bigint,jsonb);
drop function if exists public.settle_ops_provider_operation(text,bigint);
drop function if exists public.record_ops_provider_identifier(text,text,text,text,text);
drop function if exists public.record_ops_provider_operation(text,text,text,text);
drop function if exists public.begin_ops_provider_operation(text,uuid,text,text,text,bigint,jsonb);
drop function if exists public.resolve_ops_frank_bundle();
drop function if exists public.enqueue_ops_global_projection();
drop function if exists public.claim_ops_global_projection(integer);
drop function if exists public.resolve_global_ops_enquiry(uuid);
drop function if exists public.complete_ops_global_projection(uuid,uuid);
drop function if exists public.heartbeat_ops_global_projection(uuid,uuid,integer);
drop function if exists public.reap_ops_global_projection(integer);
drop function if exists public.fail_ops_global_projection(uuid,uuid,text);
drop function if exists public.record_ops_provider_step(text,text,text,text,text);
drop function if exists public.ops_record_lead_association();
drop function if exists public.resolve_ops_provider_correlation(uuid,text,text,text);
drop function if exists public.record_ops_provider_correlation(uuid,text,text,text,text,bigint);
drop table if exists public.ops_provider_correlations;
drop view if exists public.ops_customer_summary;
drop table if exists public.ops_enquiry_associations;
drop table if exists public.ops_provider_snapshots;
drop table if exists public.ops_projection_outbox;
drop table if exists public.ops_global_projection_outbox;
drop table if exists public.customer_communication_preferences;
drop table if exists private.ops_provider_operation_ledger;
alter table if exists public.email_outbox drop column if exists workspace_id;
drop sequence if exists public.ops_projection_source_version_seq;
drop index if exists public.email_suppressions_lower_reason_key;
alter table if exists public.email_suppressions drop column if exists workspace_id;
commit;

\echo 'Rollback complete. Archived rows remain in legacy_archive.customer_operations_tables_archive.'
