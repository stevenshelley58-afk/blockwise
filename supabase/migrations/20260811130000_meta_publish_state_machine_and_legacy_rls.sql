-- Meta publish plans are PAUSED-first. Preserve old rows by mapping old state
-- names before tightening the check constraint.
update public.meta_publish_plans
set status = case status
  when 'approved' then 'queued'
  when 'paused_live' then 'paused_ready'
  else status
end
where status in ('approved', 'paused_live');

-- Compliance approval must bind to the exact immutable publish subject. Old
-- reports intentionally remain NULL and therefore fail closed in the runtime;
-- never backfill a hash from timestamps or mutable campaign rows.
alter table public.adstudio_compliance_reports
  add column if not exists subject_hash text;
create index if not exists adstudio_compliance_reports_subject_hash_idx
  on public.adstudio_compliance_reports (workspace_id, campaign_id, subject_hash)
  where subject_hash is not null;

-- New publishes are anchored to a pinned runtime instance. Legacy rows remain
-- readable for reconciliation only; their null binding fails the new runtime
-- readiness gate and may not be used to create a new publish.
alter table public.meta_publish_plans
  add column if not exists adstudio_runtime_instance_id uuid references public.adstudio_runtime_instances (id) on delete restrict;
create index if not exists meta_publish_plans_runtime_instance_idx
  on public.meta_publish_plans (workspace_id, adstudio_runtime_instance_id)
  where adstudio_runtime_instance_id is not null;

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.meta_publish_plans'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%status%';

  if constraint_name is not null then
    execute format('alter table public.meta_publish_plans drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.meta_publish_plans
  add constraint meta_publish_plans_status_check
  check (status in (
    'draft', 'validating', 'queued', 'publishing', 'paused_ready',
    'activating', 'live', 'failed', 'reconciliation_required'
  ));

-- This table was confirmed empty. Dropping it fixes the RLS advisor finding;
-- fail closed if production drift made it non-empty after the inventory.
do $$
declare
  row_count bigint;
begin
  if to_regclass('legacy_archive.adstudio_brand_assets_ai_repair_20260620') is not null then
    execute 'select count(*) from legacy_archive.adstudio_brand_assets_ai_repair_20260620' into row_count;
    if row_count <> 0 then
      raise exception 'Refusing to drop non-empty legacy_archive.adstudio_brand_assets_ai_repair_20260620 (% rows)', row_count;
    end if;
    drop table legacy_archive.adstudio_brand_assets_ai_repair_20260620;
  end if;
end $$;
