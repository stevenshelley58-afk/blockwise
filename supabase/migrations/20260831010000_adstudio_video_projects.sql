-- Durable short-video projects, immutable media refs, and render queue.
-- The application stores references and attestations only; video bytes stay in
-- the private Storage bucket and are never embedded in JSON or plans.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'adstudio-videos', 'adstudio-videos', false, 524288000,
  array['video/mp4', 'video/webm']::text[]
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
  unique (workspace_id, object_path),
  unique (workspace_id, sha256, mime_type),
  check ((validation_status = 'validated' and validated_at is not null) or validation_status <> 'validated'),
  check (object_path !~ '(^|/)\.\.(?:/|$)')
  ,foreign key (workspace_id, project_id) references public.ad_video_projects(workspace_id, id) on delete set null
);

create index if not exists ad_video_assets_workspace_project_idx
  on public.ad_video_assets (workspace_id, project_id, asset_role, created_at desc);

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
  output_mp4_asset_id uuid references public.ad_video_assets(id) on delete set null,
  output_poster_asset_id uuid references public.ad_video_assets(id) on delete set null,
  output_captions_asset_id uuid references public.ad_video_assets(id) on delete set null,
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
