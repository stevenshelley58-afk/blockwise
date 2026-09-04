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
create schema if not exists legacy_archive;
create table if not exists legacy_archive.customer_operations_outbox_archive (
  archived_at timestamptz not null default now(),
  outbox_id uuid not null,
  row_data jsonb not null
);

insert into legacy_archive.customer_operations_outbox_archive (outbox_id, row_data)
select id, to_jsonb(o) from public.ops_projection_outbox o
where :'confirm' = 'ROLLBACK_CUSTOMER_OPERATIONS';

do $$
declare v_live bigint; v_archived bigint;
begin
  select count(*) into v_live from public.ops_projection_outbox;
  select count(*) into v_archived from legacy_archive.customer_operations_outbox_archive;
  if v_live <> v_archived then
    raise exception 'rollback archive row-count mismatch: live %, archived %', v_live, v_archived;
  end if;
end $$;

drop trigger if exists ops_workspace_projection on public.workspaces;
drop trigger if exists ops_activation_projection on public.customer_activations;
drop trigger if exists ops_booking_projection on public.workspace_onboarding_bookings;
drop trigger if exists ops_demo_request_association on public.demo_requests;
drop trigger if exists ops_audit_enquiry_association on public.audit_logs;
drop trigger if exists ops_booking_association on public.workspace_onboarding_bookings;
drop trigger if exists ops_enquiry_projection on public.ops_enquiry_associations;
drop function if exists public.ops_enqueue_source_projection();
drop function if exists public.ops_record_enquiry_association();
drop function if exists public.ops_enqueue_enquiry_projection();
drop function if exists public.redact_ops_text(text);
drop function if exists public.ops_payload_is_safe(jsonb);
drop function if exists public.can_send_marketing(uuid,text,text);
drop function if exists public.reap_ops_projections(integer);
drop function if exists public.fail_ops_projection(uuid,uuid,uuid,text);
drop function if exists public.heartbeat_ops_projection(uuid,uuid,uuid,integer);
drop function if exists public.complete_ops_projection(uuid,uuid,uuid);
drop function if exists public.claim_ops_projection(text,integer);
drop function if exists public.enqueue_ops_projection(uuid,text,text,text,text,text,bigint,jsonb);
drop view if exists public.ops_customer_summary;
drop table if exists public.ops_enquiry_associations;
drop table if exists public.ops_projection_outbox;
drop table if exists public.customer_communication_preferences;
drop sequence if exists public.ops_projection_source_version_seq;
commit;

\echo 'Rollback complete. Archived rows remain in legacy_archive.customer_operations_outbox_archive.'
