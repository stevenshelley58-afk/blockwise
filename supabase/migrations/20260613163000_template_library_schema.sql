-- Template Library schema slice.
--
-- Additive support for overnight ad quality scoring and mined template
-- candidates. No existing tables, views, API shapes, auth, or provider
-- behaviour are changed.

begin;

create table if not exists research.ad_quality_scores (
  id uuid primary key default gen_random_uuid(),
  observed_ad_id uuid not null references research.observed_ads (id) on delete cascade,
  scored_at timestamptz not null default now(),
  scorer_version text not null,
  model text,
  image_model text,
  longevity_days integer not null default 0,
  is_active boolean not null default false,
  creative_versions integer not null default 0,
  cross_agency_count integer not null default 0,
  objective_score numeric(5,1) not null default 0,
  market_relevant boolean not null default true,
  offer_clarity integer,
  local_relevance integer,
  lead_intent integer,
  brand_fit integer,
  compliance_safety integer,
  visual_hierarchy integer,
  ai_score numeric(5,1),
  composite_score numeric(5,1) not null default 0,
  is_winner boolean not null default false,
  rationale text,
  warnings jsonb not null default '[]'::jsonb,
  decision_id uuid references research.agent_decisions (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ad_quality_scores_longevity_days_check
    check (longevity_days >= 0),
  constraint ad_quality_scores_creative_versions_check
    check (creative_versions >= 0),
  constraint ad_quality_scores_cross_agency_count_check
    check (cross_agency_count >= 0),
  constraint ad_quality_scores_objective_score_check
    check (objective_score >= 0 and objective_score <= 100),
  constraint ad_quality_scores_offer_clarity_check
    check (offer_clarity is null or (offer_clarity >= 0 and offer_clarity <= 20)),
  constraint ad_quality_scores_local_relevance_check
    check (local_relevance is null or (local_relevance >= 0 and local_relevance <= 15)),
  constraint ad_quality_scores_lead_intent_check
    check (lead_intent is null or (lead_intent >= 0 and lead_intent <= 20)),
  constraint ad_quality_scores_brand_fit_check
    check (brand_fit is null or (brand_fit >= 0 and brand_fit <= 15)),
  constraint ad_quality_scores_compliance_safety_check
    check (compliance_safety is null or (compliance_safety >= 0 and compliance_safety <= 20)),
  constraint ad_quality_scores_visual_hierarchy_check
    check (visual_hierarchy is null or (visual_hierarchy >= 0 and visual_hierarchy <= 10)),
  constraint ad_quality_scores_ai_score_check
    check (ai_score is null or (ai_score >= 0 and ai_score <= 100)),
  constraint ad_quality_scores_composite_score_check
    check (composite_score >= 0 and composite_score <= 100)
);

create index if not exists ad_quality_scores_ad_idx
  on research.ad_quality_scores (observed_ad_id, scored_at desc);

create index if not exists ad_quality_scores_winner_idx
  on research.ad_quality_scores (is_winner, composite_score desc)
  where is_winner;

create index if not exists ad_quality_scores_decision_idx
  on research.ad_quality_scores (decision_id)
  where decision_id is not null;

comment on table research.ad_quality_scores is
  'Overnight AI and objective quality scores per observed ad. Latest row per observed_ad_id is current. Written by the winner-scorer Hermes job.';

create table if not exists research.ad_template_image_briefs (
  brief_id text primary key,
  name text not null,
  concept text,
  layout text,
  imagery text,
  palette text,
  text_rules text,
  formats text[] not null default '{}',
  ai_prompt_seed text,
  updated_at timestamptz not null default now()
);

comment on table research.ad_template_image_briefs is
  'Reusable creative recipes referenced by mined ad templates.';

create table if not exists research.ad_template_candidates (
  id uuid primary key default gen_random_uuid(),
  template_key text unique,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  category text not null,
  audience text[] not null default '{}',
  format text[] not null default '{}',
  hook_style text,
  funnel_stage text,
  adstudio_template_id text,
  offer_id text,
  goal text,
  headline text,
  primary_text text,
  description text,
  cta text,
  variables text[] not null default '{}',
  image_brief_id text references research.ad_template_image_briefs (brief_id) on delete set null,
  evidence_score numeric(5,1) not null default 0,
  source_observed_ad_ids uuid[] not null default '{}',
  winner_rationale text,
  compliance_note text,
  scorer_version text,
  decision_id uuid references research.agent_decisions (id) on delete set null,
  approved_by uuid,
  approved_at timestamptz,
  constraint ad_template_candidates_status_check
    check (status in ('draft', 'approved', 'archived')),
  constraint ad_template_candidates_evidence_score_check
    check (evidence_score >= 0 and evidence_score <= 100)
);

create index if not exists ad_template_cand_facets_idx
  on research.ad_template_candidates (category, hook_style, funnel_stage, status);

create index if not exists ad_template_cand_score_idx
  on research.ad_template_candidates (status, evidence_score desc);

create index if not exists ad_template_cand_decision_idx
  on research.ad_template_candidates (decision_id)
  where decision_id is not null;

comment on table research.ad_template_candidates is
  'Templates mined nightly from winning ads. status=draft until operator approval; approved rows feed the template library.';

alter table research.ad_quality_scores enable row level security;
alter table research.ad_template_image_briefs enable row level security;
alter table research.ad_template_candidates enable row level security;

revoke all on research.ad_quality_scores from public, anon, authenticated;
revoke all on research.ad_template_image_briefs from public, anon, authenticated;
revoke all on research.ad_template_candidates from public, anon, authenticated;

grant all on research.ad_quality_scores to service_role;
grant all on research.ad_template_image_briefs to service_role;
grant all on research.ad_template_candidates to service_role;

drop policy if exists "ad_quality_scores_service_role_all" on research.ad_quality_scores;
create policy "ad_quality_scores_service_role_all" on research.ad_quality_scores
  as permissive for all to service_role using (true) with check (true);

drop policy if exists "ad_template_image_briefs_service_role_all" on research.ad_template_image_briefs;
create policy "ad_template_image_briefs_service_role_all" on research.ad_template_image_briefs
  as permissive for all to service_role using (true) with check (true);

drop policy if exists "ad_template_candidates_service_role_all" on research.ad_template_candidates;
create policy "ad_template_candidates_service_role_all" on research.ad_template_candidates
  as permissive for all to service_role using (true) with check (true);

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
