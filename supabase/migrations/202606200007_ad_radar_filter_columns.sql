-- Expose creative classification fields (ad type, media format, hooks) on the
-- Ad Radar customer card view so the search UI can filter on them.
--
-- The view already joins research.ad_creatives (ac); these columns surface data
-- that was previously hidden. All existing columns and the attribution model
-- from 202606200004_research_ad_attribution_links are preserved verbatim.
--
-- Coverage in the displayable real-estate corpus: ad_type 100%, format 100%,
-- hooks ~99%. hooks is free-text from the classifier, exposed both as the raw
-- jsonb array (hooks) and a flattened, ilike-searchable string (hooks_text).

begin;

create or replace view research.v_customer_meta_ad_library_cards as
select
  oa.id as card_id,
  oa.external_ad_id as library_id,
  ap.page_id,
  ap.page_name,
  ap.page_url,
  coalesce(ap.metadata ->> 'page_image_url', ap.metadata ->> 'profile_image_url') as page_image_url,
  oa.active_status,
  oa.ad_delivery_started_at,
  oa.ad_delivery_stopped_at,
  oa.meta_publisher_platforms as publisher_platforms,
  area_link.postcode,
  area_link.suburb,
  area_link.state,
  coalesce(service_areas.postcodes, array[area_link.postcode]) as postcodes,
  ac.headline,
  ac.body,
  coalesce(ac.metadata ->> 'description', ac.classification ->> 'description') as description,
  ac.cta,
  ac.cta_url,
  coalesce(ac.landing_url, ac.cta_url) as destination_url,
  null::text as primary_image_url,
  '{}'::text[] as image_urls,
  coalesce(ac.image_storage_path, media.image_storage_path) as image_storage_path,
  null::text as video_url,
  coalesce(ac.video_storage_path, media.video_storage_path) as video_storage_path,
  coalesce(ac.video_thumbnail_url, media.video_thumbnail_storage_path) as video_thumbnail_url,
  case
    when jsonb_typeof(ac.media_assets) = 'array' and jsonb_array_length(ac.media_assets) > 0 then ac.media_assets
    else coalesce(media.assets, '[]'::jsonb)
  end as media_assets,
  oa.last_seen_at,
  area_link.postcode as area_match_postcode,
  area_link.suburb as area_match_suburb,
  area_link.state as area_match_state,
  area_link.evidence_type as area_match_type,
  area_link.confidence as area_match_confidence,
  coalesce(ad_areas.postcodes, array[area_link.postcode]) as ad_area_postcodes,
  coalesce(ad_areas.suburbs, array[area_link.suburb]) as ad_area_suburbs,
  coalesce(service_areas.postcodes, '{}'::text[]) as service_area_postcodes,
  coalesce(service_areas.suburbs, '{}'::text[]) as service_area_suburbs,
  agent_link.agent_id,
  agent.full_name as agent_name,
  agency_link.agency_id,
  agency.name as agency_name,
  coalesce(attribution.links, '[]'::jsonb) as attribution_links,
  ac.ad_type,
  ac.format,
  ac.classification -> 'hooks' as hooks,
  case
    when jsonb_typeof(ac.classification -> 'hooks') = 'array'
      then array_to_string(array(select jsonb_array_elements_text(ac.classification -> 'hooks')), ' | ')
    else null::text
  end as hooks_text
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
join research.ad_creatives ac on ac.observed_ad_id = oa.id
join research.ad_attribution_links area_link
  on area_link.observed_ad_id = oa.id
  and area_link.link_type = 'postcode'
left join lateral (
  select aal.agent_id
  from research.ad_attribution_links aal
  where aal.observed_ad_id = oa.id
    and aal.link_type = 'agent'
  order by aal.confidence desc, aal.last_seen_at desc, aal.created_at desc
  limit 1
) agent_link on true
left join research.agents agent on agent.id = agent_link.agent_id
left join lateral (
  select aal.agency_id
  from research.ad_attribution_links aal
  where aal.observed_ad_id = oa.id
    and aal.link_type = 'agency'
  order by aal.confidence desc, aal.last_seen_at desc, aal.created_at desc
  limit 1
) agency_link on true
left join research.agencies agency on agency.id = agency_link.agency_id
left join lateral (
  select
    array_agg(distinct aal.postcode order by aal.postcode) filter (where aal.postcode is not null) as postcodes,
    array_agg(distinct aal.suburb order by aal.suburb) filter (where aal.suburb is not null) as suburbs
  from research.ad_attribution_links aal
  where aal.observed_ad_id = oa.id
    and aal.link_type = 'postcode'
) ad_areas on true
left join lateral (
  select
    array_agg(distinct asa.postcode order by asa.postcode) filter (where asa.postcode is not null) as postcodes,
    array_agg(distinct asa.suburb order by asa.suburb) filter (where asa.suburb is not null) as suburbs
  from research.agent_service_areas asa
  where asa.postcode is not null
    and (
      asa.agent_id = agent_link.agent_id
      or asa.agency_id = agency_link.agency_id
    )
) service_areas on true
left join lateral (
  select jsonb_agg(
    jsonb_strip_nulls(
      jsonb_build_object(
        'linkType', aal.link_type,
        'agentId', aal.agent_id,
        'agencyId', aal.agency_id,
        'postcode', aal.postcode,
        'suburb', aal.suburb,
        'state', aal.state,
        'evidenceType', aal.evidence_type,
        'confidence', aal.confidence,
        'source', aal.source,
        'firstSeenAt', aal.first_seen_at,
        'lastSeenAt', aal.last_seen_at
      )
    )
    order by aal.link_type, aal.confidence desc, aal.last_seen_at desc
  ) as links
  from research.ad_attribution_links aal
  where aal.observed_ad_id = oa.id
) attribution on true
left join lateral (
  select
    max(ma.storage_path) filter (where ma.kind = 'image' and ma.storage_path is not null) as image_storage_path,
    max(ma.storage_path) filter (where ma.kind = 'video' and ma.storage_path is not null) as video_storage_path,
    max(ma.storage_path) filter (where ma.kind = 'thumbnail' and ma.storage_path is not null) as video_thumbnail_storage_path,
    jsonb_agg(
      jsonb_build_object(
        'kind', ma.kind,
        'storagePath', ma.storage_path,
        'contentType', coalesce(ma.content_type, ma.mime_type),
        'byteSize', ma.byte_size,
        'capturedAt', coalesce(ma.captured_at, ma.created_at)
      )
      order by ma.created_at
    ) filter (where ma.id is not null) as assets
  from research.media_assets ma
  where ma.ad_creative_id = ac.id
    and ma.capture_status = 'captured'
) media on true
where ap.status in ('resolved_collectable', 'no_ads_confirmed')
  and research.valid_external_ad_id(oa.external_ad_id)
  and research.page_is_verified_real_estate(ap.id)
  and research.creative_is_real_estate(ac.classification, ac.ad_type, ac.primary_intent)
  and ac.display_state = 'displayable';

comment on column research.v_customer_meta_ad_library_cards.ad_type is
  'Creative classification: listing, just_sold, appraisal, open_home, property_management, market_update, agency_brand.';
comment on column research.v_customer_meta_ad_library_cards.format is
  'Media format: image, video, carousel.';
comment on column research.v_customer_meta_ad_library_cards.hooks_text is
  'Flattened, pipe-joined hook phrases for ilike contains filtering. Free-text from the classifier.';

grant select on research.v_customer_meta_ad_library_cards to authenticated, anon, service_role;

notify pgrst, 'reload schema';

commit;
