-- Recovered verbatim from the production migration ledger (schema_migrations.statements).
-- Applied out-of-band to prod as version 20260620134000; restored to source control here.

-- Raise the research queue claim batch cap for controlled first-fill drains.
-- Hermes still controls the requested p_limit; this only removes the old
-- hard ceiling of 100 so an operator can temporarily run larger batches.

create or replace function research.claim_work_queue_jobs(
  p_worker_id text,
  p_queue_name text default null,
  p_job_types text[] default null,
  p_limit int default 1,
  p_claim_ttl_seconds int default 900
)
returns setof research.work_queue
language plpgsql
security definer
set search_path = research, public
as $$
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'p_worker_id is required';
  end if;

  return query
  with candidates as (
    select q.id
    from research.work_queue q
    where q.status = 'pending'
      and q.available_at <= now()
      and (p_queue_name is null or q.queue_name = p_queue_name)
      and (p_job_types is null or q.job_type = any(p_job_types))
    order by q.priority asc, q.available_at asc, q.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 1), 500))
  )
  update research.work_queue q
  set
    status = 'claimed',
    claimed_at = now(),
    claimed_by = p_worker_id,
    claim_token = gen_random_uuid(),
    claim_expires_at = now() + make_interval(secs => greatest(1, coalesce(p_claim_ttl_seconds, 900))),
    attempts = q.attempts + 1,
    updated_at = now()
  from candidates c
  where q.id = c.id
  returning q.*;
end;
$$;

revoke execute on function research.claim_work_queue_jobs(text, text, text[], int, int) from public;

grant execute on function research.claim_work_queue_jobs(text, text, text[], int, int) to service_role;
