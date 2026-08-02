-- Add OCR-extracted text columns to research.ad_creatives.
-- Enables text search and classification enrichment for text baked into
-- ad creative images (headlines, CTAs, property details rendered as graphics).

alter table research.ad_creatives
  add column if not exists ocr_text text,
  add column if not exists ocr_status text
    check (ocr_status in ('pending', 'done', 'empty', 'failed', 'skipped'));

comment on column research.ad_creatives.ocr_text is
  'Text extracted from ad creative images via OCR (tesseract). Null when not yet attempted.';
comment on column research.ad_creatives.ocr_status is
  'OCR processing state: pending=queued, done=text extracted, empty=no text found, failed=error, skipped=no image available.';

-- Index for the OCR backfill worker to find unprocessed creatives efficiently.
create index if not exists ad_creatives_ocr_pending_idx
  on research.ad_creatives (created_at asc)
  where ocr_status is null or ocr_status = 'pending';

-- Trigram index on ocr_text for fuzzy text search alongside headline/body.
create index if not exists ad_creatives_ocr_text_trgm_idx
  on research.ad_creatives using gin (ocr_text gin_trgm_ops)
  where ocr_text is not null and ocr_text <> '';

-- Update the customer-facing view to expose OCR text for search.
-- The view is recreated in full below to include the new column.
drop view if exists research.v_customer_meta_ad_library_cards cascade;

create or replace view research.v_customer_meta_ad_library_cards as
select
  oa.id as observed_ad_id,
  oa.external_ad_id,
  oa.advertiser_page_id,
  ap.page_name,
  ap.page_id as meta_page_id,
  ap.suburb,
  ap.state,
  ap.postcode,
  ap.service_area_postcodes,
  ac.id as ad_creative_id,
  ac.format,
  ac.headline,
  ac.body,
  ac.ocr_text,
  ac.cta,
  ac.cta_url,
  ac.landing_url,
  ac.primary_image_url,
  ac.image_urls,
  ac.image_storage_path,
  ac.video_url,
  ac.video_storage_path,
  ac.video_thumbnail_url,
  ac.classification,
  ac.classification_status,
  ac.ad_type,
  ac.primary_intent,
  ac.display_state,
  ac.creative_hash,
  ac.created_at as creative_created_at,
  oa.active_status,
  oa.ad_delivery_started_at,
  oa.ad_delivery_stopped_at,
  oa.first_seen_provider,
  oa.last_seen_at,
  oa.meta_publisher_platforms,
  oa.metadata as observed_metadata,
  -- Postcode match: prefer explicit area match, fall back to advertiser page postcode.
  coalesce(
    (select array_agg(distinct p) from unnest(am.postcodes) p),
    case when ap.postcode is not null then array[ap.postcode] else null end
  ) as postcodes,
  case when ap.postcode is not null then array[ap.postcode] else null end as ad_area_postcodes,
  ap.service_area_postcodes as service_area_postcodes,
  -- Attribution links for source transparency.
  jsonb_build_array(
    jsonb_build_object(
      'type', 'meta_ad_library',
      'url', format('https://www.facebook.com/ads/library/?id=%s', oa.external_ad_id),
      'label', 'Meta Ad Library'
    )
  ) as attribution_links,
  -- Hooks text from classification for filter chips.
  nullif(
    array_to_string(
      coalesce(
        (select array_agg(h) from jsonb_array_elements_text(ac.classification->'hooks') h),
        '{}'::text[]
      ),
      ', '
    ),
    ''
  ) as hooks_text
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.ad_creatives ac on ac.observed_ad_id = oa.id
left join lateral (
  select array_agg(distinct aam.postcode) filter (where aam.postcode is not null) as postcodes
  from research.ad_area_matches aam
  where aam.observed_ad_id = oa.id
) am on true
where ac.display_state = 'displayable'
  and oa.active_status = 'active';

comment on view research.v_customer_meta_ad_library_cards is
  'Customer-facing read model for Ad Radar cards. Includes OCR text for search.';

grant select on research.v_customer_meta_ad_library_cards to authenticated, anon, service_role;
