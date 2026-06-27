-- Dedupe research media rows that point at the same stored object for the same
-- creative. The removed rows are archived first so source provenance remains
-- recoverable, while customer-facing creative media fields are rebuilt from the
-- canonical rows.

begin;

create schema if not exists research_archive;
revoke all on schema research_archive from public, anon, authenticated;
grant usage on schema research_archive to service_role;

create table if not exists research_archive.media_assets_dedupe_202606150002
  (like research.media_assets including defaults);
alter table research_archive.media_assets_dedupe_202606150002
  add column if not exists canonical_media_asset_id uuid,
  add column if not exists duplicate_reason text,
  add column if not exists archived_at timestamptz not null default now();
revoke all on research_archive.media_assets_dedupe_202606150002 from public, anon, authenticated;
grant select, insert on research_archive.media_assets_dedupe_202606150002 to service_role;

create table if not exists research_archive.ad_style_profiles_media_asset_dedupe_202606150002
  (like research.ad_style_profiles including defaults);
alter table research_archive.ad_style_profiles_media_asset_dedupe_202606150002
  add column if not exists canonical_media_asset_id uuid,
  add column if not exists archived_at timestamptz not null default now();
revoke all on research_archive.ad_style_profiles_media_asset_dedupe_202606150002 from public, anon, authenticated;
grant select, insert on research_archive.ad_style_profiles_media_asset_dedupe_202606150002 to service_role;

create temporary table media_asset_dedupe_map (
  duplicate_id uuid primary key,
  canonical_id uuid not null,
  duplicate_reason text not null
) on commit drop;

-- Stored-object duplicates are the large production drift: multiple rows on the
-- same creative point at the same captured bucket/path.
with ranked as (
  select
    ma.id,
    first_value(ma.id) over media_group as canonical_id,
    row_number() over media_group as row_rank
  from research.media_assets ma
  left join research.ad_style_profiles asp on asp.media_asset_id = ma.id
  where ma.capture_status = 'captured'
    and ma.storage_path is not null
  window media_group as (
    partition by ma.ad_creative_id, coalesce(ma.storage_bucket, ''), ma.storage_path
    order by
      (asp.id is not null) desc,
      (ma.content_hash is not null) desc,
      (ma.byte_size is not null) desc,
      ma.captured_at asc nulls last,
      ma.created_at asc,
      ma.id asc
  )
)
insert into media_asset_dedupe_map (duplicate_id, canonical_id, duplicate_reason)
select id, canonical_id, 'same_creative_storage_path'
from ranked
where row_rank > 1
  and id <> canonical_id
on conflict (duplicate_id) do nothing;

-- Source-url duplicates are much smaller, but they must be removed before
-- restoring the source uniqueness guard.
with remaining as (
  select ma.*
  from research.media_assets ma
  where ma.source_url is not null
    and not exists (
      select 1
      from media_asset_dedupe_map m
      where m.duplicate_id = ma.id
    )
),
ranked as (
  select
    remaining.id,
    first_value(remaining.id) over source_group as canonical_id,
    row_number() over source_group as row_rank
  from remaining
  left join research.ad_style_profiles asp on asp.media_asset_id = remaining.id
  window source_group as (
    partition by remaining.ad_creative_id, remaining.source_url
    order by
      (asp.id is not null) desc,
      (remaining.capture_status = 'captured') desc,
      (remaining.storage_path is not null) desc,
      (remaining.content_hash is not null) desc,
      remaining.captured_at asc nulls last,
      remaining.created_at asc,
      remaining.id asc
  )
)
insert into media_asset_dedupe_map (duplicate_id, canonical_id, duplicate_reason)
select id, canonical_id, 'same_creative_source_url'
from ranked
where row_rank > 1
  and id <> canonical_id
on conflict (duplicate_id) do nothing;

do $$
declare
  duplicate_rows integer;
begin
  select count(*) into duplicate_rows from media_asset_dedupe_map;
  raise notice 'media asset dedupe will archive and remove % duplicate rows', duplicate_rows;
end $$;

insert into research_archive.media_assets_dedupe_202606150002
select ma.*, m.canonical_id, m.duplicate_reason, now()
from research.media_assets ma
join media_asset_dedupe_map m on m.duplicate_id = ma.id;

-- Move at most one style profile reference to each canonical media row. If
-- both the duplicate and canonical rows already have profiles, or several
-- duplicate rows have profiles, archive the extra derived profiles before
-- deleting the duplicate media rows.
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
  join media_asset_dedupe_map m on m.duplicate_id = asp.media_asset_id
)
update research.ad_style_profiles asp
set media_asset_id = duplicate_profile_refs.canonical_id
from duplicate_profile_refs
where asp.id = duplicate_profile_refs.id
  and duplicate_profile_refs.canonical_rank = 1
  and not duplicate_profile_refs.canonical_profile_exists;

insert into research_archive.ad_style_profiles_media_asset_dedupe_202606150002
select asp.*, m.canonical_id, now()
from research.ad_style_profiles asp
join media_asset_dedupe_map m on m.duplicate_id = asp.media_asset_id;

delete from research.ad_style_profiles asp
using media_asset_dedupe_map m
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
      from media_asset_dedupe_map m
      where mb.metadata ->> 'first_media_asset_id' = m.duplicate_id::text
    $update_media_blobs$;
  end if;
end $$;

delete from research.media_assets ma
using media_asset_dedupe_map m
where ma.id = m.duplicate_id;

with affected as (
  select distinct canonical.ad_creative_id
  from media_asset_dedupe_map m
  join research.media_assets canonical on canonical.id = m.canonical_id
),
aggregated as (
  select
    affected.ad_creative_id,
    (array_agg(ma.storage_path order by ma.created_at, ma.id)
      filter (where ma.kind = 'image' and ma.storage_path is not null))[1] as image_storage_path,
    (array_agg(ma.storage_path order by ma.created_at, ma.id)
      filter (where ma.kind = 'video' and ma.storage_path is not null))[1] as video_storage_path,
    (array_agg(ma.storage_path order by ma.created_at, ma.id)
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
      order by ma.created_at, ma.id
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

drop index if exists research.media_assets_creative_source_idx;
create unique index media_assets_creative_source_idx
  on research.media_assets (ad_creative_id, source_url)
  where source_url is not null;

drop index if exists research.media_assets_creative_storage_idx;
create unique index media_assets_creative_storage_idx
  on research.media_assets (ad_creative_id, coalesce(storage_bucket, ''), storage_path)
  where storage_path is not null;

alter table research.media_assets
  drop constraint if exists media_assets_captured_storage_has_bucket;
alter table research.media_assets
  add constraint media_assets_captured_storage_has_bucket
  check (capture_status <> 'captured' or storage_path is null or storage_bucket is not null)
  not valid;
alter table research.media_assets validate constraint media_assets_captured_storage_has_bucket;

notify pgrst, 'reload schema';

commit;
