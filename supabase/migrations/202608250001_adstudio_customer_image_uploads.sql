-- Customer AdStudio images live in their own private bucket.  The bucket
-- limits are enforced by Storage as well as by the application routes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'adstudio-customer-images',
  'adstudio-customer-images',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.adstudio_customer_image_uploads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_id uuid not null references public.ad_customer_ads(id) on delete cascade,
  object_path text not null unique,
  sha256 text not null,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  status text not null default 'pending' check (status in ('pending', 'finalizing', 'deleting', 'finalized')),
  expires_at timestamptz not null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sha256 ~ '^[a-f0-9]{64}$'),
  check (object_path ~ ('^' || workspace_id::text || '/adstudio/ads/' || ad_id::text || '/images/[a-f0-9]{64}\.(png|jpg|webp)$')),
  check ((status in ('pending', 'finalizing', 'deleting') and finalized_at is null) or (status = 'finalized' and finalized_at is not null))
);

do $$
begin
  alter table public.adstudio_customer_image_uploads
    drop constraint if exists adstudio_customer_image_uploads_status_check;
  alter table public.adstudio_customer_image_uploads
    drop constraint if exists adstudio_customer_image_uploads_status_finalized_at_check;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.adstudio_customer_image_uploads'::regclass
       and conname = 'adstudio_customer_image_uploads_status_check'
  ) then
    alter table public.adstudio_customer_image_uploads
      add constraint adstudio_customer_image_uploads_status_check
      check (status in ('pending', 'finalizing', 'deleting', 'finalized'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.adstudio_customer_image_uploads'::regclass
       and conname = 'adstudio_customer_image_uploads_status_finalized_at_check'
  ) then
    alter table public.adstudio_customer_image_uploads
      add constraint adstudio_customer_image_uploads_status_finalized_at_check
      check ((status in ('pending', 'finalizing', 'deleting') and finalized_at is null) or (status = 'finalized' and finalized_at is not null));
  end if;
end;
$$;

create index if not exists adstudio_customer_image_uploads_workspace_status_idx
  on public.adstudio_customer_image_uploads (workspace_id, status, expires_at);

alter table public.adstudio_customer_image_uploads enable row level security;
revoke all on table public.adstudio_customer_image_uploads from public, anon, authenticated;
grant all on table public.adstudio_customer_image_uploads to service_role;
drop policy if exists adstudio_customer_image_uploads_service_role_all on public.adstudio_customer_image_uploads;
create policy adstudio_customer_image_uploads_service_role_all
  on public.adstudio_customer_image_uploads
  as permissive for all to service_role
  using (true) with check (true);

create or replace function public.adstudio_prepare_customer_image_upload(
  p_workspace_id uuid,
  p_ad_id uuid,
  p_object_path text,
  p_sha256 text,
  p_mime_type text,
  p_byte_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stale_paths jsonb := '[]'::jsonb;
  existing_id uuid;
  existing_status text;
  existing_sha256 text;
  existing_mime_type text;
  existing_byte_size bigint;
  new_id uuid;
  used_bytes bigint;
  used_count bigint;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > 10485760
     or p_mime_type not in ('image/png', 'image/jpeg', 'image/webp')
     or p_sha256 !~ '^[a-f0-9]{64}$'
     or p_object_path !~ ('^' || p_workspace_id::text || '/adstudio/ads/' || p_ad_id::text || '/images/[a-f0-9]{64}\.(png|jpg|webp)$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_upload_metadata');
  end if;

  -- Serialize reservations per workspace so concurrent prepares cannot both
  -- observe the same quota headroom and oversubscribe it.
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  with claimed as (
    update public.adstudio_customer_image_uploads
       set status = 'deleting', updated_at = now()
     where workspace_id = p_workspace_id
       and status in ('pending', 'finalizing')
       and expires_at < now()
     returning id, object_path
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'path', object_path)), '[]'::jsonb)
    into stale_paths
    from claimed;

  select id, status, sha256, mime_type, byte_size
    into existing_id, existing_status, existing_sha256, existing_mime_type, existing_byte_size
    from public.adstudio_customer_image_uploads
   where object_path = p_object_path
   for update;

  if existing_status is not null then
    if existing_status in ('finalizing', 'deleting') then
      return jsonb_build_object('ok', false, 'code', 'upload_cleanup_in_progress', 'stale_paths', stale_paths);
    end if;
    if existing_sha256 <> p_sha256 or existing_mime_type <> p_mime_type or existing_byte_size <> p_byte_size then
      return jsonb_build_object('ok', false, 'code', 'upload_metadata_conflict', 'stale_paths', stale_paths);
    end if;
    if existing_status = 'pending' then
      update public.adstudio_customer_image_uploads
         set expires_at = now() + interval '15 minutes', updated_at = now()
       where object_path = p_object_path;
    end if;
    return jsonb_build_object('ok', true, 'status', existing_status, 'reservation_id', existing_id, 'stale_paths', stale_paths);
  end if;

  select coalesce(sum(byte_size), 0), count(*)
    into used_bytes, used_count
    from public.adstudio_customer_image_uploads
   where workspace_id = p_workspace_id;

  if used_count >= 1000 or used_bytes + p_byte_size > 262144000 then
    return jsonb_build_object('ok', false, 'code', 'workspace_upload_quota', 'stale_paths', stale_paths);
  end if;

  insert into public.adstudio_customer_image_uploads (
    workspace_id, ad_id, object_path, sha256, mime_type, byte_size, expires_at
  ) values (
    p_workspace_id, p_ad_id, p_object_path, p_sha256, p_mime_type, p_byte_size, now() + interval '15 minutes'
  ) returning id into new_id;

  return jsonb_build_object('ok', true, 'status', 'pending', 'reservation_id', new_id, 'stale_paths', stale_paths);
end;
$$;

drop function if exists public.adstudio_finalize_customer_image_upload(uuid, uuid, text, text, text, bigint);
drop function if exists public.adstudio_discard_customer_image_upload(uuid, uuid, text);

create or replace function public.adstudio_claim_customer_image_finalize(
  p_reservation_id uuid,
  p_workspace_id uuid,
  p_ad_id uuid,
  p_object_path text,
  p_sha256 text,
  p_mime_type text,
  p_byte_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation public.adstudio_customer_image_uploads%rowtype;
  claimed_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));
  select * into reservation
    from public.adstudio_customer_image_uploads
   where id = p_reservation_id
   for update;

  if reservation.id is null
     or reservation.workspace_id <> p_workspace_id
     or reservation.ad_id <> p_ad_id
     or reservation.object_path <> p_object_path
     or reservation.sha256 <> p_sha256
     or reservation.mime_type <> p_mime_type
     or reservation.byte_size <> p_byte_size then
    return jsonb_build_object('ok', false, 'code', 'upload_reservation_mismatch');
  end if;
  if reservation.status = 'deleting' then
    return jsonb_build_object('ok', false, 'code', 'upload_cleanup_in_progress');
  end if;
  if reservation.status = 'finalized' then
    return jsonb_build_object('ok', false, 'code', 'upload_already_finalized');
  end if;
  if reservation.status <> 'pending' or reservation.expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'upload_finalization_in_progress');
  end if;

  update public.adstudio_customer_image_uploads
     set status = 'finalizing', expires_at = now() + interval '15 minutes', updated_at = now()
   where id = p_reservation_id and status = 'pending'
  returning id into claimed_id;
  if claimed_id is null then
    return jsonb_build_object('ok', false, 'code', 'upload_finalization_in_progress');
  end if;
  return jsonb_build_object('ok', true, 'status', 'finalizing', 'reservation_id', claimed_id);
end;
$$;

create or replace function public.adstudio_finalize_customer_image_upload(
  p_reservation_id uuid,
  p_workspace_id uuid,
  p_ad_id uuid,
  p_object_path text,
  p_sha256 text,
  p_mime_type text,
  p_byte_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation public.adstudio_customer_image_uploads%rowtype;
  completed_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select * into reservation
    from public.adstudio_customer_image_uploads
   where id = p_reservation_id
   for update;

  if reservation.id is null
     or reservation.workspace_id <> p_workspace_id
     or reservation.ad_id <> p_ad_id
     or reservation.object_path <> p_object_path
     or reservation.sha256 <> p_sha256
     or reservation.mime_type <> p_mime_type
     or reservation.byte_size <> p_byte_size then
    return jsonb_build_object('ok', false, 'code', 'upload_reservation_mismatch');
  end if;

  update public.adstudio_customer_image_uploads
     set status = 'finalized', finalized_at = now(), updated_at = now()
   where id = p_reservation_id
     and workspace_id = p_workspace_id
     and ad_id = p_ad_id
     and object_path = p_object_path
     and sha256 = p_sha256
     and mime_type = p_mime_type
     and byte_size = p_byte_size
     and expires_at > now()
     and status = 'finalizing'
  returning id into completed_id;
  if completed_id is null then
    return jsonb_build_object('ok', false, 'code', 'upload_finalization_not_claimed');
  end if;
  return jsonb_build_object('ok', true, 'status', 'finalized', 'reservation_id', completed_id);
end;
$$;

create or replace function public.adstudio_discard_customer_image_upload(
  p_reservation_id uuid,
  p_workspace_id uuid,
  p_ad_id uuid,
  p_object_path text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));
  update public.adstudio_customer_image_uploads
     set status = 'deleting', updated_at = now()
   where id = p_reservation_id and workspace_id = p_workspace_id and ad_id = p_ad_id
     and object_path = p_object_path and status in ('pending', 'finalizing');
  get diagnostics deleted = row_count;
  return deleted = 1;
end;
$$;

-- The prepare transaction claims stale rows before returning them. The route
-- may delete bytes only for these deleting tombstones, then completes the
-- exact claim. A failed Storage removal leaves the tombstone for retry.
drop function if exists public.adstudio_customer_image_stale_path_is_safe(uuid, text);

create or replace function public.adstudio_complete_customer_image_stale_cleanup(
  p_reservation_id uuid,
  p_object_path text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  delete from public.adstudio_customer_image_uploads
   where id = p_reservation_id
     and object_path = p_object_path
     and status = 'deleting';
  return found;
end;
$$;

revoke all on function public.adstudio_prepare_customer_image_upload(uuid, uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.adstudio_claim_customer_image_finalize(uuid, uuid, uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.adstudio_finalize_customer_image_upload(uuid, uuid, uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.adstudio_discard_customer_image_upload(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.adstudio_prepare_customer_image_upload(uuid, uuid, text, text, text, bigint) to service_role;
grant execute on function public.adstudio_claim_customer_image_finalize(uuid, uuid, uuid, text, text, text, bigint) to service_role;
grant execute on function public.adstudio_finalize_customer_image_upload(uuid, uuid, uuid, text, text, text, bigint) to service_role;
grant execute on function public.adstudio_discard_customer_image_upload(uuid, uuid, uuid, text) to service_role;
revoke all on function public.adstudio_complete_customer_image_stale_cleanup(uuid, text) from public, anon, authenticated;
grant execute on function public.adstudio_complete_customer_image_stale_cleanup(uuid, text) to service_role;
