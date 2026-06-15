-- Ad Studio Template Engine foundation.
--
-- One additive migration owns the shared data contract for creative
-- skeletons, mined template exemplars, and owned-ad performance inputs.

begin;

alter table if exists research.ad_template_image_briefs
  add column if not exists creative_skeleton jsonb,
  add column if not exists skeleton_version integer not null default 1;

alter table if exists research.ad_template_image_briefs
  drop constraint if exists ad_template_image_briefs_skeleton_json_check,
  add constraint ad_template_image_briefs_skeleton_json_check
    check (creative_skeleton is null or jsonb_typeof(creative_skeleton) = 'object'),
  drop constraint if exists ad_template_image_briefs_skeleton_version_check,
  add constraint ad_template_image_briefs_skeleton_version_check
    check (skeleton_version >= 1);

comment on column research.ad_template_image_briefs.creative_skeleton is
  'Canonical CreativeSkeleton JSON for reusable template-level image briefs.';
comment on column research.ad_template_image_briefs.skeleton_version is
  'CreativeSkeleton schema version. Version 1 is src/lib/ad-template-library/skeleton.ts.';

create table if not exists research.creative_skeletons (
  observed_ad_id uuid primary key references research.observed_ads (id) on delete cascade,
  ad_creative_id uuid references research.ad_creatives (id) on delete set null,
  creative_skeleton jsonb not null,
  skeleton_version integer not null default 1,
  extractor_version text not null,
  model text,
  confidence numeric(5,1),
  extracted_at timestamptz not null default now(),
  decision_id uuid references research.agent_decisions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creative_skeletons_skeleton_json_check
    check (jsonb_typeof(creative_skeleton) = 'object'),
  constraint creative_skeletons_skeleton_version_check
    check (skeleton_version >= 1),
  constraint creative_skeletons_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 100))
);

create index if not exists creative_skeletons_ad_creative_idx
  on research.creative_skeletons (ad_creative_id)
  where ad_creative_id is not null;

create index if not exists creative_skeletons_extracted_idx
  on research.creative_skeletons (extracted_at desc);

alter table research.creative_skeletons enable row level security;

revoke all on research.creative_skeletons from public, anon, authenticated;
grant all on research.creative_skeletons to service_role;

drop policy if exists "creative_skeletons_service_role_all" on research.creative_skeletons;
create policy "creative_skeletons_service_role_all" on research.creative_skeletons
  as permissive for all to service_role using (true) with check (true);

comment on table research.creative_skeletons is
  'Per-observed-ad CreativeSkeleton JSON extracted from winning ad images. Used by template distillation.';

alter table if exists research.ad_template_candidates
  add column if not exists creative_skeleton jsonb,
  add column if not exists exemplar_observed_ad_ids uuid[] not null default '{}';

alter table if exists research.ad_template_candidates
  drop constraint if exists ad_template_candidates_skeleton_json_check,
  add constraint ad_template_candidates_skeleton_json_check
    check (creative_skeleton is null or jsonb_typeof(creative_skeleton) = 'object');

create index if not exists ad_template_candidates_exemplars_gin_idx
  on research.ad_template_candidates using gin (exemplar_observed_ad_ids);

comment on column research.ad_template_candidates.creative_skeleton is
  'Canonical CreativeSkeleton JSON distilled from winning ads in the cluster.';
comment on column research.ad_template_candidates.exemplar_observed_ad_ids is
  'Representative observed ads used as visual references for the distilled template.';

create table if not exists research.owned_ad_performance (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  adstudio_creative_id uuid references public.adstudio_creatives (id) on delete set null,
  adstudio_campaign_id uuid references public.adstudio_campaigns (id) on delete set null,
  template_key text,
  observed_ad_id uuid references research.observed_ads (id) on delete set null,
  meta_ad_id text,
  meta_adset_id text,
  meta_campaign_id text,
  impressions integer not null default 0,
  clicks integer not null default 0,
  leads integer not null default 0,
  qualified_leads integer not null default 0,
  spend_cents integer not null default 0,
  ctr numeric(8,4),
  cpl_cents integer,
  lead_quality_score numeric(5,1),
  reported_at timestamptz not null default now(),
  source text not null default 'meta_monitor',
  raw_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owned_ad_performance_non_negative_counts_check
    check (
      impressions >= 0
      and clicks >= 0
      and leads >= 0
      and qualified_leads >= 0
      and spend_cents >= 0
      and (cpl_cents is null or cpl_cents >= 0)
    ),
  constraint owned_ad_performance_ctr_check
    check (ctr is null or ctr >= 0),
  constraint owned_ad_performance_quality_check
    check (lead_quality_score is null or (lead_quality_score >= 0 and lead_quality_score <= 100)),
  constraint owned_ad_performance_raw_metrics_check
    check (jsonb_typeof(raw_metrics) = 'object')
);

create index if not exists owned_ad_performance_workspace_reported_idx
  on research.owned_ad_performance (workspace_id, reported_at desc);

create index if not exists owned_ad_performance_template_idx
  on research.owned_ad_performance (workspace_id, template_key, reported_at desc)
  where template_key is not null;

create index if not exists owned_ad_performance_creative_idx
  on research.owned_ad_performance (workspace_id, adstudio_creative_id, reported_at desc)
  where adstudio_creative_id is not null;

create unique index if not exists owned_ad_performance_workspace_meta_ad_reported_unique
  on research.owned_ad_performance (workspace_id, meta_ad_id, reported_at, source);

alter table research.owned_ad_performance enable row level security;

revoke all on research.owned_ad_performance from public, anon, authenticated;
grant all on research.owned_ad_performance to service_role;

drop policy if exists "owned_ad_performance_service_role_all" on research.owned_ad_performance;
create policy "owned_ad_performance_service_role_all" on research.owned_ad_performance
  as permissive for all to service_role using (true) with check (true);

comment on table research.owned_ad_performance is
  'Workspace-scoped performance metrics for Blockwise-generated ads, ingested by service-role jobs from meta-monitor.';

insert into public.model_profiles (key, name, task, enabled, requires_structured_output, default_temperature, max_run_cost_cents)
values
  ('vision_extract', 'Vision extraction', 'Schema-bound creative skeleton extraction from winning ad images', true, true, 0.10, 80)
on conflict (key) do update
set
  name = excluded.name,
  task = excluded.task,
  enabled = excluded.enabled,
  requires_structured_output = excluded.requires_structured_output,
  default_temperature = excluded.default_temperature,
  max_run_cost_cents = excluded.max_run_cost_cents;

with primary_versions(profile_key, provider, model, input_cost, output_cost, image_cost, structured, max_context) as (
  values
    ('vision_extract', 'openai', 'gpt-4.1-mini', 0.4000, 1.6000, 0.0100, true, 128000)
)
insert into public.model_profile_versions (
  model_profile_id,
  provider,
  model,
  input_usd_per_million_tokens,
  output_usd_per_million_tokens,
  image_usd_per_unit,
  supports_structured_output,
  max_context_tokens,
  active_from
)
select
  mp.id,
  primary_versions.provider,
  primary_versions.model,
  primary_versions.input_cost,
  primary_versions.output_cost,
  primary_versions.image_cost,
  primary_versions.structured,
  primary_versions.max_context,
  now()
from primary_versions
join public.model_profiles mp on mp.key = primary_versions.profile_key
where not exists (
  select 1
  from public.model_profile_versions existing
  where existing.model_profile_id = mp.id
    and existing.active_to is null
);

create or replace view research.v_ad_template_library as
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
  b.ai_prompt_seed,
  coalesce(c.creative_skeleton, b.creative_skeleton) as creative_skeleton,
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
