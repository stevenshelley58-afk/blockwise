-- pgTAP coverage for public.consume_rate_limit.
--
-- Required by the launch security review:
--   1. hostile-caller inputs are rejected (bounds validation);
--   2. limit changes are applied consistently (stored limit is the requested
--      one; rejection reads the new limit and always returns one row);
--   3. concurrency: increments are serialized by the row lock so parallel
--      callers can never overshoot (the two dblink sessions below exercise
--      the real cross-connection race).
--   4. execute privilege: authenticated/public roles are revoked.
--
-- Run by the "Database migration and pgTAP checks" CI job after migrations.

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

begin;
select plan(25);

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
select is(
  (select allowed from public.consume_rate_limit(null, ' 198.51.100.8 ', 'pgtap-normalization', 2, 60)),
  true,
  'subject keys are trimmed before storage'
);

select is(
  (select count(*) from public.rate_limits where subject_key = '198.51.100.8' and bucket = 'pgtap-normalization'),
  1::bigint,
  'whitespace does not split a subject bucket'
);
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

-- A real two-connection race against a fresh limit-1 bucket must allow one
-- request and reject the other. dblink_send_query starts both transactions
-- before either result is collected, so the unique-row lock is exercised.
select extensions.dblink_connect(
  'rate_concurrency_1',
  'host=' || host(inet_server_addr()) || ' port=5432 dbname=' || current_database()
    || ' user=' || current_user || ' password=' || current_user
);
select extensions.dblink_connect(
  'rate_concurrency_2',
  'host=' || host(inet_server_addr()) || ' port=5432 dbname=' || current_database()
    || ' user=' || current_user || ' password=' || current_user
);
select ok(
  extensions.dblink_send_query(
    'rate_concurrency_1',
    'select allowed from public.consume_rate_limit(null, ''203.0.113.77'', ''pgtap-concurrency'', 1, 60)'
  ) = 1,
  'first cross-connection rate-limit request sent'
);
select ok(
  extensions.dblink_send_query(
    'rate_concurrency_2',
    'select allowed from public.consume_rate_limit(null, ''203.0.113.77'', ''pgtap-concurrency'', 1, 60)'
  ) = 1,
  'second cross-connection rate-limit request sent'
);
select ok(
  (select allowed from extensions.dblink_get_result('rate_concurrency_1') as result(allowed boolean))
    is distinct from
  (select allowed from extensions.dblink_get_result('rate_concurrency_2') as result(allowed boolean)),
  'cross-connection requests allow exactly one winner'
);
select is(
  (select used_count from public.rate_limits where subject_key = '203.0.113.77' and bucket = 'pgtap-concurrency'),
  1::integer,
  'cross-connection requests never overshoot the limit'
);
select extensions.dblink_disconnect('rate_concurrency_1');
select extensions.dblink_disconnect('rate_concurrency_2');

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
