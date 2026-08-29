-- Empty Meta country arrays mean the provider did not expose a country signal.
-- Keep those rows eligible when the ad has explicit Australian area matches;
-- still exclude rows that explicitly list reached countries without AU.

create or replace view research.v_customer_agent_ad_history as
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
  ac.primary_intent,
  ac.display_state
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
join research.ad_creatives ac on ac.observed_ad_id = oa.id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
where ap.status in ('resolved_collectable', 'no_ads_confirmed')
  and research.valid_external_ad_id(oa.external_ad_id)
  and research.page_is_verified_real_estate(ap.id)
  and research.creative_is_real_estate(ac.classification, ac.ad_type, ac.primary_intent)
  and ac.display_state = 'displayable'
  and exists (
    select 1
    from research.ad_area_matches am
    where am.observed_ad_id = oa.id
      and am.state is not null
      and length(btrim(am.postcode)) = 4
  )
  and case
    when jsonb_typeof(oa.raw_payload -> 'targeted_or_reached_countries') = 'array' then
      jsonb_array_length(oa.raw_payload -> 'targeted_or_reached_countries') = 0
      or exists (
        select 1
        from jsonb_array_elements_text(oa.raw_payload -> 'targeted_or_reached_countries') country(value)
        where upper(country.value) = 'AU'
      )
    else true
  end
  and case
    when jsonb_typeof(oa.raw_payload -> 'ad_reached_countries') = 'array' then
      jsonb_array_length(oa.raw_payload -> 'ad_reached_countries') = 0
      or exists (
        select 1
        from jsonb_array_elements_text(oa.raw_payload -> 'ad_reached_countries') country(value)
        where upper(country.value) = 'AU'
      )
    else true
  end;

grant select on research.v_customer_agent_ad_history to authenticated, service_role;
revoke all on research.v_customer_agent_ad_history from anon;

notify pgrst, 'reload schema';
