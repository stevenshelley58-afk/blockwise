-- A queued/running Ad Builder job owns its cross-instance generation lock until
-- terminal settlement. The old timestamp-only lease became unsafe once final-
-- quality generation moved to the VPS and could legitimately exceed 15m.

alter table public.adbuilder_generation_locks
  add column if not exists job_id uuid references public.adbuilder_creative_jobs (id) on delete set null;

create index if not exists adbuilder_generation_locks_job_idx
  on public.adbuilder_generation_locks (workspace_id, job_id)
  where job_id is not null;
