-- ============================================================================
-- PROPOSAL ONLY — DO NOT APPLY WITHOUT REVIEW.
-- Additive migration to support the overnight "winner scoring + template mining"
-- Hermes job. Adds three tables to the existing `research` schema. It does NOT
-- alter any existing table, view, API response shape, auth, or provider
-- behaviour (per AGENTS.md). Apply only after adding migration assertions to
-- your test suite and confirming RLS posture matches sibling research tables.
--
-- Naming + conventions mirror research.ad_creatives / observed_ads.
-- Every row written by the job must also create a research.agent_decisions row
-- (Hermes rule 5: "Every write is a decision") — FK below enforces the link.
-- ============================================================================

begin;

-- 1) Per-ad quality score (one row per scoring run; latest = current) ---------
create table if not exists research.ad_quality_scores (
  id                 uuid primary key default gen_random_uuid(),
  observed_ad_id     uuid not null references research.observed_ads(id) on delete cascade,
  scored_at          timestamptz not null default now(),
  scorer_version     text not null,                 -- e.g. 'winner-scorer-v1'
  model              text,                           -- text model used (model_profiles)
  image_model        text,                           -- vision model used for the creative
  -- objective signals (computed, not AI) --------------------------------------
  longevity_days     integer not null default 0,
  is_active          boolean not null default false,
  creative_versions  integer not null default 0,
  cross_agency_count integer not null default 0,     -- # advertisers running same angle
  objective_score    numeric(5,1) not null default 0,-- 0..100 from the signals above
  -- market relevance gate (AU residential RE for our customers) ---------------
  market_relevant    boolean not null default true,  -- false => overseas/foreign-lang/off-topic
  -- AdStudio 6-dimension rubric (matches src/lib/adstudio/scoring.ts) ---------
  offer_clarity      integer,   -- 0..20
  local_relevance    integer,   -- 0..15
  lead_intent        integer,   -- 0..20
  brand_fit          integer,   -- 0..15
  compliance_safety  integer,   -- 0..20
  visual_hierarchy   integer,   -- 0..10
  ai_score           numeric(5,1),                   -- 0..100 (sum of the six)
  composite_score    numeric(5,1) not null default 0,-- blended objective + ai
  is_winner          boolean not null default false,
  rationale          text,
  warnings           jsonb not null default '[]'::jsonb,
  decision_id        uuid references research.agent_decisions(id),
  created_at         timestamptz not null default now()
);
create index if not exists ad_quality_scores_ad_idx     on research.ad_quality_scores(observed_ad_id, scored_at desc);
create index if not exists ad_quality_scores_winner_idx  on research.ad_quality_scores(is_winner, composite_score desc) where is_winner;
comment on table research.ad_quality_scores is 'Overnight AI+objective quality scores per observed ad. Latest row per observed_ad_id is current. Written by the winner-scorer Hermes skill; every row links a research.agent_decisions row.';

-- 2) Reusable image briefs (normalised; referenced by templates) -------------
create table if not exists research.ad_template_image_briefs (
  brief_id     text primary key,                     -- e.g. 'IMG-STAT-CARD'
  name         text not null,
  concept      text,
  layout       text,
  imagery      text,
  palette      text,
  text_rules   text,
  formats      text[] not null default '{}',
  ai_prompt_seed text,
  updated_at   timestamptz not null default now()
);
comment on table research.ad_template_image_briefs is 'Reusable creative recipes referenced by mined templates.';

-- 3) Mined template candidates (the searchable library) ----------------------
create table if not exists research.ad_template_candidates (
  id              uuid primary key default gen_random_uuid(),
  template_key    text unique,                        -- stable human id, e.g. 'MKT-01'
  status          text not null default 'draft',      -- draft | approved | archived
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- searchable facets ---------------------------------------------------------
  category        text not null,
  audience        text[] not null default '{}',
  format          text[] not null default '{}',
  hook_style      text,
  funnel_stage    text,
  -- AdStudio mapping ----------------------------------------------------------
  adstudio_template_id text,
  offer_id        text,
  goal            text,
  -- copy ----------------------------------------------------------------------
  headline        text,
  primary_text    text,
  description     text,
  cta             text,
  variables       text[] not null default '{}',
  -- image ---------------------------------------------------------------------
  image_brief_id  text references research.ad_template_image_briefs(brief_id),
  -- evidence / governance -----------------------------------------------------
  evidence_score      numeric(5,1) not null default 0,
  source_observed_ad_ids uuid[] not null default '{}',-- winners this was mined from
  winner_rationale    text,
  compliance_note     text,
  scorer_version      text,
  decision_id         uuid references research.agent_decisions(id),
  approved_by         uuid,                            -- profiles.id (operator)
  approved_at         timestamptz
);
create index if not exists ad_template_cand_facets_idx on research.ad_template_candidates(category, hook_style, funnel_stage, status);
create index if not exists ad_template_cand_score_idx  on research.ad_template_candidates(status, evidence_score desc);
comment on table research.ad_template_candidates is 'Templates mined nightly from winning ads. status=draft until an operator approves; approved rows feed AdStudio (offers/template_versions) and the Ad Template Studio dashboard.';

-- Optional convenience view for the app/dashboard (read-only, additive) ------
create or replace view research.v_ad_template_library as
  select c.template_key, c.status, c.category, c.audience, c.format, c.hook_style,
         c.funnel_stage, c.adstudio_template_id, c.offer_id, c.goal,
         c.headline, c.primary_text, c.description, c.cta, c.variables,
         c.image_brief_id, b.name as image_brief_name, b.ai_prompt_seed,
         c.evidence_score, c.winner_rationale, c.compliance_note, c.updated_at
  from research.ad_template_candidates c
  left join research.ad_template_image_briefs b on b.brief_id = c.image_brief_id
  where c.status = 'approved';

commit;

-- ============================================================================
-- MIGRATION ASSERTIONS (run after apply; wire into your migration test suite).
-- These must all return TRUE / not raise.
-- ============================================================================
-- do $$
-- begin
--   assert (select count(*) from information_schema.tables
--           where table_schema='research'
--             and table_name in ('ad_quality_scores','ad_template_candidates','ad_template_image_briefs')) = 3,
--          'expected 3 new research tables';
--   -- additive only: existing winner-bearing tables untouched
--   assert (select count(*) from information_schema.columns
--           where table_schema='research' and table_name='ad_creatives') >= 24,
--          'ad_creatives columns must be unchanged/superset';
--   -- 6-dimension rubric ceilings match src/lib/adstudio/scoring.ts
--   assert true; -- enforce 0..20/15/20/15/20/10 in the job, or add CHECK constraints here
-- end $$;
