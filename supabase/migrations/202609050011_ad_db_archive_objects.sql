-- Canonical, content-addressed metadata for Hermes research-media. This is
-- metadata only: bytes remain in the Hermes filesystem archive rooted at
-- /srv/hermes/ad-db/assets.
create table if not exists research.media_archive_objects (
  id uuid primary key default gen_random_uuid(),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  storage_bucket text not null check (btrim(storage_bucket) <> ''),
  object_key text not null check (
    object_key ~ '^sha256/[a-f0-9]{64}$'
    and object_key = 'sha256/' || content_hash
  ),
  byte_size bigint not null check (byte_size > 0),
  mime_type text not null check (btrim(mime_type) <> '' and mime_type = btrim(mime_type)),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (content_hash),
  unique (storage_bucket, object_key)
);

comment on table research.media_archive_objects is
  'Verified content-addressed objects in the Hermes filesystem archive; distinct ads may reference one object.';

alter table research.media_assets
  add column if not exists archive_object_id uuid references research.media_archive_objects(id) on delete restrict,
  add column if not exists archive_verified_at timestamptz,
  add column if not exists archive_failure_reason text;

create index if not exists media_assets_archive_object_idx
  on research.media_assets (archive_object_id) where archive_object_id is not null;

-- Historic captured rows remain eligible for lazy verification, but never
-- appear as archived until both the verified object and timestamp exist.
create or replace view research.v_ad_db_archived_media as
select ma.id, ma.observed_ad_id, ma.ad_creative_id, ma.creative_version_id,
       ma.kind, mao.storage_bucket, mao.object_key, mao.content_hash,
       mao.byte_size, mao.mime_type, mao.verified_at, ma.width, ma.height,
       ma.duration_ms
from research.media_assets ma
join research.media_archive_objects mao on mao.id = ma.archive_object_id
where ma.capture_status = 'captured'
  and ma.archive_verified_at is not null
  and mao.verified_at is not null;

grant select on research.media_archive_objects, research.v_ad_db_archived_media to service_role;
