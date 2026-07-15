begin;

create schema if not exists research_archive;

create table if not exists research_archive.media_assets_tiny_image_202607150004
  (like research.media_assets including all);

alter table research_archive.media_assets_tiny_image_202607150004
  add column if not exists archived_at timestamptz not null default now();

revoke all on research_archive.media_assets_tiny_image_202607150004 from public, anon, authenticated;
grant select, insert on research_archive.media_assets_tiny_image_202607150004 to service_role;

create temporary table tiny_media_affected_creatives on commit drop as
select distinct ma.ad_creative_id
from research.media_assets ma
where ma.kind = 'image'
  and ma.capture_status = 'captured'
  and (
    ma.byte_size < 2048
    or (ma.width is not null and ma.width < 200)
    or (ma.height is not null and ma.height < 150)
  );

do $$
declare
  affected_assets bigint;
  affected_creatives bigint;
begin
  select count(*) into affected_assets
  from research.media_assets ma
  join tiny_media_affected_creatives affected on affected.ad_creative_id = ma.ad_creative_id
  where ma.kind = 'image'
    and ma.capture_status = 'captured'
    and (
      ma.byte_size < 2048
      or (ma.width is not null and ma.width < 200)
      or (ma.height is not null and ma.height < 150)
    );

  select count(*) into affected_creatives from tiny_media_affected_creatives;
  raise notice 'Tiny-media repair will block % image assets across % creatives', affected_assets, affected_creatives;
end
$$;

insert into research_archive.media_assets_tiny_image_202607150004
select ma.*, now()
from research.media_assets ma
where ma.kind = 'image'
  and ma.capture_status = 'captured'
  and (
    ma.byte_size < 2048
    or (ma.width is not null and ma.width < 200)
    or (ma.height is not null and ma.height < 150)
  )
on conflict (id) do nothing;

update research.media_assets
set capture_status = 'blocked',
    last_error = 'Media quality rejected: image_too_small',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'media_quality_rejection', 'image_too_small',
      'repaired_by', '202607150004_repair_tiny_ad_media'
    ),
    updated_at = now()
where kind = 'image'
  and capture_status = 'captured'
  and (
    byte_size < 2048
    or (width is not null and width < 200)
    or (height is not null and height < 150)
  );

with aggregated as (
  select
    ac.id as ad_creative_id,
    (array_agg(ma.storage_path order by ma.created_at, ma.id)
      filter (where ma.kind = 'image' and ma.storage_path is not null))[1] as image_storage_path,
    (array_agg(ma.storage_path order by ma.created_at, ma.id)
      filter (where ma.kind = 'video' and ma.storage_path is not null))[1] as video_storage_path,
    (array_agg(ma.storage_path order by ma.created_at, ma.id)
      filter (where ma.kind = 'thumbnail' and ma.storage_path is not null))[1] as video_thumbnail_url,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'kind', ma.kind,
          'storagePath', ma.storage_path,
          'contentType', ma.content_type,
          'byteSize', ma.byte_size,
          'width', ma.width,
          'height', ma.height,
          'captureStatus', ma.capture_status,
          'capturedAt', ma.captured_at
        )
        order by ma.created_at, ma.id
      ) filter (where ma.id is not null),
      '[]'::jsonb
    ) as media_assets,
    coalesce(
      bool_or(
        case
          when ma.kind = 'video' then ma.byte_size is null or ma.byte_size >= 2048
          when ma.kind = 'image' then
            (ma.byte_size is null or ma.byte_size >= 2048)
            and (ma.width is null or ma.width >= 200)
            and (ma.height is null or ma.height >= 150)
          else false
        end
      ),
      false
    ) as has_displayable_media
  from research.ad_creatives ac
  join tiny_media_affected_creatives affected on affected.ad_creative_id = ac.id
  left join research.media_assets ma
    on ma.ad_creative_id = ac.id
   and ma.capture_status = 'captured'
  group by ac.id
)
update research.ad_creatives ac
set image_storage_path = aggregated.image_storage_path,
    video_storage_path = aggregated.video_storage_path,
    video_thumbnail_url = aggregated.video_thumbnail_url,
    media_assets = coalesce(aggregated.media_assets, '[]'::jsonb),
    display_state = case
      when ac.format in ('image', 'video', 'carousel')
       and not aggregated.has_displayable_media
      then 'hidden'
      else ac.display_state
    end,
    updated_at = now()
from aggregated
where ac.id = aggregated.ad_creative_id;

commit;
