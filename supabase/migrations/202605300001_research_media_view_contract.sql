-- Research media contract
--
-- Adds durable media/classification fields to ad_creatives for environments
-- that were migrated before media capture existed, then exposes those fields
-- through the curated research.v_* views used by the app.

alter table research.ad_creatives
  add column if not exists image_storage_path text,
  add column if not exists video_storage_path text,
  add column if not exists media_assets jsonb not null default '[]'::jsonb,
  add column if not exists ad_type text,
  add column if not exists primary_intent text;

update research.ad_creatives
set media_assets = '[]'::jsonb
where media_assets is null;

alter table research.ad_creatives
  alter column media_assets set default '[]'::jsonb,
  alter column media_assets set not null;

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
  am.confidence as area_match_confidence,
  oa.ad_delivery_started_at,
  oa.ad_delivery_stopped_at,
  oa.ad_creation_date,
  ac.image_urls,
  ac.image_storage_path,
  ac.video_storage_path,
  ac.video_thumbnail_url,
  ac.media_assets,
  ac.ad_type,
  ac.primary_intent
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
left join research.ad_creatives ac on ac.observed_ad_id = oa.id
join research.ad_area_matches am on am.observed_ad_id = oa.id
where oa.active_status = 'active';

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
  (select count(*) from research.ad_snapshots s where s.observed_ad_id = oa.id) as snapshot_count,
  oa.ad_delivery_started_at,
  oa.ad_delivery_stopped_at,
  oa.ad_creation_date,
  ac.image_urls,
  ac.image_storage_path,
  ac.video_storage_path,
  ac.video_thumbnail_url,
  ac.media_assets,
  ac.ad_type,
  ac.primary_intent
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
left join research.ad_creatives ac on ac.observed_ad_id = oa.id;

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
  ) as postcodes,
  oa.ad_delivery_started_at,
  oa.ad_delivery_stopped_at,
  oa.ad_creation_date,
  ac.image_urls,
  ac.image_storage_path,
  ac.video_storage_path,
  ac.video_thumbnail_url,
  ac.media_assets,
  ac.ad_type,
  ac.primary_intent
from research.ad_creatives ac
join research.observed_ads oa on oa.id = ac.observed_ad_id
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
order by ac.classified_at desc nulls last, oa.last_seen_at desc;

grant select on research.v_active_ads_by_postcode   to authenticated, anon, service_role;
grant select on research.v_agent_ad_history         to authenticated, service_role;
grant select on research.v_recent_creative_patterns to authenticated, anon, service_role;
