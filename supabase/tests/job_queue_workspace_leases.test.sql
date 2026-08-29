create extension if not exists pgtap with schema extensions;

begin;
select plan(52);

insert into public.workspaces (id, name, mode, region)
values
  ('71111111-1111-4111-8111-111111111111', 'Queue lease test A', 'self_serve', 'AU'),
  ('72222222-2222-4222-8222-222222222222', 'Queue lease test B', 'self_serve', 'AU')
on conflict (id) do nothing;

insert into public.adstudio_brand_kits (
  id,
  workspace_id,
  business_name
)
values (
  '73333333-3333-4333-8333-333333333333',
  '71111111-1111-4111-8111-111111111111',
  'Queue lease test brand'
)
on conflict (id) do nothing;

insert into public.adstudio_campaigns (
  id,
  workspace_id,
  brand_kit_id,
  name,
  goal,
  offer_id
)
values (
  '74444444-4444-4444-8444-444444444444',
  '71111111-1111-4111-8111-111111111111',
  '73333333-3333-4333-8333-333333333333',
  'Queue lease test campaign',
  'seller_leads',
  'queue-lease-test'
)
on conflict (id) do nothing;

insert into public.provider_connections (
  id,
  workspace_id,
  provider,
  status,
  external_account_id
)
values (
  '75555555-5555-4555-8555-555555555555',
  '71111111-1111-4111-8111-111111111111',
  'meta',
  'connected',
  'act_queue_lease_test'
)
on conflict (id) do nothing;

insert into public.meta_publish_plans (
  id,
  workspace_id,
  adstudio_campaign_id,
  provider_connection_id,
  adapter,
  status,
  idempotency_key,
  meta_ad_account_id,
  page_id,
  privacy_policy_url,
  last_error
)
values
  (
    '76666666-6666-4666-8666-666666666666',
    '71111111-1111-4111-8111-111111111111',
    '74444444-4444-4444-8444-444444444444',
    '75555555-5555-4555-8555-555555555555',
    'marketing_api',
    'approved',
    'queue-lease-approved-plan',
    'act_queue_lease_test',
    'page_queue_lease_test',
    'https://example.com/privacy',
    'retryable provider timeout'
  ),
  (
    '77777777-7777-4777-8777-777777777777',
    '71111111-1111-4111-8111-111111111111',
    '74444444-4444-4444-8444-444444444444',
    '75555555-5555-4555-8555-555555555555',
    'marketing_api',
    'publishing',
    'queue-lease-publishing-plan',
    'act_queue_lease_test',
    'page_queue_lease_test',
    'https://example.com/privacy',
    null
  )
on conflict (id) do nothing;

select has_column(
  'public',
  'job_queue',
  'workspace_id',
  'queue rows carry authoritative workspace identity'
);
select col_not_null(
  'public',
  'job_queue',
  'workspace_id',
  'queue workspace identity is mandatory'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.job_queue'::regclass
      and conname = 'job_queue_workspace_id_fkey'
      and contype = 'f'
  ),
  'queue workspace identity references a real workspace'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.job_queue'::regclass),
  'queue RLS is enabled'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.job_queue'::regclass),
  'queue RLS is forced'
);

select ok(
  to_regprocedure('public.claim_job(text)') is null,
  'id-only legacy claim is removed after worker cutover'
);
select ok(
  to_regprocedure('public.complete_job(uuid)') is null,
  'id-only legacy completion is removed after worker cutover'
);
select ok(
  to_regprocedure('public.fail_job(uuid,text)') is null,
  'id-only legacy failure settlement is removed after worker cutover'
);
select ok(
  to_regprocedure(
    'public.enqueue_job(text,jsonb,integer,timestamp with time zone,text)'
  ) is null,
  'legacy producer RPC is removed after web and worker cutover'
);
select ok(
  to_regprocedure(
    'public.enqueue_job_v2(uuid,text,jsonb,integer,timestamp with time zone,text)'
  ) is not null,
  'workspace-explicit producer RPC is available'
);
select ok(
  to_regprocedure('public.cancel_job_v2(uuid,uuid)') is not null,
  'workspace-explicit pending-job cancellation RPC is available'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.claim_job_v2(text,integer)',
    'EXECUTE'
  ),
  'anon cannot claim jobs'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.fail_job_v2(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated users cannot settle jobs'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.cancel_job_v2(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated users cannot cancel queued jobs'
);
select ok(
  not has_table_privilege('anon', 'public.job_queue', 'SELECT'),
  'anon cannot read queue rows directly'
);

create temporary table queue_test_ids (
  name text primary key,
  id uuid not null
) on commit drop;

insert into queue_test_ids (name, id)
values (
  'complete',
  public.enqueue_job_v2(
    '71111111-1111-4111-8111-111111111111',
    'test.complete',
    '{}'::jsonb,
    2,
    now(),
    'queue-test-complete'
  )
);

select ok(
  (select id is not null from queue_test_ids where name = 'complete'),
  'workspace-explicit enqueue returns a UUID job id'
);
select ok(
  exists (
    select 1
    from public.job_queue as q
    join queue_test_ids as i on i.id = q.id and i.name = 'complete'
    where q.workspace_id = '71111111-1111-4111-8111-111111111111'
      and q.payload ->> 'workspaceId' = q.workspace_id::text
  ),
  'explicit enqueue stores matching relational and payload workspace identity'
);

select throws_ok(
  $$
    select public.enqueue_job_v2(
      '71111111-1111-4111-8111-111111111111',
      'test.mismatch',
      '{"workspaceId":"72222222-2222-4222-8222-222222222222"}'::jsonb,
      3,
      now(),
      null
    )
  $$,
  '22023',
  'enqueue_job_v2 workspace payload does not match p_workspace_id',
  'enqueue rejects conflicting workspace identities'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.enqueue_job_v2(uuid,text,jsonb,integer,timestamp with time zone,text)',
    'EXECUTE'
  ),
  'service role can call the unique workspace-explicit producer RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.cancel_job_v2(uuid,uuid)',
    'EXECUTE'
  ),
  'service role can cancel a pending job with an explicit workspace fence'
);

insert into queue_test_ids (name, id)
values (
  'cancel',
  public.enqueue_job_v2(
    '71111111-1111-4111-8111-111111111111',
    'test.cancel',
    '{}'::jsonb,
    2,
    now() + interval '1 hour',
    'queue-test-cancel'
  )
);
select is(
  public.cancel_job_v2(
    '72222222-2222-4222-8222-222222222222',
    (select id from queue_test_ids where name = 'cancel')
  ),
  false,
  'cancellation rejects the wrong workspace'
);
select ok(
  exists (
    select 1
    from public.job_queue
    where id = (select id from queue_test_ids where name = 'cancel')
      and status = 'pending'
  ),
  'wrong-workspace cancellation leaves the pending job untouched'
);
select is(
  public.cancel_job_v2(
    '71111111-1111-4111-8111-111111111111',
    (select id from queue_test_ids where name = 'cancel')
  ),
  true,
  'matching workspace cancellation settles a pending job'
);
select ok(
  exists (
    select 1
    from public.job_queue
    where id = (select id from queue_test_ids where name = 'cancel')
      and status = 'completed'
      and completed_at is not null
  ),
  'successful cancellation stores a completed terminal state'
);
select is(
  public.cancel_job_v2(
    '71111111-1111-4111-8111-111111111111',
    (select id from queue_test_ids where name = 'cancel')
  ),
  false,
  'a terminal job cannot be cancelled twice'
);

insert into queue_test_ids (name, id)
values
  (
    'scope-a',
    public.enqueue_job_v2(
      '71111111-1111-4111-8111-111111111111',
      'test.scoped-dedupe',
      '{}'::jsonb,
      2,
      now(),
      'same-dedupe-key'
    )
  ),
  (
    'scope-b',
    public.enqueue_job_v2(
      '72222222-2222-4222-8222-222222222222',
      'test.scoped-dedupe',
      '{}'::jsonb,
      2,
      now(),
      'same-dedupe-key'
    )
  );
select isnt(
  (select id from queue_test_ids where name = 'scope-a'),
  (select id from queue_test_ids where name = 'scope-b'),
  'dedupe keys cannot collide across workspaces'
);

create temporary table complete_claim
on commit drop
as select * from public.claim_job_v2('test.complete', 600);

select is(
  public.cancel_job_v2(
    '71111111-1111-4111-8111-111111111111',
    (select id from complete_claim)
  ),
  false,
  'a processing job can only be settled by its matching worker lease'
);

select is(
  (select workspace_id from complete_claim),
  '71111111-1111-4111-8111-111111111111'::uuid,
  'v2 claim returns the authoritative workspace'
);
select ok(
  (select lease_token is not null from complete_claim),
  'v2 claim returns a lease token'
);
select is(
  public.heartbeat_job(
    '72222222-2222-4222-8222-222222222222',
    (select id from complete_claim),
    (select lease_token from complete_claim),
    600
  ),
  false,
  'heartbeat rejects the wrong workspace'
);
select is(
  public.complete_job_v2(
    '71111111-1111-4111-8111-111111111111',
    (select id from complete_claim),
    gen_random_uuid()
  ),
  false,
  'completion rejects the wrong lease token'
);
select is(
  public.heartbeat_job(
    '71111111-1111-4111-8111-111111111111',
    (select id from complete_claim),
    (select lease_token from complete_claim),
    600
  ),
  true,
  'heartbeat renews a live matching lease'
);
select is(
  public.complete_job_v2(
    '71111111-1111-4111-8111-111111111111',
    (select id from complete_claim),
    (select lease_token from complete_claim)
  ),
  true,
  'completion settles a live matching lease'
);
select is(
  (
    select status
    from public.job_queue
    where id = (select id from complete_claim)
  ),
  'completed',
  'successful settlement stores completed status'
);

insert into queue_test_ids (name, id)
values (
  'terminal',
  public.enqueue_job_v2(
    '71111111-1111-4111-8111-111111111111',
    'test.terminal',
    '{}'::jsonb,
    1,
    now(),
    'queue-test-terminal'
  )
);
create temporary table terminal_claim
on commit drop
as select * from public.claim_job_v2('test.terminal', 600);

select is(
  public.fail_job_v2(
    (select workspace_id from terminal_claim),
    (select id from terminal_claim),
    (select lease_token from terminal_claim),
    'terminal test failure'
  ),
  'failed',
  'failure at max attempts becomes terminal'
);
select is(
  (
    select status
    from public.job_queue
    where id = (select id from terminal_claim)
  ),
  'failed',
  'terminal failure is persisted'
);
select is(
  public.fail_job_v2(
    (select workspace_id from terminal_claim),
    (select id from terminal_claim),
    (select lease_token from terminal_claim),
    'stale settlement must not win'
  ),
  null,
  'a stale lease cannot settle twice'
);

insert into queue_test_ids (name, id)
values (
  'retry',
  public.enqueue_job_v2(
    '71111111-1111-4111-8111-111111111111',
    'test.retry',
    '{}'::jsonb,
    2,
    now(),
    'queue-test-retry'
  )
);
create temporary table retry_claim
on commit drop
as select * from public.claim_job_v2('test.retry', 600);

select is(
  public.fail_job_v2(
    (select workspace_id from retry_claim),
    (select id from retry_claim),
    (select lease_token from retry_claim),
    'retry test failure'
  ),
  'pending',
  'failure with attempts remaining returns to pending'
);
select ok(
  exists (
    select 1
    from public.job_queue
    where id = (select id from retry_claim)
      and status = 'pending'
      and attempts = 1
      and last_error = 'retry test failure'
  ),
  'retry preserves attempt count and exact error'
);

insert into queue_test_ids (name, id)
values (
  'reaper',
  public.enqueue_job_v2(
    '71111111-1111-4111-8111-111111111111',
    'test.reaper',
    '{}'::jsonb,
    1,
    now(),
    'queue-test-reaper'
  )
);
create temporary table reaper_claim
on commit drop
as select * from public.claim_job_v2('test.reaper', 600);
update public.job_queue
set lease_expires_at = now() - interval '1 second'
where id = (select id from reaper_claim);

select is(
  public.reap_stale_jobs(600),
  1,
  'reaper processes the expired lease once'
);
select ok(
  exists (
    select 1
    from public.job_queue
    where id = (select id from reaper_claim)
      and status = 'failed'
      and attempts = max_attempts
      and last_error = 'Job lease expired before settlement.'
  ),
  'reaper fails an expired final attempt instead of requeueing forever'
);

insert into queue_test_ids (name, id)
values (
  'publish-retry',
  public.enqueue_job_v2(
    '71111111-1111-4111-8111-111111111111',
    'publish.meta.execute',
    jsonb_build_object(
      'workspaceId',
      '71111111-1111-4111-8111-111111111111',
      'planId',
      '76666666-6666-4666-8666-666666666666'
    ),
    2,
    now(),
    'queue-test-publish-retry'
  )
);
create temporary table publish_retry_claim_one
on commit drop
as select * from public.claim_job_v2('publish.meta.execute', 600);

select is(
  public.fail_job_v2(
    (select workspace_id from publish_retry_claim_one),
    (select id from publish_retry_claim_one),
    (select lease_token from publish_retry_claim_one),
    'retryable provider timeout'
  ),
  'pending',
  'a retryable publish failure returns its queue job to pending'
);
select ok(
  exists (
    select 1
    from public.meta_publish_plans
    where id = '76666666-6666-4666-8666-666666666666'
      and workspace_id = '71111111-1111-4111-8111-111111111111'
      and status = 'approved'
      and last_error = 'retryable provider timeout'
  ),
  'a retryable publish failure leaves the plan approved with its exact error'
);

update public.job_queue
set run_after = now()
where id = (select id from publish_retry_claim_one);
create temporary table publish_retry_claim_two
on commit drop
as select * from public.claim_job_v2('publish.meta.execute', 600);

select is(
  public.fail_job_v2(
    (select workspace_id from publish_retry_claim_two),
    (select id from publish_retry_claim_two),
    (select lease_token from publish_retry_claim_two),
    'terminal provider timeout'
  ),
  'failed',
  'the final publish attempt becomes terminal'
);
select ok(
  exists (
    select 1
    from public.job_queue
    where id = (select id from publish_retry_claim_two)
      and status = 'failed'
      and last_error = 'terminal provider timeout'
  ),
  'the terminal publish queue row keeps the exact final error'
);
select ok(
  exists (
    select 1
    from public.meta_publish_plans
    where id = '76666666-6666-4666-8666-666666666666'
      and workspace_id = '71111111-1111-4111-8111-111111111111'
      and status = 'failed'
      and last_error = 'terminal provider timeout'
  ),
  'terminal failure moves an approved plan to failed with the exact error'
);

insert into queue_test_ids (name, id)
values (
  'publish-ambiguous-terminal',
  public.enqueue_job_v2(
    '71111111-1111-4111-8111-111111111111',
    'publish.meta.execute',
    jsonb_build_object(
      'workspaceId',
      '71111111-1111-4111-8111-111111111111',
      'planId',
      '77777777-7777-4777-8777-777777777777'
    ),
    1,
    now(),
    'queue-test-publish-ambiguous-terminal'
  )
);
create temporary table publish_ambiguous_terminal_claim
on commit drop
as select * from public.claim_job_v2('publish.meta.execute', 600);

select is(
  public.fail_job_v2(
    (select workspace_id from publish_ambiguous_terminal_claim),
    (select id from publish_ambiguous_terminal_claim),
    (select lease_token from publish_ambiguous_terminal_claim),
    'ambiguous terminal provider outcome'
  ),
  'failed',
  'an ambiguous publish queue job still exhausts its retry budget'
);
select ok(
  exists (
    select 1
    from public.meta_publish_plans
    where id = '77777777-7777-4777-8777-777777777777'
      and workspace_id = '71111111-1111-4111-8111-111111111111'
      and status = 'publishing'
      and last_error = 'ambiguous terminal provider outcome'
  ),
  'terminal failure preserves publishing reconciliation state and its exact error'
);

insert into queue_test_ids (name, id)
values (
  'publish-ambiguous-reaper',
  public.enqueue_job_v2(
    '71111111-1111-4111-8111-111111111111',
    'publish.meta.execute',
    jsonb_build_object(
      'workspaceId',
      '71111111-1111-4111-8111-111111111111',
      'planId',
      '77777777-7777-4777-8777-777777777777'
    ),
    1,
    now(),
    'queue-test-publish-ambiguous-reaper'
  )
);
create temporary table publish_ambiguous_reaper_claim
on commit drop
as select * from public.claim_job_v2('publish.meta.execute', 600);
update public.job_queue
set lease_expires_at = now() - interval '1 second'
where id = (select id from publish_ambiguous_reaper_claim);

select is(
  public.reap_stale_jobs(600),
  1,
  'the reaper terminalizes an expired ambiguous publish lease'
);
select ok(
  exists (
    select 1
    from public.meta_publish_plans
    where id = '77777777-7777-4777-8777-777777777777'
      and workspace_id = '71111111-1111-4111-8111-111111111111'
      and status = 'failed'
      and last_error = 'Job lease expired before settlement.'
  ),
  'reaping closes an exhausted publish plan and records the lease error'
);

insert into queue_test_ids (name, id)
values (
  'pending-exhausted',
  public.enqueue_job_v2(
    '71111111-1111-4111-8111-111111111111',
    'test.pending-exhausted',
    '{}'::jsonb,
    1,
    now(),
    'queue-test-pending-exhausted'
  )
);
update public.job_queue
set attempts = max_attempts
where id = (select id from queue_test_ids where name = 'pending-exhausted');

select is(
  public.reap_stale_jobs(600),
  1,
  'the reaper sweeps a pending job whose retry budget is already exhausted'
);
select ok(
  exists (
    select 1
    from public.job_queue
    where id = (select id from queue_test_ids where name = 'pending-exhausted')
      and status = 'failed'
      and nullif(last_error, '') is not null
  ),
  'an exhausted pending job cannot remain permanently unclaimable'
);

select * from finish();
rollback;
