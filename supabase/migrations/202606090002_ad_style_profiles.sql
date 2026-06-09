-- Phase 1: Style-profile extractor — additive migration.
--
-- Adds research.ad_style_profiles (radar image → text style descriptor).
-- Also expands agent_decisions.decision_type to allow 'style_profile_extraction'.
--
-- Guardrails baked in:
--   - Competitor pixels are NEVER stored. Only AI-generated text + content hashes.
--   - Every write to ad_style_profiles must link a research.agent_decisions row.
--   - Table is service_role-only (mirrors all other research.* tables).
--
-- No existing table, view, API shape, auth, or provider behaviour is changed.

begin;

-- 1. Expand agent_decisions.decision_type check to include 'style_profile_extraction' ----
-- Locate and drop the existing check constraint (by content, not assumed name),
-- then re-add it with the new value appended.
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'research.agent_decisions'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%decision_type%';
  if cname is not null then
    execute format('alter table research.agent_decisions drop constraint %I', cname);
  end if;
end $$;

alter table research.agent_decisions
  add constraint agent_decisions_decision_type_check
  check (decision_type in (
    'page_resolution',
    'agent_match',
    'agency_match',
    'duplicate_merge',
    'coverage_audit',
    'defect_investigation',
    'ad_classification',
    'area_match',
    'cadence_change',
    'operator_chat',
    'real_estate_verification',
    'media_capture',
    'watchdog',
    'queue_operation',
    'style_profile_extraction'
  ));

-- 2. Style-profiles table -------------------------------------------------------------------
-- One row per media_asset (radar image). Input pixels are NEVER stored here.
-- descriptor is AI-generated text only. do_not_copy is always forced true.
create table if not exists research.ad_style_profiles (
  id                    uuid primary key default gen_random_uuid(),
  -- The source media asset (a captured radar/competitor ad image).
  -- on delete restrict so profiles are not silently orphaned.
  media_asset_id        uuid not null references research.media_assets (id) on delete restrict,
  -- De-normalised reference to the parent ad for simpler queries.
  observed_ad_id        uuid not null references research.observed_ads (id) on delete cascade,
  -- Content hashes of the image(s) fed to the vision model.
  -- Used for cache-hit detection and the similarity guard.
  -- Pixel data itself never leaves the extractor process.
  source_content_hashes text[] not null default '{}',
  -- AI-generated text descriptor. Shape is stable across extractor versions:
  -- { composition, crop, lighting, time_of_day, palette: string[],
  --   mood, lens, do_not_copy: true }
  descriptor            jsonb not null,
  extractor_version     text not null default 'style-extractor-v1',
  model                 text,
  -- Every write must reference an agent_decisions row (Hermes rule 5).
  decision_id           uuid references research.agent_decisions (id) on delete set null,
  created_at            timestamptz not null default now()
);

-- One profile per media asset (dedup / cache key).
create unique index if not exists ad_style_profiles_media_asset_uidx
  on research.ad_style_profiles (media_asset_id);

create index if not exists ad_style_profiles_observed_ad_idx
  on research.ad_style_profiles (observed_ad_id);

create index if not exists ad_style_profiles_decision_idx
  on research.ad_style_profiles (decision_id)
  where decision_id is not null;

comment on table research.ad_style_profiles is
  'AI-generated text style descriptors extracted from radar (competitor) ad images '
  'by the style-profile extractor. Competitor pixels are NEVER stored here; only the '
  'text output of the vision model and content hashes of the source images. '
  'do_not_copy=true is always enforced in the descriptor by the extractor. '
  'Every row links a research.agent_decisions row via decision_id.';

-- 3. RLS — service_role writes only, mirroring all other research.* tables ----------------
alter table research.ad_style_profiles enable row level security;
revoke all on research.ad_style_profiles from public, anon, authenticated;
grant all on research.ad_style_profiles to service_role;

create policy "ad_style_profiles_service_role_all" on research.ad_style_profiles
  as permissive for all to service_role using (true) with check (true);

commit;

-- ============================================================================
-- MIGRATION ASSERTIONS (run after apply; wire into test suite).
-- ============================================================================
-- do $$
-- begin
--   assert (select count(*) from information_schema.tables
--           where table_schema = 'research'
--             and table_name = 'ad_style_profiles') = 1,
--          'expected research.ad_style_profiles table';
--
--   assert (select count(*) from information_schema.columns
--           where table_schema = 'research'
--             and table_name = 'ad_style_profiles'
--             and column_name in (
--               'id','media_asset_id','observed_ad_id',
--               'source_content_hashes','descriptor','extractor_version',
--               'model','decision_id','created_at'
--             )) = 9,
--          'expected 9 columns on research.ad_style_profiles';
--
--   assert (select count(*) from pg_constraint
--           where conrelid = 'research.agent_decisions'::regclass
--             and contype = 'c'
--             and pg_get_constraintdef(oid) like '%style_profile_extraction%') = 1,
--          'expected style_profile_extraction in agent_decisions.decision_type check';
--
--   -- additive: no existing observed_ads columns changed
--   assert (select count(*) from information_schema.columns
--           where table_schema = 'research' and table_name = 'observed_ads') >= 15,
--          'observed_ads columns must be unchanged/superset';
-- end $$;
