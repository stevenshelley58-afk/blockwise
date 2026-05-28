-- Hermes Research Engine — Phase 1
-- Curated views that the Blockwise app reads from.
--
-- App surfaces NEVER query research.* tables directly. They query these
-- views, which are the stable contract between the research engine
-- and the rest of Blockwise. If the underlying schema changes, the views
-- absorb the change.
--
-- All views are owner = service_role; we grant SELECT to authenticated +
-- anon explicitly at the bottom of this file.

-- ---------------------------------------------------------------------------
-- v_active_ads_by_postcode
-- ---------------------------------------------------------------------------
-- One row per (postcode, observed_ad) pair where the ad is currently active
-- and confidently matched to that postcode. Used by the customer "search by
-- postcode" feature.
create or replace view research.v_active_ads_by_postcode as
select
  am.postcode,
  am.suburb,
  am.state,
  oa.id as observed_ad_id,
  oa.external_ad_id,
  oa.platform,
  oa.active_status,
  oa.first_seen_at,
  oa.last_seen_at,
  oa.last_checked_at,
  ap.id as advertiser_page_id,
  ap.page_id,
  ap.page_name,
  ap.page_url,
  agent.id as agent_id,
  agent.full_name as agent_name,
  agency.id as agency_id,
  agency.name as agency_name,
  ac.id as ad_creative_id,
  ac.format,
  ac.headline,
  ac.body,
  ac.cta,
  ac.cta_url,
  ac.primary_image_url,
  ac.video_url,
  ac.landing_url,
  ac.classification,
  am.match_type as area_match_type,
  am.confidence as area_match_confidence
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
left join research.ad_creatives ac on ac.observed_ad_id = oa.id
join research.ad_area_matches am on am.observed_ad_id = oa.id
where oa.active_status = 'active';

-- ---------------------------------------------------------------------------
-- v_competitors_by_postcode
-- ---------------------------------------------------------------------------
-- For a given postcode, who is running ads right now (one row per agency /
-- agent / advertiser_page that has at least one active observed_ad).
create or replace view research.v_competitors_by_postcode as
select
  am.postcode,
  am.suburb,
  am.state,
  ap.id as advertiser_page_id,
  ap.page_name,
  ap.page_url,
  ap.platform,
  agent.id as agent_id,
  agent.full_name as agent_name,
  agency.id as agency_id,
  agency.name as agency_name,
  count(distinct oa.id) as active_ads,
  min(oa.first_seen_at) as oldest_active_ad_at,
  max(oa.last_seen_at) as newest_active_ad_at
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
join research.ad_area_matches am on am.observed_ad_id = oa.id
where oa.active_status = 'active'
group by am.postcode, am.suburb, am.state, ap.id, ap.page_name, ap.page_url, ap.platform,
         agent.id, agent.full_name, agency.id, agency.name;

-- ---------------------------------------------------------------------------
-- v_ad_hooks_by_suburb
-- ---------------------------------------------------------------------------
-- Flattens ad_creatives.classification.hooks (jsonb array) so the app can
-- aggregate "which hooks are working in which suburb right now."
create or replace view research.v_ad_hooks_by_suburb as
select
  am.postcode,
  am.suburb,
  am.state,
  hook.value::text as hook,
  count(distinct ac.id) as creatives_using_hook,
  count(distinct oa.id) as active_ads_using_hook,
  array_agg(distinct agency.name) filter (where agency.name is not null) as agencies
from research.ad_creatives ac
join research.observed_ads oa on oa.id = ac.observed_ad_id
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
join research.ad_area_matches am on am.observed_ad_id = oa.id
cross join lateral jsonb_array_elements_text(coalesce(ac.classification -> 'hooks', '[]'::jsonb)) as hook(value)
where oa.active_status = 'active'
group by am.postcode, am.suburb, am.state, hook.value::text;

-- ---------------------------------------------------------------------------
-- v_agent_ad_history
-- ---------------------------------------------------------------------------
-- Full ad history (including inactive) for an agent or agency. Powers the
-- "spy on a competitor" use case.
create or replace view research.v_agent_ad_history as
select
  agency.id as agency_id,
  agency.name as agency_name,
  agent.id as agent_id,
  agent.full_name as agent_name,
  ap.id as advertiser_page_id,
  ap.page_name,
  ap.platform,
  oa.id as observed_ad_id,
  oa.external_ad_id,
  oa.active_status,
  oa.first_seen_at,
  oa.last_seen_at,
  oa.last_checked_at,
  ac.headline,
  ac.body,
  ac.cta,
  ac.primary_image_url,
  ac.video_url,
  ac.format,
  ac.classification,
  (select count(*) from research.ad_snapshots s where s.observed_ad_id = oa.id) as snapshot_count
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
left join research.ad_creatives ac on ac.observed_ad_id = oa.id;

-- ---------------------------------------------------------------------------
-- v_coverage_status
-- ---------------------------------------------------------------------------
-- The operator's single pane of glass for "are we covering every postcode
-- well." Joins refresh_policies with the latest coverage_audit per postcode
-- plus live ad/agent counts.
create or replace view research.v_coverage_status as
with latest_audit as (
  select distinct on (postcode, state) *
  from research.coverage_audits
  order by postcode, state, audited_at desc
),
postcode_counts as (
  select
    am.postcode,
    am.state,
    count(distinct oa.id) filter (where oa.active_status = 'active') as active_ads,
    count(distinct ap.id) as advertiser_pages,
    count(distinct agent.id) as agents,
    count(distinct agency.id) as agencies
  from research.ad_area_matches am
  left join research.observed_ads oa on oa.id = am.observed_ad_id
  left join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
  left join research.agents agent on agent.id = ap.agent_id
  left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
  group by am.postcode, am.state
)
select
  rp.postcode,
  rp.state,
  rp.priority,
  rp.refresh_cadence_minutes,
  rp.last_refreshed_at,
  rp.next_refresh_at,
  rp.active as policy_active,
  la.status as last_audit_status,
  la.score as last_audit_score,
  la.audited_at as last_audited_at,
  la.agents_known,
  la.agents_estimated,
  la.ads_known,
  la.ads_sampled_external,
  coalesce(pc.active_ads, 0) as live_active_ads,
  coalesce(pc.advertiser_pages, 0) as live_advertiser_pages,
  coalesce(pc.agents, 0) as live_agents,
  coalesce(pc.agencies, 0) as live_agencies,
  case
    when la.audited_at is null then 'never_audited'
    when la.audited_at < now() - interval '14 days' then 'audit_overdue'
    when la.status = 'needs_work' then 'gap_known'
    when rp.next_refresh_at < now() - interval '6 hours' then 'refresh_overdue'
    else 'healthy'
  end as health
from research.refresh_policies rp
left join latest_audit la on la.postcode = rp.postcode and la.state = rp.state
left join postcode_counts pc on pc.postcode = rp.postcode and pc.state = rp.state;

-- ---------------------------------------------------------------------------
-- v_recent_creative_patterns
-- ---------------------------------------------------------------------------
-- Newest ad creatives we've ingested, with their classification, for the
-- "generate ideas from existing ads" surface.
create or replace view research.v_recent_creative_patterns as
select
  ac.id as ad_creative_id,
  ac.observed_ad_id,
  oa.active_status,
  ac.format,
  ac.headline,
  ac.body,
  ac.cta,
  ac.primary_image_url,
  ac.video_url,
  ac.classification,
  ac.classified_at,
  ap.page_name,
  agency.name as agency_name,
  agent.full_name as agent_name,
  oa.first_seen_at,
  oa.last_seen_at,
  array(
    select distinct am.postcode
    from research.ad_area_matches am
    where am.observed_ad_id = oa.id
  ) as postcodes
from research.ad_creatives ac
join research.observed_ads oa on oa.id = ac.observed_ad_id
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
order by ac.classified_at desc nulls last, oa.last_seen_at desc;

-- ---------------------------------------------------------------------------
-- v_missing_competitors
-- ---------------------------------------------------------------------------
-- Open coverage defects (agents/ads we know we missed) plus the postcode
-- they relate to. Powers the operator queue and the customer-visible
-- "gaps we are working on" surface.
create or replace view research.v_missing_competitors as
select
  cd.id,
  cd.postcode,
  cd.suburb,
  cd.state,
  cd.agent_name,
  cd.agency_name,
  cd.platform,
  cd.evidence_url,
  cd.notes,
  cd.reported_by,
  cd.status,
  cd.created_at,
  cd.updated_at,
  cd.resolved_at,
  cd.resolved_agent_id,
  cd.resolved_agency_id,
  cd.resolved_advertiser_page_id
from research.coverage_defects cd
where cd.status in ('open', 'investigating');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Authenticated and service_role can read all views. Anon can read the
-- aggregate / market-level views (active_ads_by_postcode, competitors_by_postcode,
-- ad_hooks_by_suburb, recent_creative_patterns, coverage_status, missing_competitors)
-- so the customer-facing /research page can render without auth issues for
-- the demo/marketing surface. v_agent_ad_history is auth-only because it is
-- the deepest "spy" surface.
grant select on research.v_active_ads_by_postcode      to authenticated, anon, service_role;
grant select on research.v_competitors_by_postcode     to authenticated, anon, service_role;
grant select on research.v_ad_hooks_by_suburb          to authenticated, anon, service_role;
grant select on research.v_agent_ad_history            to authenticated, service_role;
grant select on research.v_coverage_status             to authenticated, service_role;
grant select on research.v_recent_creative_patterns    to authenticated, anon, service_role;
grant select on research.v_missing_competitors         to authenticated, anon, service_role;
