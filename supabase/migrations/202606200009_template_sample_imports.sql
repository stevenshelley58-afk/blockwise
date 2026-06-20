-- Ad Studio Template Generator — sample imports.
--
-- An operator drops a sample creative (an uploaded PNG, or a scraped winning ad)
-- and the shared extractor turns it into a draft ad_template_candidates row with a
-- populated creative_skeleton (image_frames + copy-safe zones + classification).
-- This table tracks each sample import and links it to the candidate it produced.
-- Service-role only (the operator surfaces read/write through service-role code);
-- RLS is enabled with operator-read and no client writes.

begin;

create table if not exists research.template_sample_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  sample_asset_url text not null,
  image_hash text not null,
  extracted_json jsonb,
  status text not null default 'draft',
  candidate_template_key text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint template_sample_imports_status_check
    check (status in ('draft', 'approved', 'archived')),
  constraint template_sample_imports_extracted_json_check
    check (extracted_json is null or jsonb_typeof(extracted_json) = 'object')
);

create index if not exists template_sample_imports_workspace_status_idx
  on research.template_sample_imports (workspace_id, status, created_at desc);

create unique index if not exists template_sample_imports_workspace_hash_unique
  on research.template_sample_imports (workspace_id, image_hash);

alter table research.template_sample_imports enable row level security;

drop policy if exists template_sample_imports_operator_select on research.template_sample_imports;
create policy template_sample_imports_operator_select on research.template_sample_imports
  for select using (public.is_operator());

drop policy if exists template_sample_imports_no_client_insert on research.template_sample_imports;
drop policy if exists template_sample_imports_no_client_update on research.template_sample_imports;
drop policy if exists template_sample_imports_no_client_delete on research.template_sample_imports;
create policy template_sample_imports_no_client_insert
  on research.template_sample_imports for insert to authenticated with check (false);
create policy template_sample_imports_no_client_update
  on research.template_sample_imports for update to authenticated using (false) with check (false);
create policy template_sample_imports_no_client_delete
  on research.template_sample_imports for delete to authenticated using (false);

comment on table research.template_sample_imports is
  'Operator sample-creative imports for the Ad Studio template generator. Each row links a sample image to the draft ad_template_candidates row extracted from it. Service-role only.';

commit;
