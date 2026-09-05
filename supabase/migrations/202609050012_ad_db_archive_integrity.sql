-- A source URL or old captured status is not archive proof.
create or replace function research.assert_media_archive_integrity()
returns trigger language plpgsql set search_path = research, pg_temp as $$
begin
  if new.archive_verified_at is not null and new.archive_object_id is null then
    raise exception 'archive_verified_at requires archive_object_id';
  end if;
  if new.capture_status = 'captured' and new.archive_object_id is not null and new.archive_verified_at is null then
    raise exception 'captured archive object requires archive_verified_at';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_media_assets_archive_integrity on research.media_assets;
create trigger trg_media_assets_archive_integrity
  before insert or update of capture_status, archive_object_id, archive_verified_at
  on research.media_assets for each row execute function research.assert_media_archive_integrity();

-- The worker uploads to a SHA-256-derived key and verifies bytes before using
-- this RPC. The storage service remains the existing Hermes Storage volume.
create or replace function research.link_verified_media_archive(
  p_media_asset_id uuid, p_content_hash text, p_storage_bucket text,
  p_object_key text, p_byte_size bigint, p_mime_type text
) returns research.media_assets language plpgsql security definer
set search_path = research, pg_temp as $$
declare v_object_id uuid; v_asset research.media_assets;
begin
  if p_content_hash !~ '^[a-f0-9]{64}$' then raise exception 'content hash must be lowercase SHA-256'; end if;
  if p_byte_size <= 0 or btrim(coalesce(p_mime_type, '')) = '' then raise exception 'archive requires bytes and MIME'; end if;
  insert into research.media_archive_objects (content_hash, storage_bucket, object_key, byte_size, mime_type, verified_at)
  values (p_content_hash, p_storage_bucket, p_object_key, p_byte_size, p_mime_type, now())
  on conflict (content_hash) do update set verified_at = greatest(research.media_archive_objects.verified_at, excluded.verified_at)
  returning id into v_object_id;
  update research.media_assets set archive_object_id = v_object_id, archive_verified_at = now(), archive_failure_reason = null,
      storage_bucket = p_storage_bucket, storage_path = p_object_key, object_key = p_object_key,
      content_hash = p_content_hash, byte_size = p_byte_size, mime_type = p_mime_type, content_type = p_mime_type,
      capture_status = 'captured', captured_at = coalesce(captured_at, now())
  where id = p_media_asset_id returning * into v_asset;
  if v_asset.id is null then raise exception 'media asset % not found', p_media_asset_id; end if;
  return v_asset;
end;
$$;

grant execute on function research.link_verified_media_archive(uuid, text, text, text, bigint, text) to service_role;
