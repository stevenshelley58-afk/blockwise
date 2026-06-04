-- Hermes Research Engine — Phase 1
-- Drop legacy research tables introduced by the removed
-- 202605270004_research_intel.sql migration.
--
-- The legacy migration was untracked / never committed but may have been
-- applied to local dev databases. This migration is idempotent: it is safe
-- on production (where the legacy tables never existed) and on dev (where
-- they may exist).
--
-- The new research engine lives in its own `research` schema, created in the
-- next migration (202605280003_research_engine.sql). The public.observed_ads
-- and related v1 competitor-research tables from 202605260001_initial_blockwise
-- are left untouched for now — they will be retired in a separate migration
-- once the new research surface is live and the customer /research page is
-- rewired to research.v_*.

-- Drop foreign-key constraints first by dropping dependent tables in order.
drop table if exists public.ad_area_matches cascade;
drop table if exists public.ad_creatives cascade;
drop table if exists public.ad_snapshots cascade;
drop table if exists public.ad_fetch_runs cascade;
drop table if exists public.agent_census_defects cascade;
drop table if exists public.agent_census_audits cascade;
drop table if exists public.agent_service_areas cascade;
drop table if exists public.advertiser_pages cascade;
drop table if exists public.agent_source_records cascade;
drop table if exists public.agent_entity_links cascade;
drop table if exists public.agent_entities cascade;

-- The legacy 202605270004 migration also added columns to public.observed_ads.
-- Drop those columns if they were added.
alter table if exists public.observed_ads
  drop column if exists advertiser_page_id,
  drop column if exists external_ad_id,
  drop column if exists source_provider,
  drop column if exists active_status,
  drop column if exists first_seen_at,
  drop column if exists last_seen_at,
  drop column if exists last_checked_at,
  drop column if exists missing_successive_checks,
  drop column if exists raw_payload;

-- Drop indexes the legacy migration created on public.observed_ads if they
-- still exist (CASCADE on the table drops would not catch these if the
-- table was preserved).
drop index if exists public.observed_ads_workspace_page_external_idx;
drop index if exists public.observed_ads_workspace_provider_external_idx;
