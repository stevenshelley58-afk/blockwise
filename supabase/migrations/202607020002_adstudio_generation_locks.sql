-- Cross-instance dedup for campaign generation.
--
-- The in-flight Map in the campaigns POST route only dedupes within one
-- serverless instance; two concurrent identical requests landing on different
-- Vercel lambdas both ran full AI generations. This table makes the guard
-- global: primary-key insert wins, the loser sees the conflict and 409s.

create table if not exists public.adstudio_generation_locks (
  dedupe_key text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.adstudio_generation_locks enable row level security;

drop policy if exists adstudio_generation_locks_select on public.adstudio_generation_locks;
drop policy if exists adstudio_generation_locks_insert on public.adstudio_generation_locks;
drop policy if exists adstudio_generation_locks_update on public.adstudio_generation_locks;
drop policy if exists adstudio_generation_locks_delete on public.adstudio_generation_locks;

create policy adstudio_generation_locks_select on public.adstudio_generation_locks
  for select
  using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'member', 'operator']));

create policy adstudio_generation_locks_insert on public.adstudio_generation_locks
  for insert
  with check (private.has_workspace_role(workspace_id, array['owner', 'admin', 'member', 'operator']));

create policy adstudio_generation_locks_update on public.adstudio_generation_locks
  for update
  using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'member', 'operator']))
  with check (private.has_workspace_role(workspace_id, array['owner', 'admin', 'member', 'operator']));

create policy adstudio_generation_locks_delete on public.adstudio_generation_locks
  for delete
  using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'member', 'operator']));
