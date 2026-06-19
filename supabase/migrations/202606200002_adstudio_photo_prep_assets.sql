-- Ad Studio prepared photo assets.
--
-- New template Create uses durable, frame-specific photo prep before Fabric/SVG
-- composition. Historical repair outputs remain in adstudio_brand_assets and are
-- backfilled here as legacy_imported rows so no generated user asset is lost.

begin;

create table if not exists public.adstudio_photo_prep_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_kit_id uuid references public.adstudio_brand_kits (id) on delete set null,
  source_image_hash text not null,
  source_image_ref text not null,
  template_key text not null,
  template_version integer not null default 1,
  frame_id text not null,
  format text not null,
  cache_key text not null,
  method text not null,
  storage_path text,
  source_url text,
  width_px integer not null default 0,
  height_px integer not null default 0,
  prompt_version_id uuid references public.prompt_versions (id) on delete set null,
  model_profile_key text not null default 'image_final',
  model_name text,
  provider_name text,
  qa_status text not null default 'pending',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint adstudio_photo_prep_assets_template_version_check check (template_version >= 1),
  constraint adstudio_photo_prep_assets_format_check check (format in ('9:16', '4:5', '1:1', '1.91:1')),
  constraint adstudio_photo_prep_assets_method_check check (
    method in (
      'deterministic_smart_crop',
      'model_reframe',
      'model_extend',
      'fallback_smart_crop',
      'legacy_imported'
    )
  ),
  constraint adstudio_photo_prep_assets_qa_status_check check (qa_status in ('pending', 'passed', 'failed')),
  constraint adstudio_photo_prep_assets_metadata_json_check check (jsonb_typeof(metadata_json) = 'object'),
  constraint adstudio_photo_prep_assets_size_check check (width_px >= 0 and height_px >= 0)
);

create unique index if not exists adstudio_photo_prep_assets_workspace_cache_unique
  on public.adstudio_photo_prep_assets (workspace_id, cache_key);

create index if not exists adstudio_photo_prep_assets_workspace_template_idx
  on public.adstudio_photo_prep_assets (workspace_id, template_key, template_version, frame_id, format, updated_at desc);

create index if not exists adstudio_photo_prep_assets_workspace_source_idx
  on public.adstudio_photo_prep_assets (workspace_id, source_image_hash, updated_at desc);

alter table public.adstudio_photo_prep_assets enable row level security;

drop policy if exists adstudio_photo_prep_assets_workspace_select on public.adstudio_photo_prep_assets;
create policy adstudio_photo_prep_assets_workspace_select on public.adstudio_photo_prep_assets
  for select using (public.is_operator() or public.is_workspace_member(workspace_id));

drop policy if exists adstudio_photo_prep_assets_server_owned_no_client_insert on public.adstudio_photo_prep_assets;
drop policy if exists adstudio_photo_prep_assets_server_owned_no_client_update on public.adstudio_photo_prep_assets;
drop policy if exists adstudio_photo_prep_assets_server_owned_no_client_delete on public.adstudio_photo_prep_assets;
create policy adstudio_photo_prep_assets_server_owned_no_client_insert
  on public.adstudio_photo_prep_assets for insert to authenticated with check (false);
create policy adstudio_photo_prep_assets_server_owned_no_client_update
  on public.adstudio_photo_prep_assets for update to authenticated using (false) with check (false);
create policy adstudio_photo_prep_assets_server_owned_no_client_delete
  on public.adstudio_photo_prep_assets for delete to authenticated using (false);

comment on table public.adstudio_photo_prep_assets is
  'Prepared customer photo assets for locked Ad Studio template frames. The image model prepares photo assets only; final ads are composited separately.';

comment on column public.adstudio_photo_prep_assets.cache_key is
  'Unique cache key over workspace, image hash, template version, frame, format, prompt version, and model profile version.';

insert into public.adstudio_photo_prep_assets (
  workspace_id,
  brand_kit_id,
  source_image_hash,
  source_image_ref,
  template_key,
  template_version,
  frame_id,
  format,
  cache_key,
  method,
  storage_path,
  source_url,
  model_profile_key,
  model_name,
  provider_name,
  qa_status,
  metadata_json,
  created_at,
  updated_at
)
select
  asset.workspace_id,
  asset.brand_kit_id,
  'legacy:' || md5(coalesce(asset.metadata_json->>'sourceImage', asset.storage_path, asset.source_url, asset.id::text)),
  coalesce(asset.metadata_json->>'sourceImage', asset.source_url, asset.storage_path, ''),
  coalesce(asset.metadata_json->>'templateKey', 'legacy_repair'),
  case
    when asset.metadata_json->>'templateVersion' ~ '^[0-9]+$'
      then greatest((asset.metadata_json->>'templateVersion')::integer, 1)
    else 1
  end,
  coalesce(asset.metadata_json->>'frameId', 'primary_photo'),
  case
    when asset.metadata_json->>'targetFormat' in ('9:16', '4:5', '1:1', '1.91:1') then asset.metadata_json->>'targetFormat'
    else '1:1'
  end,
  'legacy-repair:' || asset.id::text,
  'legacy_imported',
  asset.storage_path,
  asset.source_url,
  'image_final',
  asset.metadata_json->>'model',
  asset.metadata_json->>'provider',
  'pending',
  asset.metadata_json || jsonb_build_object('legacyBackfill', true, 'brandAssetId', asset.id),
  asset.created_at,
  now()
from public.adstudio_brand_assets asset
where asset.metadata_json->>'aiRepair' = 'true'
on conflict (workspace_id, cache_key) do nothing;

commit;
