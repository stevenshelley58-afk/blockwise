create extension if not exists pgtap with schema extensions;

begin;
select plan(21);

select has_table('public', 'adstudio_template_factory_clone_requests', 'factory clone ledger exists');
select has_table('public', 'adstudio_template_factory_candidates', 'factory candidate staging exists');
select has_table('public', 'adstudio_template_factory_releases', 'factory release staging exists');
select has_table('public', 'adstudio_template_factory_receipts', 'one-use result receipts exist');
select ok((select not public from storage.buckets where id = 'adstudio-template-factory'), 'factory storage bucket is private');
select ok((select relrowsecurity from pg_class where oid = 'public.adstudio_template_factory_clone_requests'::regclass), 'clone ledger RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.adstudio_template_factory_candidates'::regclass), 'candidate RLS is enabled');
select ok(not has_table_privilege('authenticated', 'public.adstudio_template_factory_candidates', 'SELECT'), 'authenticated cannot read staged candidates');
select ok(not has_table_privilege('authenticated', 'public.adstudio_template_factory_releases', 'SELECT'), 'authenticated cannot read approved release bundles');
select ok(not has_function_privilege('authenticated', 'public.begin_adstudio_template_factory_clone(text,text,text,text)', 'EXECUTE'), 'authenticated cannot begin factory clones');
select ok(not has_function_privilege('authenticated', 'public.consume_adstudio_template_factory_receipt(text,uuid)', 'EXECUTE'), 'authenticated cannot consume factory receipts');

select set_config('request.jwt.claim.role', 'service_role', true);

select results_eq(
  $$select disposition from public.begin_adstudio_template_factory_clone('cell-a','job-a','request-a',repeat('a',64))$$,
  array['start'::text],
  'first immutable clone intent starts exactly once'
);
select results_eq(
  $$select disposition from public.begin_adstudio_template_factory_clone('cell-a','job-a','request-a',repeat('a',64))$$,
  array['replay'::text],
  'same running clone intent replays without redispatch'
);
select results_eq(
  $$select disposition from public.begin_adstudio_template_factory_clone('cell-a','job-a','request-a',repeat('b',64))$$,
  array['intent_conflict'::text],
  'changed immutable intent is rejected'
);
select results_eq(
  $$select disposition from public.begin_adstudio_template_factory_clone('cell-b','job-a','request-a',repeat('b',64))$$,
  array['start'::text],
  'a separate configured factory cell has an isolated ledger'
);

select is(
  public.claim_adstudio_template_factory_pulls('cell-a','job-a','request-a',array[repeat('c',64)]),
  true,
  'one-use Frank pull can be claimed once'
);
select is(
  public.claim_adstudio_template_factory_pulls('cell-b','job-a','request-a',array[repeat('c',64)]),
  false,
  'pull fingerprint cannot be replayed through another cell'
);

insert into public.adstudio_template_factory_candidates (
  id, factory_cell_id, factory_job_id, request_id, request_hash, template_id,
  source_hash, sample_hash, safe_text_hash, clone_request_hash, qa_hash, evidence_hash,
  storage_path, evidence_json, qa_json, attempts_json, expires_at
) values (
  '11111111-1111-4111-8111-111111111111', 'cell-a', 'job-a', 'request-a', repeat('a',64), 'meta-factory-001',
  repeat('d',64), repeat('e',64), repeat('f',64), repeat('1',64), repeat('2',64), repeat('3',64),
  'template-factory/aaaaaaaaaaaaaaaaaaaaaaaa/candidates/11111111-1111-4111-8111-111111111111.png',
  '{}'::jsonb, '{"passed":true,"failures":[]}'::jsonb, '[]'::jsonb, now() + interval '7 days'
);

select throws_ok(
  $$insert into public.adstudio_template_factory_releases (
      id,candidate_id,factory_cell_id,factory_job_id,request_id,request_hash,manifest_hash,attestation_hash,sample_hash,bundle_hash,storage_path
    ) values (
      '22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','cell-b','job-a','export-b',repeat('4',64),repeat('5',64),repeat('6',64),repeat('e',64),repeat('7',64),
      'template-factory/bbbbbbbbbbbbbbbbbbbbbbbb/releases/22222222-2222-4222-8222-222222222222.json'
    )$$,
  '23503',
  null,
  'cross-cell release cannot reference another cell candidate'
);

insert into public.adstudio_template_factory_receipts (
  id,factory_cell_id,factory_job_id,request_id,kind,candidate_id,storage_path,content_hash,expires_at
) values (
  '33333333-3333-4333-8333-333333333333','cell-a','job-a','request-a','candidate_png','11111111-1111-4111-8111-111111111111',
  'template-factory/aaaaaaaaaaaaaaaaaaaaaaaa/candidates/11111111-1111-4111-8111-111111111111.png',repeat('e',64),now() + interval '5 minutes'
);

select is_empty(
  $$select candidate_id from public.consume_adstudio_template_factory_receipt('cell-b','33333333-3333-4333-8333-333333333333')$$,
  'wrong cell cannot consume a candidate receipt'
);
select results_eq(
  $$select candidate_id from public.consume_adstudio_template_factory_receipt('cell-a','33333333-3333-4333-8333-333333333333')$$,
  array['11111111-1111-4111-8111-111111111111'::uuid],
  'owning cell consumes the exact receipt'
);
select is_empty(
  $$select candidate_id from public.consume_adstudio_template_factory_receipt('cell-a','33333333-3333-4333-8333-333333333333')$$,
  'candidate receipt cannot be consumed twice'
);

select * from finish();
rollback;
