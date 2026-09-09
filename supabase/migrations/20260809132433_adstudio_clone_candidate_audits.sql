-- Keep privately scoped evidence for every paid clone candidate. Rejected ads
-- remain unavailable to campaigns, but operators can inspect the actual image
-- and its bound vision review instead of paying for blind retries.

create table if not exists public.adstudio_clone_candidate_audits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  correlation_id text not null,
  template_id text not null,
  format text not null check (format in ('4:5', '9:16')),
  attempt integer not null check (attempt between 1 and 20),
  request_hash text not null,
  candidate_image_path text not null,
  accepted boolean not null,
  review_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, correlation_id, format, attempt)
);

create index if not exists adstudio_clone_candidate_audits_run_idx
  on public.adstudio_clone_candidate_audits (workspace_id, correlation_id, format, attempt);

alter table public.adstudio_clone_candidate_audits enable row level security;

drop policy if exists adstudio_clone_candidate_audits_workspace_select
  on public.adstudio_clone_candidate_audits;
create policy adstudio_clone_candidate_audits_workspace_select
  on public.adstudio_clone_candidate_audits
  for select
  using (private.adstudio_has_workspace_access(workspace_id));

revoke all on public.adstudio_clone_candidate_audits from anon, authenticated;
grant select on public.adstudio_clone_candidate_audits to authenticated;
grant all on public.adstudio_clone_candidate_audits to service_role;
