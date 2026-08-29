-- Job queue backing the VPS background worker that replaces Trigger.dev.
--
-- Trigger.dev strands in-flight provider jobs whenever Vercel/Trigger
-- redeploys: a killed run holds the per-plan concurrency lock (limit 1) and
-- every later trigger queues behind the ghost forever. A Supabase-backed queue
-- consumed by a worker on the VPS removes that failure class: a deploy never
-- touches the worker, and a job whose lease expires self-heals back to pending
-- via reap_stale_jobs instead of blocking its slot permanently.
--
-- The queue is service-role only (like private.provider_token_vault's RPCs):
-- execute is revoked from public/anon/authenticated and granted to
-- service_role, so no PostgREST client can enqueue or claim jobs.

create table if not exists public.job_queue (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_queue_claim_idx
  on public.job_queue (run_after, created_at)
  where status = 'pending';

create index if not exists job_queue_status_idx
  on public.job_queue (status, claimed_at);

-- A pending job with the same dedupe_key is reused instead of inserting a
-- duplicate (e.g. the 5-minute watchdog re-enqueueing a plan that is already
-- queued). Null dedupe_key never collides.
create unique index if not exists job_queue_dedupe_idx
  on public.job_queue (kind, dedupe_key)
  where status in ('pending', 'processing') and dedupe_key is not null;

-- Enqueue a job. Returns the job id. If a pending/processing job with the same
-- (kind, dedupe_key) already exists, its id is returned and nothing is inserted.
create or replace function public.enqueue_job(
  p_kind text,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts int default 3,
  p_run_after timestamptz default now(),
  p_dedupe_key text default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.job_queue (kind, payload, max_attempts, run_after, dedupe_key)
  values (p_kind, p_payload, p_max_attempts, p_run_after, p_dedupe_key)
  on conflict (kind, dedupe_key)
    where status in ('pending', 'processing') and dedupe_key is not null
    do update set updated_at = now()
  returning id;
$$;

-- Atomically claim the next due pending job for a worker. Uses FOR UPDATE SKIP
-- LOCKED so concurrent workers never grab the same row. Bumps attempts here so
-- a crash between claim and completion still counts against max_attempts (the
-- reaper returns the row to pending, but the attempt is not refunded).
create or replace function public.claim_job(
  p_kind text default null
)
returns table (
  id uuid,
  kind text,
  payload jsonb,
  attempts int,
  max_attempts int
)
language sql
security definer
set search_path = ''
as $$
  update public.job_queue as j
  set status = 'processing',
      claimed_at = now(),
      attempts = j.attempts + 1,
      updated_at = now()
  where j.id = (
    select q.id
    from public.job_queue as q
    where q.status = 'pending'
      and q.run_after <= now()
      and (p_kind is null or q.kind = p_kind)
    order by q.run_after asc, q.created_at asc
    for update skip locked
    limit 1
  )
  returning j.id, j.kind, j.payload, j.attempts, j.max_attempts;
$$;

-- Mark a job completed.
create or replace function public.complete_job(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.job_queue
  set status = 'completed',
      completed_at = now(),
      last_error = null,
      updated_at = now()
  where id = p_id;
$$;

-- Record a failure. If the job has attempts remaining, return it to pending
-- with exponential backoff (2^attempts seconds, capped at 10 minutes) so it is
-- retried later. Otherwise mark it failed for operator review.
create or replace function public.fail_job(p_id uuid, p_error text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts int;
  v_max_attempts int;
  v_backoff interval;
begin
  select attempts, max_attempts into v_attempts, v_max_attempts
  from public.job_queue where id = p_id;

  if not found then
    return 'missing';
  end if;

  if v_attempts >= v_max_attempts then
    update public.job_queue
    set status = 'failed', last_error = p_error, updated_at = now()
    where id = p_id;
    return 'failed';
  end if;

  v_backoff := least(power(2, v_attempts) * interval '1 second', interval '10 minutes');
  update public.job_queue
  set status = 'pending',
      claimed_at = null,
      last_error = p_error,
      run_after = now() + v_backoff,
      updated_at = now()
  where id = p_id;
  return 'retrying';
end;
$$;

-- Reaper: any job stuck in 'processing' past its lease is assumed to belong to
-- a dead worker (deploy, crash, OOM) and is returned to pending. This is the
-- mechanism that makes a killed run self-heal instead of holding its slot
-- forever — the exact failure Trigger.dev could not recover from.
create or replace function public.reap_stale_jobs(p_lease_seconds int default 600)
returns int
language sql
security definer
set search_path = ''
as $$
  with stale as (
    update public.job_queue
    set status = 'pending',
        claimed_at = null,
        updated_at = now()
    where status = 'processing'
      and claimed_at < now() - make_interval(secs => p_lease_seconds)
    returning id
  )
  select count(*)::int from stale;
$$;

-- Lock the queue down: only service_role may touch it. Mirrors the
-- provider_token_vault RPC posture.
revoke execute on function public.enqueue_job(text, jsonb, int, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.claim_job(text) from public, anon, authenticated;
revoke execute on function public.complete_job(uuid) from public, anon, authenticated;
revoke execute on function public.fail_job(uuid, text) from public, anon, authenticated;
revoke execute on function public.reap_stale_jobs(int) from public, anon, authenticated;

grant execute on function public.enqueue_job(text, jsonb, int, timestamptz, text) to service_role;
grant execute on function public.claim_job(text) to service_role;
grant execute on function public.complete_job(uuid) to service_role;
grant execute on function public.fail_job(uuid, text) to service_role;
grant execute on function public.reap_stale_jobs(int) to service_role;

alter table public.job_queue enable row level security;

comment on table public.job_queue is
  'Background job queue consumed by the VPS worker (Trigger.dev replacement). Service-role only.';
