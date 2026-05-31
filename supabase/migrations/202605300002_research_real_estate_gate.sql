-- Real-estate gate for the research ad database.
--
-- Context: an apify location-based discovery run ingested every advertiser
-- running ads in target postcodes (plumbers, electricians, cleaners, marketing
-- agencies, etc.) under placeholder "Discovered <state>" agencies. Those junk
-- advertisers were hard-deleted. This migration adds a durable gate so only
-- advertisers we have confirmed as real-estate agents/agencies can ever surface
-- in the app, even if a future source ingests junk again.
--
-- Rule (matches the operator's keep-bar): an advertiser surfaces only if its
-- resolved agency is flagged is_real_estate. The agent-census skill flips this
-- flag to true once it confirms a licence OR an agency listing OR another
-- real-estate proof. Discovery placeholders default to false and stay hidden.

alter table research.agencies
  add column if not exists is_real_estate boolean not null default false;

comment on column research.agencies.is_real_estate is
  'True only after the census confirms this is a genuine real-estate agency (licence, agency listing, or other proof). Views only surface advertisers whose resolved agency is_real_estate. Defaults false so unverified/discovered advertisers stay out of the app.';

-- Flag the agencies that survived the cleanup. They were manually verified as
-- real-estate brands (Ray White, Harcourts, LJ Hooker, Belle Property, etc.)
-- and contain no "Discovered <state>" placeholders.
update research.agencies
set is_real_estate = true
where name not ilike 'Discovered %';

-- Helper so application/census code can gate consistently without repeating the
-- coalesce(agent.agency_id, page.agency_id) logic.
create or replace function research.page_is_real_estate(p_agent_id uuid, p_page_agency_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = research, public
as $$
  select exists (
    select 1
    from research.agencies g
    join research.agents a on a.id = p_agent_id
    where g.id = a.agency_id and g.is_real_estate
  ) or exists (
    select 1 from research.agencies g
    where g.id = p_page_agency_id and g.is_real_estate
  );
$$;

-- ----------------------------------------------------------------------------
-- Rebuild the ad-surfacing views with the real-estate gate.
-- ----------------------------------------------------------------------------

create or replace view research.v_active_ads_by_postcode as
select
  am.postcode, am.suburb, am.state,
  oa.id as observed_ad_id, oa.external_ad_id, oa.platform, oa.active_status,
  oa.first_seen_at, oa.last_seen_at, oa.last_checked_at,
  ap.id as advertiser_page_id, ap.page_id, ap.page_name, ap.page_url,
  agent.id as agent_id, agent.full_name as agent_name,
  agency.id as agency_id, agency.name as agency_name,
  ac.id as ad_creative_id, ac.format, ac.headline, ac.body, ac.cta, ac.cta_url,
  ac.primary_image_url, ac.video_url, ac.landing_url, ac.classification,
  am.match_type as area_match_type, am.confidence as area_match_confidence,
  oa.ad_delivery_started_at, oa.ad_delivery_stopped_at, oa.ad_creation_date,
  ac.image_urls, ac.image_storage_path, ac.video_storage_path,
  ac.video_thumbnail_url, ac.media_assets, ac.ad_type, ac.primary_intent
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
left join research.ad_creatives ac on ac.observed_ad_id = oa.id
join research.ad_area_matches am on am.observed_ad_id = oa.id
where oa.active_status = 'active'
  and research.page_is_real_estate(ap.agent_id, ap.agency_id);

create or replace view research.v_agent_ad_history as
select
  agency.id as agency_id, agency.name as agency_name,
  agent.id as agent_id, agent.full_name as agent_name,
  ap.id as advertiser_page_id, ap.page_name, ap.platform,
  oa.id as observed_ad_id, oa.external_ad_id, oa.active_status,
  oa.first_seen_at, oa.last_seen_at, oa.last_checked_at,
  ac.headline, ac.body, ac.cta, ac.primary_image_url, ac.video_url,
  ac.format, ac.classification,
  (select count(*) from research.ad_snapshots s where s.observed_ad_id = oa.id) as snapshot_count,
  oa.ad_delivery_started_at, oa.ad_delivery_stopped_at, oa.ad_creation_date,
  ac.image_urls, ac.image_storage_path, ac.video_storage_path,
  ac.video_thumbnail_url, ac.media_assets, ac.ad_type, ac.primary_intent
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
left join research.ad_creatives ac on ac.observed_ad_id = oa.id
where research.page_is_real_estate(ap.agent_id, ap.agency_id);

create or replace view research.v_recent_creative_patterns as
select
  ac.id as ad_creative_id, ac.observed_ad_id, oa.active_status,
  ac.format, ac.headline, ac.body, ac.cta, ac.primary_image_url, ac.video_url,
  ac.classification, ac.classified_at,
  ap.page_name, agency.name as agency_name, agent.full_name as agent_name,
  oa.first_seen_at, oa.last_seen_at,
  array(
    select distinct am.postcode
    from research.ad_area_matches am
    where am.observed_ad_id = oa.id
  ) as postcodes,
  oa.ad_delivery_started_at, oa.ad_delivery_stopped_at, oa.ad_creation_date,
  ac.image_urls, ac.image_storage_path, ac.video_storage_path,
  ac.video_thumbnail_url, ac.media_assets, ac.ad_type, ac.primary_intent
from research.ad_creatives ac
join research.observed_ads oa on oa.id = ac.observed_ad_id
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
where research.page_is_real_estate(ap.agent_id, ap.agency_id)
order by ac.classified_at desc nulls last, oa.last_seen_at desc;

create or replace view research.v_competitors_by_postcode as
select
  am.postcode, am.suburb, am.state,
  ap.id as advertiser_page_id, ap.page_name, ap.page_url, ap.platform,
  agent.id as agent_id, agent.full_name as agent_name,
  agency.id as agency_id, agency.name as agency_name,
  count(distinct oa.id) as active_ads,
  min(oa.first_seen_at) as oldest_active_ad_at,
  max(oa.last_seen_at) as newest_active_ad_at
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
join research.ad_area_matches am on am.observed_ad_id = oa.id
where oa.active_status = 'active'
  and research.page_is_real_estate(ap.agent_id, ap.agency_id)
group by am.postcode, am.suburb, am.state, ap.id, ap.page_name, ap.page_url, ap.platform,
         agent.id, agent.full_name, agency.id, agency.name;

create or replace view research.v_ad_hooks_by_suburb as
select
  am.postcode, am.suburb, am.state,
  hook.value as hook,
  count(distinct ac.id) as creatives_using_hook,
  count(distinct oa.id) as active_ads_using_hook,
  array_agg(distinct agency.name) filter (where agency.name is not null) as agencies
from research.ad_creatives ac
join research.observed_ads oa on oa.id = ac.observed_ad_id
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
join research.ad_area_matches am on am.observed_ad_id = oa.id
cross join lateral jsonb_array_elements_text(coalesce(ac.classification -> 'hooks', '[]'::jsonb)) hook(value)
where oa.active_status = 'active'
  and research.page_is_real_estate(ap.agent_id, ap.agency_id)
group by am.postcode, am.suburb, am.state, hook.value;

grant select on research.v_active_ads_by_postcode   to authenticated, anon, service_role;
grant select on research.v_agent_ad_history         to authenticated, service_role;
grant select on research.v_recent_creative_patterns to authenticated, anon, service_role;
grant select on research.v_competitors_by_postcode  to authenticated, anon, service_role;
grant select on research.v_ad_hooks_by_suburb        to authenticated, anon, service_role;
