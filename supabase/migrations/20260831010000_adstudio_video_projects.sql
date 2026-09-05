-- Durable short-video projects, immutable media refs, and render queue.
-- The application stores references and attestations only; video bytes stay in
-- the private Storage bucket and are never embedded in JSON or plans.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'adstudio-videos', 'adstudio-videos', false, 524288000,
  array['video/mp4', 'video/webm', 'image/jpeg', 'image/png', 'text/vtt']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.ad_video_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_ad_id uuid references public.ad_customer_ads(id) on delete set null,
  template_id text,
  brand_kit_id uuid,
  project_json jsonb not null default '{}'::jsonb,
  plan_json jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'script_ready', 'queued', 'render_queued', 'rendering', 'succeeded', 'ready', 'failed', 'cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (jsonb_typeof(project_json) = 'object'),
  check (jsonb_typeof(plan_json) = 'object'),
  unique (workspace_id, id)
);

create index if not exists ad_video_projects_workspace_updated_idx
  on public.ad_video_projects (workspace_id, updated_at desc);

create table if not exists public.ad_video_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid,
  asset_role text not null check (asset_role in ('source', 'output', 'poster', 'captions')),
  object_path text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text not null check (mime_type in ('video/mp4', 'video/webm', 'image/jpeg', 'image/png', 'text/vtt')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 524288000),
  duration_ms integer check (duration_ms is null or (duration_ms > 0 and duration_ms <= 900000)),
  width integer check (width is null or (width > 0 and width <= 7680)),
  height integer check (height is null or (height > 0 and height <= 7680)),
  poster_path text,
  provenance_json jsonb not null default '{}'::jsonb,
  rights_json jsonb not null default '{}'::jsonb,
  consent_json jsonb not null default '{}'::jsonb,
  validation_status text not null default 'pending' check (validation_status in ('pending', 'validated', 'rejected')),
  validation_attestation_json jsonb,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, object_path),
  constraint ad_video_assets_workspace_project_sha256_mime_key unique (workspace_id, project_id, sha256, mime_type),
  check ((validation_status = 'validated' and validated_at is not null) or validation_status <> 'validated'),
  check (object_path !~ '(^|/)\.\.(?:/|$)')
  ,foreign key (workspace_id, project_id) references public.ad_video_projects(workspace_id, id) on delete cascade
);

create index if not exists ad_video_assets_workspace_project_idx
  on public.ad_video_assets (workspace_id, project_id, asset_role, created_at desc);

-- Upgrade databases created from the first draft of this migration, where
-- content dedupe was workspace-wide and therefore blocked the same media in a
-- second project. The project-scoped key is the actual reservation boundary.
alter table public.ad_video_assets
  drop constraint if exists ad_video_assets_workspace_id_sha256_mime_type_key,
  drop constraint if exists ad_video_assets_workspace_sha256_mime_type_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ad_video_assets'::regclass
       and conname = 'ad_video_assets_workspace_project_sha256_mime_key'
  ) then
    alter table public.ad_video_assets
      add constraint ad_video_assets_workspace_project_sha256_mime_key
      unique (workspace_id, project_id, sha256, mime_type);
  end if;
end;
$$;

-- Keep upload reservations bounded per workspace. This is deliberately a
-- security-definer read so the API can make one bounded check without
-- downloading the workspace ledger into a request function.
create or replace function public.adstudio_check_video_workspace_quota(
  p_workspace_id uuid,
  p_byte_size bigint
) returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_count bigint;
  current_bytes bigint;
begin
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > 524288000
     or not private.adstudio_has_workspace_access(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'workspace_video_quota');
  end if;

  select count(*)::bigint, coalesce(sum(byte_size), 0)::bigint
    into current_count, current_bytes
    from public.ad_video_assets
   where workspace_id = p_workspace_id
     and validation_status <> 'rejected';

  return jsonb_build_object(
    'ok', current_count < 1000 and current_bytes + p_byte_size <= 1073741824,
    'asset_count', current_count,
    'byte_size', current_bytes
  );
end;
$$;

revoke all on function public.adstudio_check_video_workspace_quota(uuid, bigint) from public, anon;
grant execute on function public.adstudio_check_video_workspace_quota(uuid, bigint) to authenticated, service_role;

create table if not exists public.ad_video_render_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  provider text,
  provider_job_id text,
  provider_metadata_json jsonb not null default '{}'::jsonb,
  cost_metadata_json jsonb not null default '{}'::jsonb,
  output_mp4_asset_id uuid,
  output_poster_asset_id uuid,
  output_captions_asset_id uuid,
  idempotency_key text not null,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.ad_video_projects(workspace_id, id) on delete cascade,
  unique (workspace_id, idempotency_key)
);

-- Output references carry the workspace key so a job can never point at an
-- asset from another workspace. Outputs are owned by their render job; a
-- project/asset cleanup therefore cascades the dependent receipt safely.
alter table public.ad_video_render_jobs
  add constraint ad_video_render_jobs_mp4_asset_fk
    foreign key (workspace_id, output_mp4_asset_id) references public.ad_video_assets(workspace_id, id) on delete cascade,
  add constraint ad_video_render_jobs_poster_asset_fk
    foreign key (workspace_id, output_poster_asset_id) references public.ad_video_assets(workspace_id, id) on delete cascade,
  add constraint ad_video_render_jobs_captions_asset_fk
    foreign key (workspace_id, output_captions_asset_id) references public.ad_video_assets(workspace_id, id) on delete cascade;

create index if not exists ad_video_render_jobs_queue_idx
  on public.ad_video_render_jobs (workspace_id, status, queued_at);

alter table public.ad_video_projects enable row level security;
alter table public.ad_video_assets enable row level security;
alter table public.ad_video_render_jobs enable row level security;

revoke all on table public.ad_video_projects, public.ad_video_assets, public.ad_video_render_jobs from public, anon;
grant select, insert, update, delete on table public.ad_video_projects, public.ad_video_assets, public.ad_video_render_jobs to authenticated;
grant all on table public.ad_video_projects, public.ad_video_assets, public.ad_video_render_jobs to service_role;

drop policy if exists ad_video_projects_workspace_select on public.ad_video_projects;
drop policy if exists ad_video_projects_workspace_insert on public.ad_video_projects;
drop policy if exists ad_video_projects_workspace_update on public.ad_video_projects;
drop policy if exists ad_video_projects_workspace_delete on public.ad_video_projects;
create policy ad_video_projects_workspace_select on public.ad_video_projects for select to authenticated using (private.adstudio_has_workspace_access(workspace_id));
create policy ad_video_projects_workspace_insert on public.ad_video_projects for insert to authenticated with check (private.adstudio_has_workspace_access(workspace_id));
create policy ad_video_projects_workspace_update on public.ad_video_projects for update to authenticated using (private.adstudio_has_workspace_access(workspace_id)) with check (private.adstudio_has_workspace_access(workspace_id));
create policy ad_video_projects_workspace_delete on public.ad_video_projects for delete to authenticated using (private.adstudio_has_workspace_access(workspace_id));

drop policy if exists ad_video_assets_workspace_select on public.ad_video_assets;
drop policy if exists ad_video_assets_workspace_insert on public.ad_video_assets;
drop policy if exists ad_video_assets_workspace_update on public.ad_video_assets;
drop policy if exists ad_video_assets_workspace_delete on public.ad_video_assets;
create policy ad_video_assets_workspace_select on public.ad_video_assets for select to authenticated using (private.adstudio_has_workspace_access(workspace_id));
create policy ad_video_assets_workspace_insert on public.ad_video_assets for insert to authenticated with check (private.adstudio_has_workspace_access(workspace_id));
create policy ad_video_assets_workspace_update on public.ad_video_assets for update to authenticated using (private.adstudio_has_workspace_access(workspace_id)) with check (private.adstudio_has_workspace_access(workspace_id));
create policy ad_video_assets_workspace_delete on public.ad_video_assets for delete to authenticated using (private.adstudio_has_workspace_access(workspace_id));

drop policy if exists ad_video_render_jobs_workspace_select on public.ad_video_render_jobs;
drop policy if exists ad_video_render_jobs_workspace_insert on public.ad_video_render_jobs;
drop policy if exists ad_video_render_jobs_workspace_update on public.ad_video_render_jobs;
drop policy if exists ad_video_render_jobs_workspace_delete on public.ad_video_render_jobs;
create policy ad_video_render_jobs_workspace_select on public.ad_video_render_jobs for select to authenticated using (private.adstudio_has_workspace_access(workspace_id));
create policy ad_video_render_jobs_workspace_insert on public.ad_video_render_jobs for insert to authenticated with check (private.adstudio_has_workspace_access(workspace_id));
create policy ad_video_render_jobs_workspace_update on public.ad_video_render_jobs for update to authenticated using (private.adstudio_has_workspace_access(workspace_id)) with check (private.adstudio_has_workspace_access(workspace_id));
create policy ad_video_render_jobs_workspace_delete on public.ad_video_render_jobs for delete to authenticated using (private.adstudio_has_workspace_access(workspace_id));

-- Storage is private. Access is mediated by signed URLs issued after the same
-- workspace checks used by the API and ledger.
drop policy if exists adstudio_videos_workspace_read on storage.objects;
drop policy if exists adstudio_videos_workspace_write on storage.objects;
create policy adstudio_videos_workspace_read on storage.objects for select to authenticated
  using (bucket_id = 'adstudio-videos' and private.adstudio_has_workspace_access((storage.foldername(name))[1]::uuid));
create policy adstudio_videos_workspace_write on storage.objects for insert to authenticated
  with check (bucket_id = 'adstudio-videos' and private.adstudio_has_workspace_access((storage.foldername(name))[1]::uuid));
