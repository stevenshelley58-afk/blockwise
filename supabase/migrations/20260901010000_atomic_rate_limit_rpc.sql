-- Atomic fixed-window rate limiting.
--
-- Replaces the read-then-write race in src/lib/rate-limit.ts: parallel
-- requests now increment-and-check in ONE statement (INSERT ... ON CONFLICT
-- DO UPDATE ... WHERE), so used_count can never overshoot limit_count.
--
-- Also tightens the rate_limits unique constraint to NULLS NOT DISTINCT so
-- IP-keyed rows (workspace_id IS NULL) are actually deduplicated — plain
-- UNIQUE treats NULLs as distinct, which silently disabled race protection
-- for anonymous limits.
--
-- SECURITY DEFINER so the check works for both service-role callers and
-- RLS-constrained authenticated clients (rate_limits policies deny client
-- writes by design). The function only touches public.rate_limits.
--
-- Rollback:
--   drop function public.consume_rate_limit(uuid, text, text, integer, integer);
--   alter table public.rate_limits drop constraint rate_limits_workspace_id_subject_key_bucket_key;
--   alter table public.rate_limits add constraint rate_limits_workspace_id_subject_key_bucket_key
--     unique (workspace_id, subject_key, bucket);
--   (then revert src/lib/rate-limit.ts to the previous non-atomic version)

alter table public.rate_limits
  drop constraint rate_limits_workspace_id_subject_key_bucket_key;

alter table public.rate_limits
  add constraint rate_limits_workspace_id_subject_key_bucket_key
  unique nulls not distinct (workspace_id, subject_key, bucket);

create or replace function public.consume_rate_limit(
  p_workspace_id uuid,
  p_subject_key text,
  p_bucket text,
  p_limit_count integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language sql
security definer
set search_path = public
as $$
  with window_bounds as (
    select
      to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)
        as window_start,
      to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)
        + make_interval(secs => p_window_seconds) as window_end
  ),
  upsert as (
    insert into public.rate_limits (workspace_id, subject_key, bucket, limit_count, used_count, resets_at)
    select p_workspace_id, p_subject_key, p_bucket, p_limit_count, 1, window_end
    from window_bounds
    on conflict (workspace_id, subject_key, bucket) do update
      set used_count = case
            when public.rate_limits.resets_at <= now() then 1
            else public.rate_limits.used_count + 1
          end,
          limit_count = excluded.limit_count,
          resets_at = case
            when public.rate_limits.resets_at <= now() then excluded.resets_at
            else public.rate_limits.resets_at
          end
    -- Only matches when the window has rolled over or budget remains; when
    -- the bucket is exhausted the UPDATE matches zero rows and nothing is
    -- returned, so the caller falls through to the rejection branch below.
    where public.rate_limits.resets_at <= now()
       or public.rate_limits.used_count < public.rate_limits.limit_count
    returning true as consumed
  )
  select true as allowed, 0::integer as retry_after_seconds
  from upsert
  union all
  select false as allowed,
         greatest(1, ceil(extract(epoch from (rl.resets_at - now())))::integer) as retry_after_seconds
  from public.rate_limits rl
  where rl.workspace_id is not distinct from p_workspace_id
    and rl.subject_key = p_subject_key
    and rl.bucket = p_bucket
    and rl.resets_at > now()
    and rl.used_count >= p_limit_count
    and not exists (select 1 from upsert)
  limit 1
$$;

revoke all on function public.consume_rate_limit(uuid, text, text, integer, integer) from public;
revoke all on function public.consume_rate_limit(uuid, text, text, integer, integer) from anon;
grant execute on function public.consume_rate_limit(uuid, text, text, integer, integer) to service_role;
grant execute on function public.consume_rate_limit(uuid, text, text, integer, integer) to authenticated;
