create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(38);

insert into public.workspaces (id, name, mode, region)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Provider cost accounting test', 'self_serve', 'AU')
on conflict (id) do nothing;

create or replace function public._cost_test_reservation()
returns jsonb language sql immutable set search_path = '' as $$
  select '{
    "provider":"openrouter",
    "provider_type":"image_generation",
    "model":"google/gemini-2.5-flash-image",
    "model_profile":"image_draft",
    "model_profile_version_id":null,
    "pricing_snapshot_id":null,
    "pricing":{
      "inputUsdPerMillionTokens":0.3,
      "outputUsdPerMillionTokens":2.5,
      "imageUsdPerUnit":0.039,
      "currency":"USD",
      "inputTokenBasis":"per_million_tokens",
      "outputTokenBasis":"per_million_tokens",
      "imageBasis":"per_output_image",
      "source":"persisted",
      "snapshotId":null
    }
  }'::jsonb;
$$;

create or replace function public._cost_test_attempt()
returns jsonb language sql immutable set search_path = '' as $$
  select '{
    "attemptIndex":0,
    "provider":"openrouter",
    "providerType":"image_generation",
    "model":"google/gemini-2.5-flash-image",
    "modelProfile":"image_draft",
    "modelProfileVersionId":null,
    "pricingSnapshotId":null,
    "status":"completed",
    "requestSubmitted":true,
    "billingStatus":"estimated",
    "providerRequestId":"openrouter-request-1",
    "usage":{"inputTokens":1000,"outputTokens":2,"imageUnits":1,"complete":true},
    "pricing":{
      "inputUsdPerMillionTokens":0.3,
      "outputUsdPerMillionTokens":2.5,
      "imageUsdPerUnit":0.039,
      "currency":"USD",
      "inputTokenBasis":"per_million_tokens",
      "outputTokenBasis":"per_million_tokens",
      "imageBasis":"per_output_image",
      "source":"persisted",
      "snapshotId":null
    },
    "estimatedCostUsd":0.039305,
    "actualCostUsd":null
  }'::jsonb;
$$;

create or replace function public._cost_test_run(correlation text, preferred numeric default 0.039305)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'user_id', null,
    'correlation_id', correlation,
    'prompt_version_id', null,
    'task_type', 'adstudio.image',
    'model_profile', 'image_draft',
    'model_profile_version_id', null,
    'pricing_snapshot_id', null,
    'provider_name', 'openrouter',
    'provider_type', 'image_generation',
    'model_name', 'google/gemini-2.5-flash-image',
    'input_json', '{}'::jsonb,
    'output_json', '{}'::jsonb,
    'usage_json', '{"inputTokens":1000,"outputTokens":2,"imageUnits":1}'::jsonb,
    'estimated_cost_usd', 0.039305,
    'actual_cost_usd', null,
    'preferred_cost_usd', preferred,
    'billing_status', 'estimated',
    'status', 'completed',
    'error_json', null,
    'result_summary', 'image_generated',
    'completed_at', '2026-07-13T00:00:00Z'
  );
$$;

select has_table('public', 'adstudio_provider_run_attempts', 'normalized attempt table exists');
select has_table('public', 'adstudio_provider_attempt_outbox', 'pre-dispatch outbox exists');
select ok(
  not has_table_privilege('authenticated', 'public.adstudio_provider_attempt_outbox', 'SELECT'),
  'authenticated users cannot read the service-only outbox'
);
select ok(
  has_table_privilege('authenticated', 'public.adstudio_provider_run_attempts', 'SELECT'),
  'authenticated users can read normalized attempts through RLS'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.adstudio_reserve_provider_attempt(uuid,text,integer,text,jsonb)',
    'EXECUTE'
  ),
  'reservation RPC is service-role-only'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.adstudio_record_provider_run(uuid,text,text,jsonb,jsonb)',
    'EXECUTE'
  ),
  'finalization RPC is service-role-only'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.adstudio_mark_provider_attempt_submitted(uuid,text,integer)',
    'EXECUTE'
  ),
  'submission lifecycle RPC is service-role-only'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.adstudio_cancel_provider_attempt(uuid,text,integer,text)',
    'EXECUTE'
  ),
  'cancellation lifecycle RPC is service-role-only'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.adstudio_recover_provider_run(uuid,text,text,jsonb,timestamp with time zone)',
    'EXECUTE'
  ),
  'recovery RPC is service-role-only'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.adstudio_provider_run_attempts'::regclass),
  'attempt RLS is enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.adstudio_provider_attempt_outbox'::regclass),
  'outbox RLS is enabled'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('ai_runs', 'ai_usage_ledger', 'adstudio_provider_runs')
      and column_name in ('estimated_cost_usd', 'billing_status')
      and is_nullable <> 'NO'
  ),
  'historical classification columns are fully backfilled and non-null'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.adstudio_provider_run_attempts'::regclass
      and conname = 'adstudio_attempts_workspace_run_fk'
      and contype = 'f'
  ),
  'attempt lineage uses a workspace-composite foreign key'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.adstudio_provider_attempt_outbox'::regclass
      and conname = 'adstudio_outbox_workspace_run_fk'
      and contype = 'f'
  ),
  'outbox lineage uses a workspace-composite foreign key'
);

select is(
  (public.adstudio_reserve_provider_attempt(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'exclusive-claim', 0, 'reservation-hash', public._cost_test_reservation()
  )->>'acquired')::boolean,
  true,
  'first reservation caller acquires the dispatch claim'
);
select is(
  (public.adstudio_reserve_provider_attempt(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'exclusive-claim', 0, 'reservation-hash', public._cost_test_reservation()
  )->>'acquired')::boolean,
  false,
  'second reservation caller cannot dispatch the same attempt'
);
select is(
  public.adstudio_mark_provider_attempt_submitted(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'exclusive-claim', 0
  )->>'status',
  'submitted',
  'a durable submission marker precedes provider dispatch'
);

select public.adstudio_reserve_provider_attempt(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cancel-claim', 0, 'cancel-reservation', public._cost_test_reservation()
);
select is(
  public.adstudio_cancel_provider_attempt(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cancel-claim', 0, 'provider preflight failed'
  )->>'status',
  'cancelled',
  'a pre-dispatch failure durably cancels its reservation'
);

select public.adstudio_reserve_provider_attempt(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'concurrent-finalize', 0, 'concurrent-reservation', public._cost_test_reservation()
);
select public.adstudio_mark_provider_attempt_submitted(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'concurrent-finalize', 0
);

create or replace function public._cost_test_finalize_concurrent()
returns jsonb language sql security definer set search_path = '' as $$
  select public.adstudio_record_provider_run(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'concurrent-finalize',
    'concurrent-run-hash',
    public._cost_test_run('concurrent-finalize'),
    jsonb_build_array(public._cost_test_attempt())
  );
$$;

select extensions.dblink_connect(
  'cost_concurrency_1',
  'host=' || host(inet_server_addr()) || ' port=5432 dbname=' || current_database() || ' user=postgres password=postgres'
);
select extensions.dblink_connect(
  'cost_concurrency_2',
  'host=' || host(inet_server_addr()) || ' port=5432 dbname=' || current_database() || ' user=postgres password=postgres'
);
select ok(extensions.dblink_send_query('cost_concurrency_1', 'select public._cost_test_finalize_concurrent()') = 1, 'first concurrent finalizer sent');
select ok(extensions.dblink_send_query('cost_concurrency_2', 'select public._cost_test_finalize_concurrent()') = 1, 'second concurrent finalizer sent');
select * from extensions.dblink_get_result('cost_concurrency_1') as result(payload jsonb);
select * from extensions.dblink_get_result('cost_concurrency_2') as result(payload jsonb);
select extensions.dblink_disconnect('cost_concurrency_1');
select extensions.dblink_disconnect('cost_concurrency_2');

select is(
  (select count(*)::integer from public.adstudio_provider_runs
   where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and mutation_id = 'concurrent-finalize'),
  1,
  'concurrent finalizers create one provider run'
);
select is(
  (select count(*)::integer from public.ai_runs
   where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and correlation_id = 'concurrent-finalize'),
  1,
  'concurrent finalizers create one ai run'
);
select is(
  (select count(*)::integer from public.ai_usage_ledger
   where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and correlation_id = 'concurrent-finalize'),
  1,
  'concurrent finalizers create one ledger row'
);
select is(
  (select count(*)::integer from public.adstudio_provider_run_attempts attempts
   join public.adstudio_provider_runs runs on runs.id = attempts.provider_run_id
   where runs.workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and runs.mutation_id = 'concurrent-finalize'),
  1,
  'concurrent finalizers create one normalized attempt'
);
select is(
  (select status from public.adstudio_provider_attempt_outbox
   where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and mutation_id = 'concurrent-finalize' and attempt_index = 0),
  'closed',
  'atomic finalization closes the durable outbox reservation'
);

select public.adstudio_reserve_provider_attempt(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'invalid-aggregate', 0, 'invalid-reservation', public._cost_test_reservation()
);
select public.adstudio_mark_provider_attempt_submitted(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'invalid-aggregate', 0
);
select public.adstudio_record_provider_run(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'invalid-aggregate',
    'invalid-run-hash',
    public._cost_test_run('invalid-aggregate', 9.99),
    jsonb_build_array(public._cost_test_attempt())
  );
select is(
  (select estimated_cost_usd from public.adstudio_provider_runs
   where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and mutation_id = 'invalid-aggregate'),
  0.039305::numeric,
  'SQL derives the aggregate from normalized attempts instead of trusting p_run'
);

select public.adstudio_reserve_provider_attempt(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'invalid-identity', 0, 'identity-reservation', public._cost_test_reservation()
);
select public.adstudio_mark_provider_attempt_submitted(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'invalid-identity', 0
);
select throws_ok(
  $$select public.adstudio_record_provider_run(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'invalid-identity',
    'identity-run-hash',
    jsonb_set(public._cost_test_run('invalid-identity'), '{model_name}', '"untrusted-model"'),
    jsonb_build_array(public._cost_test_attempt())
  )$$,
  'P0001',
  'Provider run identity does not match normalized attempts',
  'top-level run identity cannot disagree with its normalized attempt'
);
select is(
  (select count(*)::integer from public.adstudio_provider_runs
   where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and mutation_id = 'invalid-identity'),
  0,
  'identity rejection rolls back every aggregate write'
);

select public.adstudio_reserve_provider_attempt(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'negative-accounting', 0, 'negative-reservation', public._cost_test_reservation()
);
select public.adstudio_mark_provider_attempt_submitted(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'negative-accounting', 0
);
select throws_ok(
  $$select public.adstudio_record_provider_run(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'negative-accounting',
    'negative-run-hash',
    public._cost_test_run('negative-accounting'),
    jsonb_build_array(jsonb_set(public._cost_test_attempt(), '{estimatedCostUsd}', '-0.01'))
  )$$,
  'P0001',
  'Provider attempt accounting is internally inconsistent',
  'negative attempt accounting is rejected'
);
select is(
  (select count(*)::integer from public.adstudio_provider_runs
   where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and mutation_id = 'negative-accounting'),
  0,
  'invalid accounting rolls back every aggregate write'
);

select public.adstudio_reserve_provider_attempt(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'missing-usage', 0, 'missing-usage-reservation', public._cost_test_reservation()
);
select public.adstudio_mark_provider_attempt_submitted(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'missing-usage', 0
);
select throws_ok(
  $$select public.adstudio_record_provider_run(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'missing-usage',
    'missing-usage-run-hash',
    public._cost_test_run('missing-usage'),
    jsonb_build_array(
      jsonb_set(
        jsonb_set(
          jsonb_set(public._cost_test_attempt(), '{usage}', '{"inputTokens":1}'::jsonb),
          '{billingStatus}', '"unreconciled"'
        ),
        '{estimatedCostUsd}', '0'
      )
    )
  )$$,
  'P0001',
  'Provider attempt accounting is internally inconsistent',
  'missing usage completeness is rejected instead of becoming a silent estimate'
);
select is(
  (select count(*)::integer from public.adstudio_provider_runs
   where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and mutation_id = 'missing-usage'),
  0,
  'missing usage rejection is atomic'
);

select throws_ok(
  $$select public.adstudio_reserve_provider_attempt(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'unknown-workspace', 0, 'unknown-reservation', public._cost_test_reservation()
  )$$,
  'P0001',
  'Unknown workspace',
  'reservations reject an unknown workspace'
);

select public.adstudio_reserve_provider_attempt(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'recover-submitted', 0, 'recover-reservation', public._cost_test_reservation()
);
select public.adstudio_mark_provider_attempt_submitted(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'recover-submitted', 0
);
select throws_ok(
  $$select public.adstudio_recover_provider_run(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'recover-submitted',
    'recover-run-hash',
    public._cost_test_run('recover-submitted'),
    now() - interval '1 day'
  )$$,
  'P0001',
  'Provider attempt is not stale enough to recover',
  'recovery cannot race a fresh submitted attempt'
);
select public.adstudio_recover_provider_run(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'recover-submitted',
  'recover-run-hash',
  public._cost_test_run('recover-submitted'),
  now()
);
select is(
  (select attempts.billing_status from public.adstudio_provider_run_attempts attempts
   join public.adstudio_provider_runs runs on runs.id = attempts.provider_run_id
   where runs.workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and runs.mutation_id = 'recover-submitted'),
  'unreconciled',
  'post-dispatch recovery materializes missing usage as unreconciled'
);
select is(
  (select request_submitted from public.adstudio_provider_run_attempts attempts
   join public.adstudio_provider_runs runs on runs.id = attempts.provider_run_id
   where runs.workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and runs.mutation_id = 'recover-submitted'),
  true,
  'post-dispatch recovery preserves the durable submitted provenance'
);
select is(
  (select status from public.adstudio_provider_attempt_outbox
   where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and mutation_id = 'recover-submitted'),
  'closed',
  'post-dispatch recovery closes the outbox exactly once'
);

set role authenticated;
select is(
  (select count(*)::integer from public.adstudio_provider_run_attempts
   where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0,
  'attempt RLS hides rows from an authenticated non-member'
);
reset role;

select * from finish();

drop function public._cost_test_finalize_concurrent();
drop function public._cost_test_run(text, numeric);
drop function public._cost_test_attempt();
drop function public._cost_test_reservation();
delete from public.workspaces where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
