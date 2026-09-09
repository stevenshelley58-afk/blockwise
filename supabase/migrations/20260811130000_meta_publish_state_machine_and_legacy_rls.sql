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
-- reports intentionally remain NULL and therefore fail closed;
-- never backfill a hash from timestamps or mutable campaign rows.
alter table public.adstudio_compliance_reports
  add column if not exists subject_hash text;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.adstudio_compliance_reports'::regclass
      and conname = 'adstudio_compliance_reports_subject_hash_check'
  ) then
    alter table public.adstudio_compliance_reports
      add constraint adstudio_compliance_reports_subject_hash_check
      check (subject_hash is null or subject_hash ~ '^[A-Fa-f0-9]{64}$');
  end if;
end $$;
create index if not exists adstudio_compliance_reports_subject_hash_idx
  on public.adstudio_compliance_reports (workspace_id, campaign_id, subject_hash)
  where subject_hash is not null;

alter table public.meta_publish_plans
  drop constraint if exists meta_publish_plans_status_check;

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
