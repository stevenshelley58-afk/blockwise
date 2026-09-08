-- Allow a creative's provenance rows to alias the same verified bytes.
-- media_assets are source-URL/provenance references; media_archive_objects is the
-- content-addressed byte identity and remains globally unique by hash and key.
-- Keep media_assets_creative_source_idx unique: one row per creative/source URL.
-- The captured hash/storage values are aliases and therefore must not be unique
-- per creative (different source URLs may resolve to the same archive object).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop index if exists research.media_assets_creative_content_hash_idx;
create index if not exists media_assets_creative_content_hash_idx
  on research.media_assets (ad_creative_id, content_hash)
  where capture_status = 'captured' and content_hash is not null;

drop index if exists research.media_assets_creative_storage_idx;
create index if not exists media_assets_creative_storage_idx
  on research.media_assets (ad_creative_id, storage_bucket, storage_path)
  where storage_path is not null;

comment on index research.media_assets_creative_content_hash_idx is
  'Non-unique lookup: source/provenance aliases for one creative may share verified content bytes.';
comment on index research.media_assets_creative_storage_idx is
  'Non-unique lookup: source/provenance aliases may point at one content-addressed archive object.';

commit;
