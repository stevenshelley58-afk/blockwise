-- The public radar should show safe scraped ad history for verified real-estate
-- pages. A later no-ads refresh must not hide already-saved ads for that page.

alter table research.media_assets
  add column if not exists content_type text,
  add column if not exists mime_type text,
  add column if not exists captured_at timestamptz;

update research.media_assets
set
  content_type = coalesce(content_type, mime_type),
  mime_type = coalesce(mime_type, content_type)
where content_type is null
   or mime_type is null;

create or replace function research.valid_external_ad_id(p_external_ad_id text)
returns boolean
language sql
immutable
as $$
  select p_external_ad_id is not null
    and length(btrim(p_external_ad_id)) > 0
    and lower(btrim(p_external_ad_id)) not in ('0', 'unknown', 'null', 'none', 'n/a', 'na', 'undefined');
$$;

create or replace function research.creative_is_real_estate(
  p_classification jsonb,
  p_ad_type text,
  p_primary_intent text
)
returns boolean
language sql
immutable
as $$
  select
    lower(coalesce(p_classification ->> 'industry', p_classification ->> 'vertical', '')) in ('real_estate', 'real estate', 'property')
    or lower(coalesce(p_primary_intent, p_classification ->> 'primary_intent', p_classification ->> 'intent', '')) in (
      'appraisal',
      'listing',
      'just_sold',
      'open_home',
      'market_update',
      'property_management',
      'lead_magnet',
      'agent_branding',
      'agency_brand',
      'real_estate'
    )
    or lower(coalesce(p_ad_type, p_classification ->> 'type', p_classification ->> 'ad_type', '')) in (
      'appraisal',
      'listing',
      'just_sold',
      'open_home',
      'market_update',
      'property_management',
      'lead_magnet',
      'brand',
      'agent_branding',
      'agency_brand',
      'real_estate'
    );
$$;

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
  coalesce(postcodes.postcodes, array[am.postcode]) as postcodes,
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
  oa.last_seen_at
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
join research.ad_creatives ac on ac.observed_ad_id = oa.id
join research.ad_area_matches am on am.observed_ad_id = oa.id
left join lateral (
  select array_agg(distinct asa.postcode order by asa.postcode) as postcodes
  from research.agent_service_areas asa
  where asa.postcode is not null
    and (
      asa.agent_id = ap.agent_id
      or asa.agency_id = ap.agency_id
    )
) postcodes on true
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

grant select on research.v_customer_meta_ad_library_cards to authenticated, anon, service_role;
grant execute on function research.valid_external_ad_id(text) to authenticated, anon, service_role;
grant execute on function research.creative_is_real_estate(jsonb, text, text) to authenticated, anon, service_role;

notify pgrst, 'reload schema';
