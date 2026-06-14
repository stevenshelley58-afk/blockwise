-- Background queue for high-quality ad-creative generation. The Vercel app
-- enqueues a job; a worker (VPS/Hermes) claims it, generates the image with no
-- request timeout, uploads it, and marks the row done. Workspace-scoped; RLS on,
-- access is service-role only (the app routes filter by workspace_id explicitly).
create table if not exists public.adstudio_creative_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  created_by uuid,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  template_key text,
  image_path text,
  headline text not null,
  primary_text text,
  cta text,
  aspect_ratio text not null default '4:5',
  brand jsonb not null default '{}'::jsonb,
  result_path text,
  model text,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists adstudio_creative_jobs_queue_idx
  on public.adstudio_creative_jobs (status, created_at);
create index if not exists adstudio_creative_jobs_workspace_idx
  on public.adstudio_creative_jobs (workspace_id, created_at desc);

alter table public.adstudio_creative_jobs enable row level security;
