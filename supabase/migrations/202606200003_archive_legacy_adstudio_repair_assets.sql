-- Remove legacy Ad Studio repair outputs from the live brand asset library after
-- 202606200002 backfills them into adstudio_photo_prep_assets.
--
-- Safety: only rows explicitly marked as old AI repair outputs are touched, and
-- deletion happens only after an archive row-count check succeeds.

create schema if not exists legacy_archive;

create table if not exists legacy_archive.adstudio_brand_assets_ai_repair_20260620 (
  id uuid primary key,
  workspace_id uuid not null,
  brand_kit_id uuid not null,
  asset_type text not null,
  storage_path text,
  source_url text,
  metadata_json jsonb not null default '{}',
  locked boolean not null default false,
  created_at timestamptz not null,
  archived_at timestamptz not null default now(),
  archive_reason text not null default 'adstudio_photo_prep_assets_backfill'
);

do $$
declare
  legacy_count integer;
  archived_count integer;
begin
  select count(*)
  into legacy_count
  from public.adstudio_brand_assets asset
  where asset.metadata_json->>'aiRepair' = 'true';

  if legacy_count = 0 then
    return;
  end if;

  insert into legacy_archive.adstudio_brand_assets_ai_repair_20260620 (
    id,
    workspace_id,
    brand_kit_id,
    asset_type,
    storage_path,
    source_url,
    metadata_json,
    locked,
    created_at,
    archived_at,
    archive_reason
  )
  select
    asset.id,
    asset.workspace_id,
    asset.brand_kit_id,
    asset.asset_type,
    asset.storage_path,
    asset.source_url,
    asset.metadata_json,
    asset.locked,
    asset.created_at,
    now(),
    'adstudio_photo_prep_assets_backfill'
  from public.adstudio_brand_assets asset
  where asset.metadata_json->>'aiRepair' = 'true'
  on conflict (id) do nothing;

  select count(*)
  into archived_count
  from public.adstudio_brand_assets asset
  where asset.metadata_json->>'aiRepair' = 'true'
    and exists (
      select 1
      from legacy_archive.adstudio_brand_assets_ai_repair_20260620 archive
      where archive.id = asset.id
    );

  if archived_count <> legacy_count then
    raise exception 'Refusing to delete legacy Ad Studio repair assets: archived % of % rows.',
      archived_count,
      legacy_count;
  end if;

  delete from public.adstudio_brand_assets asset
  where asset.metadata_json->>'aiRepair' = 'true'
    and exists (
      select 1
      from legacy_archive.adstudio_brand_assets_ai_repair_20260620 archive
      where archive.id = asset.id
    );
end $$;
