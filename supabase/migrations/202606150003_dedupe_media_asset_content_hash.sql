-- Finish media cleanup by folding historical captured rows that have the same
-- content hash for the same creative but different legacy storage paths.

begin;

create schema if not exists research_archive;
revoke all on schema research_archive from public, anon, authenticated;
grant usage on schema research_archive to service_role;

create table if not exists research_archive.media_assets_content_hash_dedupe_202606150003
  (like research.media_assets including defaults);
alter table research_archive.media_assets_content_hash_dedupe_202606150003
  add column if not exists canonical_media_asset_id uuid,
  add column if not exists duplicate_reason text,
  add column if not exists archived_at timestamptz not null default now();
revoke all on research_archive.media_assets_content_hash_dedupe_202606150003 from public, anon, authenticated;
grant select, insert on research_archive.media_assets_content_hash_dedupe_202606150003 to service_role;

create table if not exists research_archive.ad_style_profiles_content_hash_dedupe_202606150003
  (like research.ad_style_profiles including defaults);
alter table research_archive.ad_style_profiles_content_hash_dedupe_202606150003
  add column if not exists canonical_media_asset_id uuid,
  add column if not exists archived_at timestamptz not null default now();
revoke all on research_archive.ad_style_profiles_content_hash_dedupe_202606150003 from public, anon, authenticated;
grant select, insert on research_archive.ad_style_profiles_content_hash_dedupe_202606150003 to service_role;

create temporary table media_asset_content_hash_dedupe_map (
  duplicate_id uuid primary key,
  canonical_id uuid not null,
  duplicate_reason text not null
) on commit drop;

with ranked as (
  select
    ma.id,
    first_value(ma.id) over content_group as canonical_id,
    row_number() over content_group as row_rank
  from research.media_assets ma
  left join research.ad_style_profiles asp on asp.media_asset_id = ma.id
  where ma.capture_status = 'captured'
    and ma.content_hash is not null
  window content_group as (
    partition by ma.ad_creative_id, ma.content_hash
    order by
      (ma.storage_path like 'media-blobs/%') desc,
      (asp.id is not null) desc,
      (ma.storage_bucket is not null) desc,
      (ma.byte_size is not null) desc,
      ma.captured_at asc nulls last,
      ma.created_at asc,
      ma.id asc
  )
)
insert into media_asset_content_hash_dedupe_map (duplicate_id, canonical_id, duplicate_reason)
select id, canonical_id, 'same_creative_content_hash'
from ranked
where row_rank > 1
  and id <> canonical_id
on conflict (duplicate_id) do nothing;

do $$
declare
  duplicate_rows integer;
begin
  select count(*) into duplicate_rows from media_asset_content_hash_dedupe_map;
  raise notice 'media content-hash dedupe will archive and remove % duplicate rows', duplicate_rows;
end $$;

insert into research_archive.media_assets_content_hash_dedupe_202606150003
select ma.*, m.canonical_id, m.duplicate_reason, now()
from research.media_assets ma
join media_asset_content_hash_dedupe_map m on m.duplicate_id = ma.id;

with duplicate_profile_refs as (
  select
    asp.id,
    m.canonical_id,
    row_number() over (
      partition by m.canonical_id
      order by asp.created_at asc, asp.id asc
    ) as canonical_rank,
    exists (
      select 1
      from research.ad_style_profiles existing
      where existing.media_asset_id = m.canonical_id
        and existing.id <> asp.id
    ) as canonical_profile_exists
  from research.ad_style_profiles asp
  join media_asset_content_hash_dedupe_map m on m.duplicate_id = asp.media_asset_id
)
update research.ad_style_profiles asp
set media_asset_id = duplicate_profile_refs.canonical_id
from duplicate_profile_refs
where asp.id = duplicate_profile_refs.id
  and duplicate_profile_refs.canonical_rank = 1
  and not duplicate_profile_refs.canonical_profile_exists;

insert into research_archive.ad_style_profiles_content_hash_dedupe_202606150003
select asp.*, m.canonical_id, now()
from research.ad_style_profiles asp
join media_asset_content_hash_dedupe_map m on m.duplicate_id = asp.media_asset_id;

delete from research.ad_style_profiles asp
using media_asset_content_hash_dedupe_map m
where asp.media_asset_id = m.duplicate_id;

do $$
begin
  if to_regclass('research.media_blobs') is not null then
    execute $update_media_blobs$
      update research.media_blobs mb
      set metadata = jsonb_set(
        coalesce(mb.metadata, '{}'::jsonb),
        '{first_media_asset_id}',
        to_jsonb(m.canonical_id::text),
        true
      )
      from media_asset_content_hash_dedupe_map m
      where mb.metadata ->> 'first_media_asset_id' = m.duplicate_id::text
    $update_media_blobs$;
  end if;
end $$;

delete from research.media_assets ma
using media_asset_content_hash_dedupe_map m
where ma.id = m.duplicate_id;

with affected as (
  select distinct canonical.ad_creative_id
  from media_asset_content_hash_dedupe_map m
  join research.media_assets canonical on canonical.id = m.canonical_id
),
aggregated as (
  select
    affected.ad_creative_id,
    (array_agg(ma.storage_path order by (ma.storage_path like 'media-blobs/%') desc, ma.created_at, ma.id)
      filter (where ma.kind = 'image' and ma.storage_path is not null))[1] as image_storage_path,
    (array_agg(ma.storage_path order by (ma.storage_path like 'media-blobs/%') desc, ma.created_at, ma.id)
      filter (where ma.kind = 'video' and ma.storage_path is not null))[1] as video_storage_path,
    (array_agg(ma.storage_path order by (ma.storage_path like 'media-blobs/%') desc, ma.created_at, ma.id)
      filter (where ma.kind = 'thumbnail' and ma.storage_path is not null))[1] as video_thumbnail_url,
    jsonb_agg(
      jsonb_build_object(
        'id', ma.id,
        'kind', ma.kind,
        'storagePath', ma.storage_path,
        'sourceUrl', ma.source_url,
        'contentType', ma.content_type,
        'byteSize', ma.byte_size,
        'capturedAt', coalesce(ma.captured_at, ma.created_at)
      )
      order by (ma.storage_path like 'media-blobs/%') desc, ma.created_at, ma.id
    ) filter (where ma.id is not null) as media_assets
  from affected
  left join research.media_assets ma
    on ma.ad_creative_id = affected.ad_creative_id
   and ma.capture_status = 'captured'
  group by affected.ad_creative_id
)
update research.ad_creatives ac
set
  image_storage_path = aggregated.image_storage_path,
  video_storage_path = aggregated.video_storage_path,
  video_thumbnail_url = aggregated.video_thumbnail_url,
  media_assets = coalesce(aggregated.media_assets, '[]'::jsonb)
from aggregated
where ac.id = aggregated.ad_creative_id;

drop index if exists research.media_assets_creative_content_hash_idx;
create unique index media_assets_creative_content_hash_idx
  on research.media_assets (ad_creative_id, content_hash)
  where capture_status = 'captured'
    and content_hash is not null;

notify pgrst, 'reload schema';

commit;
