-- Clarify the customer-safe Ad Radar location read model.
--
-- Legacy columns remain for compatibility:
--   postcode/suburb/state = the current ad_area_matches row.
--   postcodes = historical display field, usually advertiser service area.
--
-- New columns make the two location concepts explicit:
--   area_match_* / ad_area_*       = evidence that this ad itself matched an area.
--   service_area_*                = advertiser/agent coverage, not exact ad evidence.

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
  am.postcode,
  am.suburb,
  am.state,
  coalesce(service_areas.postcodes, array[am.postcode]) as postcodes,
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
  am.postcode as area_match_postcode,
  am.suburb as area_match_suburb,
  am.state as area_match_state,
  am.match_type as area_match_type,
  am.confidence as area_match_confidence,
  coalesce(ad_areas.postcodes, array[am.postcode]) as ad_area_postcodes,
  coalesce(ad_areas.suburbs, array[am.suburb]) as ad_area_suburbs,
  coalesce(service_areas.postcodes, '{}'::text[]) as service_area_postcodes,
  coalesce(service_areas.suburbs, '{}'::text[]) as service_area_suburbs
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
join research.ad_creatives ac on ac.observed_ad_id = oa.id
join research.ad_area_matches am on am.observed_ad_id = oa.id
left join lateral (
  select
    array_agg(distinct aam.postcode order by aam.postcode) filter (where aam.postcode is not null) as postcodes,
    array_agg(distinct aam.suburb order by aam.suburb) filter (where aam.suburb is not null) as suburbs
  from research.ad_area_matches aam
  where aam.observed_ad_id = oa.id
) ad_areas on true
left join lateral (
  select
    array_agg(distinct asa.postcode order by asa.postcode) filter (where asa.postcode is not null) as postcodes,
    array_agg(distinct asa.suburb order by asa.suburb) filter (where asa.suburb is not null) as suburbs
  from research.agent_service_areas asa
  where asa.postcode is not null
    and (
      asa.agent_id = ap.agent_id
      or asa.agency_id = ap.agency_id
    )
) service_areas on true
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

comment on column research.v_customer_meta_ad_library_cards.postcodes is
  'Legacy display field. Prefer ad_area_postcodes for ad-location evidence and service_area_postcodes for advertiser coverage.';
comment on column research.v_customer_meta_ad_library_cards.ad_area_postcodes is
  'All postcodes from research.ad_area_matches for this observed ad.';
comment on column research.v_customer_meta_ad_library_cards.service_area_postcodes is
  'Advertiser/agent service-area postcodes. These are coverage hints, not exact ad-location evidence.';

grant select on research.v_customer_meta_ad_library_cards to authenticated, anon, service_role;

notify pgrst, 'reload schema';

commit;
