-- Creative/media canonicalization + unified search documents (Ad Radar v2)
--
-- 1. ad_creative_versions: unique (ad_creative_id, creative_hash)
-- 2. media_assets: creative_version_id link; storage-path and JSONB media
--    arrays become provenance only — media_assets stays the canonical store
--    (object key, SHA-256, MIME, dimensions, duration, byte size)
-- 3. ad_creatives: ocr_text / transcript columns (OCR backfill contract)
-- 4. research.ad_search_documents: one searchable document per observed ad,
--    joined across page / ad / creative, refreshed by triggers. Blockwise
--    reads this through an authenticated API; no manual approval for valid
--    imported ads.

-- ---------------------------------------------------------------------------
-- 1. ad_creative_versions uniqueness on (ad_creative_id, creative_hash)
-- ---------------------------------------------------------------------------
-- Collapse duplicate (ad_creative_id, creative_hash) rows: union their
-- media_asset_ids into the newest row, then delete the rest.
with ranked as (
  select id, ad_creative_id, creative_hash,
         row_number() over (
           partition by ad_creative_id, creative_hash
           order by created_at desc, id desc
         ) as rn
  from research.ad_creative_versions
)
update research.ad_creative_versions v
set media_asset_ids = coalesce((
  select array_agg(distinct m)
  from research.ad_creative_versions d,
       unnest(d.media_asset_ids) m
  where d.ad_creative_id = v.ad_creative_id
    and d.creative_hash = v.creative_hash
), '{}'::uuid[])
where v.id in (select id from ranked where rn = 1)
  and v.ad_creative_id in (select ad_creative_id from ranked where rn > 1);

delete from research.ad_creative_versions v
using (
  select id from (
    select id, row_number() over (
      partition by ad_creative_id, creative_hash
      order by created_at desc, id desc
    ) as rn
    from research.ad_creative_versions
  ) ranked
  where ranked.rn > 1
) doomed
where v.id = doomed.id;

create unique index if not exists ad_creative_versions_creative_hash_unique_idx
  on research.ad_creative_versions (ad_creative_id, creative_hash);

-- ---------------------------------------------------------------------------
-- 2. media_assets: link to the creative version; canonical fields only
-- ---------------------------------------------------------------------------
alter table research.media_assets
  add column if not exists creative_version_id uuid references research.ad_creative_versions (id) on delete set null,
  add column if not exists duration_ms int,
  add column if not exists object_key text;

comment on table research.media_assets is
  'Canonical media store. Canonical fields: object_key, content_hash (SHA-256), mime_type/content_type, width, height, duration_ms, byte_size. source_url and storage_path are provenance; JSONB media arrays on creatives are not a parallel store.';

-- Backfill creative_version_id from the uuid[] links on versions, then from
-- observed_ad fallback where the ad has exactly one version.
update research.media_assets ma
set creative_version_id = link.version_id
from (
  select m as asset_id, v.id as version_id
  from research.ad_creative_versions v,
       unnest(v.media_asset_ids) m
) link
where ma.id = link.asset_id
  and ma.creative_version_id is null;

update research.media_assets ma
set creative_version_id = single.version_id
from (
  select v.id as version_id, v.observed_ad_id
  from research.ad_creative_versions v
  where (select count(*) from research.ad_creative_versions v2
         where v2.observed_ad_id = v.observed_ad_id) = 1
) single
where ma.observed_ad_id = single.observed_ad_id
  and ma.creative_version_id is null;

create index if not exists media_assets_version_idx
  on research.media_assets (creative_version_id)
  where creative_version_id is not null;
create index if not exists media_assets_capture_status_idx
  on research.media_assets (capture_status);

-- ---------------------------------------------------------------------------
-- 3. ad_creatives: OCR / transcript columns
-- ---------------------------------------------------------------------------
alter table research.ad_creatives
  add column if not exists ocr_status text
    check (ocr_status in ('pending', 'success', 'failed', 'skipped')),
  add column if not exists ocr_text text,
  add column if not exists transcript text;

-- ---------------------------------------------------------------------------
-- 4. research.ad_search_documents
-- ---------------------------------------------------------------------------
create table if not exists research.ad_search_documents (
  id uuid primary key default gen_random_uuid(),
  observed_ad_id uuid not null references research.observed_ads (id) on delete cascade,
  advertiser_page_id uuid not null references research.advertiser_pages (id) on delete cascade,
  ad_creative_id uuid references research.ad_creatives (id) on delete set null,
  meta_page_id text,
  page_name text,
  page_type text,
  external_ad_id text not null,
  ad_status text not null,
  copy text,
  headline text,
  cta text,
  ocr_text text,
  transcript text,
  media_type text,
  source_created_at timestamptz,
  source_delivery_started_at timestamptz,
  source_delivery_stopped_at timestamptz,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  location jsonb not null default '{}'::jsonb,
  classification jsonb not null default '{}'::jsonb,
  search_vector tsvector,
  index_version int not null default 1,
  indexed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_search_documents_ad_unique unique (observed_ad_id)
);

create index if not exists ad_search_documents_page_idx
  on research.ad_search_documents (advertiser_page_id);
create index if not exists ad_search_documents_status_idx
  on research.ad_search_documents (ad_status);
create index if not exists ad_search_documents_media_type_idx
  on research.ad_search_documents (media_type);
create index if not exists ad_search_documents_search_vector_idx
  on research.ad_search_documents using gin (search_vector);
create index if not exists ad_search_documents_source_dates_idx
  on research.ad_search_documents (source_delivery_started_at, source_delivery_stopped_at);
create index if not exists ad_search_documents_classification_gin_idx
  on research.ad_search_documents using gin (classification);

comment on table research.ad_search_documents is
  'Denormalized, always-rebuilt search index over observed ads. Blockwise '
  'reads this through an authenticated API; canonical truth remains the '
  'research.* tables. Valid imported ads become searchable automatically — '
  'no manual approval. Exceptions (e.g. creatives still pending review) go '
  'to the operator attention queue, not to this table.';

create or replace function research.refresh_ad_search_document(
  p_observed_ad_id uuid
)
returns void
language plpgsql
security definer
set search_path = research, pg_temp
as $$
begin
  insert into research.ad_search_documents as doc (
    observed_ad_id,
    advertiser_page_id,
    ad_creative_id,
    meta_page_id,
    page_name,
    page_type,
    external_ad_id,
    ad_status,
    copy,
    headline,
    cta,
    ocr_text,
    transcript,
    media_type,
    source_created_at,
    source_delivery_started_at,
    source_delivery_stopped_at,
    first_seen_at,
    last_seen_at,
    location,
    classification,
    search_vector,
    index_version,
    indexed_at,
    updated_at
  )
  select
    oa.id,
    oa.advertiser_page_id,
    ac.id,
    ap.page_id,
    ap.page_name,
    ap.owner_type,
    oa.external_ad_id,
    oa.active_status,
    ac.body,
    ac.headline,
    ac.cta,
    ac.ocr_text,
    ac.transcript,
    ac.format,
    oa.source_created_at,
    oa.source_delivery_started_at,
    oa.source_delivery_stopped_at,
    oa.first_seen_at,
    oa.last_seen_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'postcode', am.postcode, 'suburb', am.suburb, 'state', am.state, 'match_type', am.match_type
      ))
      from research.ad_area_matches am
      where am.observed_ad_id = oa.id
    ), '[]'::jsonb),
    coalesce(ac.classification, '{}'::jsonb),
    to_tsvector('english', concat_ws(' ',
      ap.page_name,
      oa.external_ad_id,
      ac.headline,
      ac.body,
      ac.cta,
      ac.ocr_text,
      ac.transcript
    )),
    1,
    now(),
    now()
  from research.observed_ads oa
  join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
  left join research.ad_creatives ac on ac.observed_ad_id = oa.id
  where oa.id = p_observed_ad_id
  on conflict (observed_ad_id) do update
    set advertiser_page_id = excluded.advertiser_page_id,
        ad_creative_id = excluded.ad_creative_id,
        meta_page_id = excluded.meta_page_id,
        page_name = excluded.page_name,
        page_type = excluded.page_type,
        external_ad_id = excluded.external_ad_id,
        ad_status = excluded.ad_status,
        copy = excluded.copy,
        headline = excluded.headline,
        cta = excluded.cta,
        ocr_text = excluded.ocr_text,
        transcript = excluded.transcript,
        media_type = excluded.media_type,
        source_created_at = excluded.source_created_at,
        source_delivery_started_at = excluded.source_delivery_started_at,
        source_delivery_stopped_at = excluded.source_delivery_stopped_at,
        first_seen_at = excluded.first_seen_at,
        last_seen_at = excluded.last_seen_at,
        location = excluded.location,
        classification = excluded.classification,
        search_vector = excluded.search_vector,
        index_version = excluded.index_version,
        indexed_at = excluded.indexed_at,
        updated_at = now();
end;
$$;

grant execute on function research.refresh_ad_search_document(uuid) to service_role;

-- Keep documents in sync when ads or creatives change.
create or replace function research.trg_refresh_ad_search_document()
returns trigger
language plpgsql
security definer
set search_path = research, pg_temp
as $$
declare
  v_ad uuid;
begin
  if tg_table_name = 'observed_ads' then
    v_ad := new.id;
  else
    v_ad := new.observed_ad_id;
  end if;
  perform research.refresh_ad_search_document(v_ad);
  return null;
end;
$$;

drop trigger if exists trg_observed_ads_search_document on research.observed_ads;
create trigger trg_observed_ads_search_document
  after insert or update of external_ad_id, active_status,
    source_created_at, source_delivery_started_at, source_delivery_stopped_at,
    first_seen_at, last_seen_at
  on research.observed_ads
  for each row execute function research.trg_refresh_ad_search_document();

drop trigger if exists trg_ad_creatives_search_document on research.ad_creatives;
create trigger trg_ad_creatives_search_document
  after insert or update of headline, body, cta, format, classification,
    ocr_text, transcript, ocr_status
  on research.ad_creatives
  for each row execute function research.trg_refresh_ad_search_document();

-- Initial backfill of every observed ad.
select count(*) from (
  select research.refresh_ad_search_document(oa.id)
  from research.observed_ads oa
) seeded;

-- ---------------------------------------------------------------------------
-- 5. Backfill creatives for observed ads that have none
-- ---------------------------------------------------------------------------
-- Ads collected through the apify providers carry headline/body/image data in
-- raw_payload but never got an ad_creatives row. Derive one from the newest
-- snapshot payload. Zero-ad pages are unaffected.
insert into research.ad_creatives (
  observed_ad_id, format, headline, body, cta, cta_url,
  primary_image_url, image_urls, video_url, video_thumbnail_url,
  landing_url, creative_hash, classification_status, display_state, metadata
)
select
  oa.id,
  case when coalesce(payload.video_url, '') <> '' then 'video' else 'image' end,
  nullif(payload.headline, ''),
  nullif(payload.body, ''),
  nullif(payload.cta, ''),
  nullif(payload.cta_url, ''),
  nullif(payload.image_url, ''),
  case when payload.image_url is not null then array[payload.image_url] else '{}'::text[] end,
  nullif(payload.video_url, ''),
  nullif(payload.video_thumbnail_url, ''),
  nullif(payload.landing_url, ''),
  md5(concat_ws('|', payload.headline, payload.body, payload.image_url, payload.video_url, oa.external_ad_id)),
  'unclassified',
  'pending_review',
  jsonb_build_object('backfilled_from', 'raw_payload', 'backfilled_at', now())
from research.observed_ads oa
cross join lateral (
  select
    nullif(oa.raw_payload->>'headline', '') as headline,
    nullif(coalesce(oa.raw_payload->'body'->>'text', oa.raw_payload->>'body'), '') as body,
    nullif(oa.raw_payload->>'cta_text', '') as cta,
    nullif(oa.raw_payload->>'cta_url', '') as cta_url,
    nullif(oa.raw_payload->>'image_url', '') as image_url,
    nullif(oa.raw_payload->>'video_url', '') as video_url,
    nullif(oa.raw_payload->>'video_thumbnail_url', '') as video_thumbnail_url,
    nullif(oa.raw_payload->>'link_url', '') as landing_url
  ) payload
where not exists (select 1 from research.ad_creatives ac where ac.observed_ad_id = oa.id)
  and (payload.headline is not null or payload.body is not null
       or payload.image_url is not null or payload.video_url is not null);

notify pgrst, 'reload schema';
