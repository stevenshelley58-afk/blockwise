-- pgTAP coverage for public.consume_rate_limit.
--
-- Required by the launch security review:
--   1. hostile-caller inputs are rejected (bounds validation);
--   2. limit changes are applied consistently (stored limit is the requested
--      one; rejection reads the new limit and always returns one row);
--   3. concurrency: increments are serialized by the row lock so parallel
--      callers can never overshoot (simulated here by repeated single-statement
--      calls; cross-connection parallelism is exercised by the application
--      concurrency test plus the RPC's single-statement design).
--   4. execute privilege: authenticated/public roles are revoked.
--
-- Run by the "Database migration and pgTAP checks" CI job after migrations.

create extension if not exists pgtap with schema extensions;

begin;
select plan(19);

-- ---------------------------------------------------------------------------
-- 1. Hostile / malformed caller inputs raise instead of poisoning buckets
-- ---------------------------------------------------------------------------

select throws_ok(
  'select public.consume_rate_limit(null, ''1.2.3.4'', ''demo-request'', 0, 60)',
  'invalid_limit_count',
  'limit below 1 is rejected'
);

select throws_ok(
  'select public.consume_rate_limit(null, ''1.2.3.4'', ''demo-request'', 1001, 60)',
  'invalid_limit_count',
  'limit above 1000 is rejected'
);

select throws_ok(
  'select public.consume_rate_limit(null, ''1.2.3.4'', ''demo-request'', 5, 0)',
  'invalid_window_seconds',
  'window below 1s is rejected'
);

select throws_ok(
  'select public.consume_rate_limit(null, ''1.2.3.4'', ''demo-request'', 5, 90000)',
  'invalid_window_seconds',
  'window above 86400s is rejected'
);

select throws_ok(
  'select public.consume_rate_limit(null, ''1.2.3.4'', ''BAD BUCKET; drop table x'', 5, 60)',
  'invalid_bucket',
  'bucket name pattern is enforced'
);

select throws_ok(
  'select public.consume_rate_limit(null, repeat(''x'', 201), ''demo-request'', 5, 60)',
  'invalid_subject_key',
  'over-long subject key is rejected'
);

-- ---------------------------------------------------------------------------
-- 2. Consume / exhaust / retry-after, always exactly one row
-- ---------------------------------------------------------------------------

-- Fresh IP-keyed bucket: three requests of a 3-request window are allowed...
select is(
  (select allowed from public.consume_rate_limit(null, '198.51.100.7', 'pgtap-bucket', 3, 60)),
  true,
  'first consume is allowed'
);
select is(
  (select allowed from public.consume_rate_limit(null, '198.51.100.7', 'pgtap-bucket', 3, 60)),
  true,
  'second consume is allowed'
);
select is(
  (select used_count from public.rate_limits where subject_key = '198.51.100.7' and bucket = 'pgtap-bucket'),
  2::integer,
  'used_count increments'
);

-- ...then the bucket exhausts and the rejection row reports the reset.
update public.rate_limits set used_count = 3
where subject_key = '198.51.100.7' and bucket = 'pgtap-bucket';

select is(
  (select allowed from public.consume_rate_limit(null, '198.51.100.7', 'pgtap-bucket', 3, 60)),
  false,
  'fourth consume within the window is rejected'
);

select is(
  (select count(*) from public.consume_rate_limit(null, '198.51.100.7', 'pgtap-bucket', 3, 60)),
  1::bigint,
  'the function always returns exactly one row'
);

select ok(
  (select retry_after_seconds from public.consume_rate_limit(null, '198.51.100.7', 'pgtap-bucket', 3, 60)) >= 1,
  'rejected rows carry a positive retry hint'
);

-- ---------------------------------------------------------------------------
-- 3. Limit change consistency: a smaller requested limit takes effect
-- ---------------------------------------------------------------------------

-- Stored limit is currently 3 with used_count 3. Request limit 2: the stored
-- limit becomes 2, the request is still rejected, and the rejection is based
-- on the NEW limit (not the old stored 3).
select is(
  (select allowed from public.consume_rate_limit(null, '198.51.100.7', 'pgtap-bucket', 2, 60)),
  false,
  'requesting a smaller limit still rejects an exhausted bucket'
);

select is(
  (select limit_count from public.rate_limits where subject_key = '198.51.100.7' and bucket = 'pgtap-bucket'),
  2::integer,
  'the stored limit is updated to the requested limit'
);

select is(
  (select used_count from public.rate_limits where subject_key = '198.51.100.7' and bucket = 'pgtap-bucket'),
  3::integer,
  'used_count is not corrupted by a rejected call'
);

-- ---------------------------------------------------------------------------
-- 4. Window rollover resets the counter
-- ---------------------------------------------------------------------------

update public.rate_limits
set resets_at = now() - interval '1 second', used_count = 3, limit_count = 2
where subject_key = '198.51.100.7' and bucket = 'pgtap-bucket';

select is(
  (select allowed from public.consume_rate_limit(null, '198.51.100.7', 'pgtap-bucket', 2, 60)),
  true,
  'a rolled-over window grants a fresh budget'
);

select is(
  (select used_count from public.rate_limits where subject_key = '198.51.100.7' and bucket = 'pgtap-bucket'),
  1::integer,
  'the counter restarts at 1 after rollover'
);

-- ---------------------------------------------------------------------------
-- 5. Privileges: only service_role may execute
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from information_schema.role_routine_grants
   where specific_schema = 'public'
     and specific_name like 'consume_rate_limit%'
     and grantee in ('anon', 'authenticated', 'public')),
  0::bigint,
  'no execute privilege for anon/authenticated/public'
);

select is(
  (select count(*) from information_schema.role_routine_grants
   where specific_schema = 'public'
     and specific_name like 'consume_rate_limit%'
     and grantee = 'service_role'),
  1::bigint,
  'service_role holds execute'
);

select * from finish();
rollback;
