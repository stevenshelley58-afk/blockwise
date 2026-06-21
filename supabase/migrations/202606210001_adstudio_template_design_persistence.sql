-- Ad Studio TemplateDesign persistence bridge.
--
-- Adds the v10 template family/version tables so design documents have a
-- durable landing zone, and lets approved research template candidates expose
-- renderable TemplateDesign sets to the picker/generator.

begin;

create table if not exists public.ad_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  key text not null,
  name text not null,
  status text not null default 'draft',
  category text,
  ad_type text,
  hook_style text,
  funnel_stage text,
  brief_schema jsonb not null default '{}'::jsonb,
  formats text[] not null default '{}',
  source text not null default 'builtin',
  source_asset_url text,
  latest_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_templates_status_check
    check (status in ('draft', 'approved', 'archived')),
  constraint ad_templates_source_check
    check (source in ('builtin', 'sample_import', 'radar', 'operator')),
  constraint ad_templates_brief_schema_json_check
    check (jsonb_typeof(brief_schema) = 'object'),
  constraint ad_templates_latest_version_check
    check (latest_version >= 1)
);

create unique index if not exists ad_templates_workspace_key_unique
  on public.ad_templates (coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create index if not exists ad_templates_workspace_status_idx
  on public.ad_templates (workspace_id, status, updated_at desc);

create table if not exists public.ad_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.ad_templates (id) on delete cascade,
  version integer not null default 1,
  design jsonb not null,
  design_schema_version integer not null default 1,
  thumbnail_path text,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ad_template_versions_design_json_check
    check (jsonb_typeof(design) = 'object'),
  constraint ad_template_versions_design_schema_version_check
    check (design_schema_version >= 1),
  constraint ad_template_versions_version_check
    check (version >= 1),
  unique (template_id, version)
);

create index if not exists ad_template_versions_template_created_idx
  on public.ad_template_versions (template_id, created_at desc);

alter table public.ad_templates enable row level security;
alter table public.ad_template_versions enable row level security;

revoke all on public.ad_templates from public, anon, authenticated;
revoke all on public.ad_template_versions from public, anon, authenticated;
grant select on public.ad_templates to authenticated;
grant select on public.ad_template_versions to authenticated;
grant all on public.ad_templates to service_role;
grant all on public.ad_template_versions to service_role;

drop policy if exists ad_templates_select on public.ad_templates;
create policy ad_templates_select on public.ad_templates
  for select to authenticated
  using (
    workspace_id is null
    or public.is_operator()
    or public.is_workspace_member(workspace_id)
  );

drop policy if exists ad_templates_insert on public.ad_templates;
create policy ad_templates_insert on public.ad_templates
  for insert to authenticated
  with check (
    (workspace_id is null and public.is_operator())
    or (
      workspace_id is not null
      and public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator'])
    )
  );

drop policy if exists ad_templates_update on public.ad_templates;
create policy ad_templates_update on public.ad_templates
  for update to authenticated
  using (
    public.is_operator()
    or (
      workspace_id is not null
      and public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator'])
    )
  )
  with check (
    (workspace_id is null and public.is_operator())
    or (
      workspace_id is not null
      and public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator'])
    )
  );

drop policy if exists ad_templates_delete on public.ad_templates;
create policy ad_templates_delete on public.ad_templates
  for delete to authenticated
  using (
    public.is_operator()
    or (
      workspace_id is not null
      and public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator'])
    )
  );

drop policy if exists ad_templates_service_role_all on public.ad_templates;
create policy ad_templates_service_role_all on public.ad_templates
  as permissive for all to service_role using (true) with check (true);

drop policy if exists ad_template_versions_select on public.ad_template_versions;
create policy ad_template_versions_select on public.ad_template_versions
  for select to authenticated
  using (
    exists (
      select 1
      from public.ad_templates t
      where t.id = template_id
        and (
          t.workspace_id is null
          or public.is_operator()
          or public.is_workspace_member(t.workspace_id)
        )
    )
  );

drop policy if exists ad_template_versions_insert on public.ad_template_versions;
create policy ad_template_versions_insert on public.ad_template_versions
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.ad_templates t
      where t.id = template_id
        and (
          (t.workspace_id is null and public.is_operator())
          or (
            t.workspace_id is not null
            and public.has_workspace_role(t.workspace_id, array['owner', 'admin', 'operator'])
          )
        )
    )
  );

drop policy if exists ad_template_versions_update on public.ad_template_versions;
create policy ad_template_versions_update on public.ad_template_versions
  for update to authenticated
  using (
    exists (
      select 1
      from public.ad_templates t
      where t.id = template_id
        and (
          public.is_operator()
          or (
            t.workspace_id is not null
            and public.has_workspace_role(t.workspace_id, array['owner', 'admin', 'operator'])
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.ad_templates t
      where t.id = template_id
        and (
          (t.workspace_id is null and public.is_operator())
          or (
            t.workspace_id is not null
            and public.has_workspace_role(t.workspace_id, array['owner', 'admin', 'operator'])
          )
        )
    )
  );

drop policy if exists ad_template_versions_delete on public.ad_template_versions;
create policy ad_template_versions_delete on public.ad_template_versions
  for delete to authenticated
  using (
    exists (
      select 1
      from public.ad_templates t
      where t.id = template_id
        and (
          public.is_operator()
          or (
            t.workspace_id is not null
            and public.has_workspace_role(t.workspace_id, array['owner', 'admin', 'operator'])
          )
      )
    )
  );

drop policy if exists ad_template_versions_service_role_all on public.ad_template_versions;
create policy ad_template_versions_service_role_all on public.ad_template_versions
  as permissive for all to service_role using (true) with check (true);

comment on table public.ad_templates is
  'Ad Studio v10 template families. workspace_id null means global builtin/operator-approved template.';
comment on table public.ad_template_versions is
  'Immutable TemplateDesign documents. Campaigns snapshot the resolved version at generation time.';
comment on column public.ad_template_versions.design is
  'TemplateDesign or per-format TemplateDesignSet JSON used by the v10 renderer.';

create table if not exists public.adstudio_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid references public.adstudio_campaigns (id) on delete cascade,
  template_id uuid references public.ad_templates (id) on delete set null,
  template_version_id uuid references public.ad_template_versions (id) on delete set null,
  kind text not null,
  status text not null default 'queued',
  correlation_id text,
  result jsonb not null default '{}'::jsonb,
  error text,
  attempts integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint adstudio_generation_jobs_kind_check
    check (kind in ('copy', 'photo_prep', 'render', 'qa', 'publish')),
  constraint adstudio_generation_jobs_status_check
    check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  constraint adstudio_generation_jobs_result_json_check
    check (jsonb_typeof(result) = 'object'),
  constraint adstudio_generation_jobs_attempts_check
    check (attempts >= 0)
);

create index if not exists adstudio_generation_jobs_workspace_status_idx
  on public.adstudio_generation_jobs (workspace_id, status, created_at desc);

create index if not exists adstudio_generation_jobs_campaign_idx
  on public.adstudio_generation_jobs (campaign_id, created_at desc)
  where campaign_id is not null;

create index if not exists adstudio_generation_jobs_correlation_idx
  on public.adstudio_generation_jobs (workspace_id, correlation_id)
  where correlation_id is not null;

alter table public.adstudio_generation_jobs enable row level security;

revoke all on public.adstudio_generation_jobs from public, anon, authenticated;
grant select on public.adstudio_generation_jobs to authenticated;
grant all on public.adstudio_generation_jobs to service_role;

drop policy if exists adstudio_generation_jobs_select on public.adstudio_generation_jobs;
create policy adstudio_generation_jobs_select on public.adstudio_generation_jobs
  for select to authenticated
  using (public.is_operator() or public.is_workspace_member(workspace_id));

drop policy if exists adstudio_generation_jobs_service_role_all on public.adstudio_generation_jobs;
create policy adstudio_generation_jobs_service_role_all on public.adstudio_generation_jobs
  as permissive for all to service_role using (true) with check (true);

comment on table public.adstudio_generation_jobs is
  'User-visible campaign generation job ledger for copy, photo prep, render, QA, and publish stages.';

alter table if exists public.adstudio_campaigns
  add column if not exists template_id uuid references public.ad_templates (id) on delete set null,
  add column if not exists template_version_id uuid references public.ad_template_versions (id) on delete set null,
  add column if not exists template_version_hash text,
  add column if not exists generation_job_id uuid references public.adstudio_generation_jobs (id) on delete set null;

alter table if exists public.adstudio_campaigns
  drop constraint if exists adstudio_campaigns_template_version_hash_check,
  add constraint adstudio_campaigns_template_version_hash_check
    check (template_version_hash is null or length(template_version_hash) >= 12);

create index if not exists adstudio_campaigns_template_version_idx
  on public.adstudio_campaigns (workspace_id, template_version_id, created_at desc)
  where template_version_id is not null;

create index if not exists adstudio_campaigns_generation_job_idx
  on public.adstudio_campaigns (workspace_id, generation_job_id)
  where generation_job_id is not null;

comment on column public.adstudio_campaigns.template_version_id is
  'Immutable v10 template version row used at generation time; template_snapshot_json still stores the resolved design.';
comment on column public.adstudio_campaigns.template_version_hash is
  'Stable hash of the resolved TemplateDesign JSON for audit and cache keys.';
comment on column public.adstudio_campaigns.generation_job_id is
  'Latest campaign generation job surfaced to the editor/generating screen.';

create table if not exists public.ad_fonts (
  family text primary key,
  display_name text not null,
  category text not null,
  css_src text,
  weights integer[] not null default array[400, 700],
  file_path text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_fonts_category_check
    check (category in ('sans', 'serif', 'display', 'script', 'mono')),
  constraint ad_fonts_status_check
    check (status in ('active', 'archived')),
  constraint ad_fonts_weights_check
    check (array_length(weights, 1) is not null)
);

alter table public.ad_fonts enable row level security;

revoke all on public.ad_fonts from public, anon, authenticated;
grant select on public.ad_fonts to authenticated;
grant all on public.ad_fonts to service_role;

drop policy if exists ad_fonts_authenticated_select on public.ad_fonts;
create policy ad_fonts_authenticated_select on public.ad_fonts
  for select to authenticated using (status = 'active');

drop policy if exists ad_fonts_service_role_all on public.ad_fonts;
create policy ad_fonts_service_role_all on public.ad_fonts
  as permissive for all to service_role using (true) with check (true);

insert into public.ad_fonts (family, display_name, category, css_src, weights, status)
values
  ('Inter', 'Inter', 'sans', 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap', array[400, 500, 600, 700, 800, 900], 'active'),
  ('Georgia', 'Georgia', 'serif', null, array[400, 700], 'active'),
  ('Arial', 'Arial', 'sans', null, array[400, 700], 'active')
on conflict (family) do update
set
  display_name = excluded.display_name,
  category = excluded.category,
  css_src = excluded.css_src,
  weights = excluded.weights,
  status = excluded.status,
  updated_at = now();

comment on table public.ad_fonts is
  'Closed font registry shared by the Ad Studio picker, renderer, and export pipeline.';

alter table if exists research.ad_template_image_briefs
  add column if not exists template_designs jsonb,
  add column if not exists design_schema_version integer not null default 1,
  add column if not exists brief_schema jsonb not null default '{}'::jsonb;

alter table if exists research.ad_template_candidates
  add column if not exists template_designs jsonb,
  add column if not exists template_version integer not null default 1,
  add column if not exists source_asset_url text,
  add column if not exists brief_schema jsonb not null default '{}'::jsonb;

alter table if exists research.ad_template_image_briefs
  drop constraint if exists ad_template_image_briefs_template_designs_json_check,
  add constraint ad_template_image_briefs_template_designs_json_check
    check (template_designs is null or jsonb_typeof(template_designs) = 'object'),
  drop constraint if exists ad_template_image_briefs_design_schema_version_check,
  add constraint ad_template_image_briefs_design_schema_version_check
    check (design_schema_version >= 1),
  drop constraint if exists ad_template_image_briefs_brief_schema_json_check,
  add constraint ad_template_image_briefs_brief_schema_json_check
    check (jsonb_typeof(brief_schema) = 'object');

alter table if exists research.ad_template_candidates
  drop constraint if exists ad_template_candidates_template_designs_json_check,
  add constraint ad_template_candidates_template_designs_json_check
    check (template_designs is null or jsonb_typeof(template_designs) = 'object'),
  drop constraint if exists ad_template_candidates_template_version_check,
  add constraint ad_template_candidates_template_version_check
    check (template_version >= 1),
  drop constraint if exists ad_template_candidates_brief_schema_json_check,
  add constraint ad_template_candidates_brief_schema_json_check
    check (jsonb_typeof(brief_schema) = 'object');

create index if not exists ad_template_candidates_designs_idx
  on research.ad_template_candidates (status, template_version desc)
  where template_designs is not null;

comment on column research.ad_template_candidates.template_designs is
  'Per-format TemplateDesignSet JSON approved or drafted for this mined/operator template.';
comment on column research.ad_template_candidates.template_version is
  'Immutable design version written to public.adstudio_template_versions on approval.';
comment on column research.ad_template_candidates.source_asset_url is
  'Original source image URL used by the template extractor/operator review flow.';
comment on column research.ad_template_candidates.brief_schema is
  'Template-specific brief fields needed before campaign generation.';

drop view if exists research.v_ad_template_library;

create view research.v_ad_template_library as
select
  c.template_key,
  c.status,
  c.category,
  c.audience,
  c.format,
  c.hook_style,
  c.funnel_stage,
  c.adstudio_template_id,
  c.offer_id,
  c.goal,
  c.headline,
  c.primary_text,
  c.description,
  c.cta,
  c.variables,
  c.image_brief_id,
  b.name as image_brief_name,
  c.sample_card_image_path,
  c.sample_style,
  b.ai_prompt_seed,
  coalesce(c.creative_skeleton, b.creative_skeleton) as creative_skeleton,
  coalesce(c.template_designs, b.template_designs) as template_designs,
  c.template_version,
  coalesce(c.brief_schema, b.brief_schema) as brief_schema,
  c.source_asset_url,
  c.exemplar_observed_ad_ids,
  c.evidence_score,
  c.winner_rationale,
  c.compliance_note,
  c.updated_at
from research.ad_template_candidates c
left join research.ad_template_image_briefs b on b.brief_id = c.image_brief_id
where c.status = 'approved';

revoke all on research.v_ad_template_library from public, anon, authenticated;
grant select on research.v_ad_template_library to service_role;

commit;

