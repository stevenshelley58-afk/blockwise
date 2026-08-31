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
-- SECURITY DEFINER but SERVICE-ROLE ONLY: authenticated callers are revoked.
-- The application invokes this RPC exclusively through the service-role
-- server client, so hostile callers cannot choose arbitrary workspace ids,
-- buckets or limits to poison other users' budget. All inputs are validated
-- and bounded inside the function (bucket name pattern, subject length,
-- limit 1..1000, window 1..86400s); violations raise, and the TypeScript
-- wrapper fails closed.
--
-- The rejection branch reads the row AFTER a failed increment, so the
-- requested limit (already stored by the upsert) is used consistently and
-- the function ALWAYS returns exactly one row.
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
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_used integer;
  v_retry_after integer;
begin
  -- Input validation: the service-role caller passes app-controlled values,
  -- but bounds here make the contract explicit and protect against bugs.
  if p_limit_count is null or p_limit_count < 1 or p_limit_count > 1000 then
    raise exception 'invalid_limit_count';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid_window_seconds';
  end if;
  if p_subject_key is null or length(btrim(p_subject_key)) = 0 or length(p_subject_key) > 200 then
    raise exception 'invalid_subject_key';
  end if;
  if p_bucket is null or p_bucket !~ '^[a-z0-9_-]{1,64}$' then
    raise exception 'invalid_bucket';
  end if;

  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_window_end := v_window_start + make_interval(secs => p_window_seconds);

  insert into public.rate_limits (workspace_id, subject_key, bucket, limit_count, used_count, resets_at)
  values (p_workspace_id, p_subject_key, p_bucket, p_limit_count, 1, v_window_end)
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
    -- Evaluated against the existing row: the window has rolled over, or the
    -- used budget is still below the NEW (requested) limit.
    where public.rate_limits.resets_at <= now()
       or public.rate_limits.used_count < excluded.limit_count
  returning used_count
  into v_used;

  if found then
    return query select true::boolean, 0::integer;
    return;
  end if;

  -- Rejected: report the actual window reset. The stored limit is now the
  -- requested one (set above by the conflict update), so this is consistent.
  select greatest(1, ceil(extract(epoch from (rl.resets_at - now())))::integer)
    into v_retry_after
  from public.rate_limits rl
  where rl.workspace_id is not distinct from p_workspace_id
    and rl.subject_key = btrim(p_subject_key)
    and rl.bucket = p_bucket;

  return query select false::boolean, coalesce(v_retry_after, p_window_seconds)::integer;
end;
$$;

revoke all on function public.consume_rate_limit(uuid, text, text, integer, integer) from public;
revoke all on function public.consume_rate_limit(uuid, text, text, integer, integer) from anon;
revoke all on function public.consume_rate_limit(uuid, text, text, integer, integer) from authenticated;
grant execute on function public.consume_rate_limit(uuid, text, text, integer, integer) to service_role;
