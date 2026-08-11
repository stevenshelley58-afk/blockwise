create extension if not exists pgtap with schema extensions;

begin;

select plan(18);

select has_function(
  'public',
  'adstudio_bind_publish_compliance',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'jsonb', 'timestamp with time zone'],
  'exact publish compliance binding RPC exists'
);
select ok(
  not has_function_privilege('public', 'public.adstudio_bind_publish_compliance(uuid,uuid,uuid,text,text,jsonb,timestamptz)', 'EXECUTE'),
  'PUBLIC cannot bind publish compliance'
);
select ok(
  not has_function_privilege('anon', 'public.adstudio_bind_publish_compliance(uuid,uuid,uuid,text,text,jsonb,timestamptz)', 'EXECUTE'),
  'anon cannot bind publish compliance'
);
select ok(
  not has_function_privilege('authenticated', 'public.adstudio_bind_publish_compliance(uuid,uuid,uuid,text,text,jsonb,timestamptz)', 'EXECUTE'),
  'authenticated cannot bind publish compliance'
);
select ok(
  has_function_privilege('service_role', 'public.adstudio_bind_publish_compliance(uuid,uuid,uuid,text,text,jsonb,timestamptz)', 'EXECUTE'),
  'service role can bind publish compliance'
);

insert into public.workspaces (id, name) values
  ('e1000000-0000-4000-8000-000000000001', 'Compliance Binding A'),
  ('e1000000-0000-4000-8000-000000000002', 'Compliance Binding B');
insert into public.adstudio_brand_kits (id, workspace_id, business_name) values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Binding A'),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'Binding B');
insert into public.adstudio_campaigns (id, workspace_id, brand_kit_id, name, goal, offer_id) values
  ('e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Binding A', 'seller_leads', 'binding-a'),
  ('e3000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002', 'Binding B', 'seller_leads', 'binding-b');
insert into public.adstudio_compliance_reports (id, workspace_id, campaign_id, status, issues_json) values
  ('e4000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'needs_review', '[]'::jsonb);

set local role authenticated;
select throws_ok(
  $$select public.adstudio_bind_publish_compliance(
    'e1000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', repeat('a',64), 'approved', '[]', now()
  )$$,
  '42501', null,
  'authenticated invocation is denied'
);

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select lives_ok(
  $$select public.adstudio_bind_publish_compliance(
    'e1000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', repeat('a',64), 'approved', '[{"code":"checked"}]', '2026-08-11T15:00:00Z'
  )$$,
  'service role binds the exact report'
);
select is(
  (select subject_hash from public.adstudio_compliance_reports where id = 'e4000000-0000-4000-8000-000000000001'),
  repeat('a',64),
  'subject hash is written'
);
select is(
  (select status from public.adstudio_compliance_reports where id = 'e4000000-0000-4000-8000-000000000001'),
  'approved',
  'review status is written'
);
select is(
  (select issues_json -> 0 ->> 'code' from public.adstudio_compliance_reports where id = 'e4000000-0000-4000-8000-000000000001'),
  'checked',
  'review issues are written'
);
select lives_ok(
  $$select public.adstudio_bind_publish_compliance(
    'e1000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', repeat('a',64), 'approved', '[{"code":"checked"}]', '2026-08-11T15:00:00Z'
  )$$,
  'repeating the exact binding is idempotent'
);
select throws_ok(
  $$select public.adstudio_bind_publish_compliance(
    'e1000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', repeat('b',64), 'blocked', '[]', now()
  )$$,
  '42501', 'Publish compliance report is outside the campaign workspace',
  'wrong workspace is denied'
);
select throws_ok(
  $$select public.adstudio_bind_publish_compliance(
    'e1000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002',
    'e4000000-0000-4000-8000-000000000001', repeat('b',64), 'blocked', '[]', now()
  )$$,
  '42501', 'Publish compliance report is outside the campaign workspace',
  'wrong campaign is denied'
);
select throws_ok(
  $$select public.adstudio_bind_publish_compliance(
    'e1000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000099', repeat('b',64), 'blocked', '[]', now()
  )$$,
  '42501', 'Publish compliance report is outside the campaign workspace',
  'wrong report is denied'
);
select throws_ok(
  $$select public.adstudio_bind_publish_compliance(
    'e1000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', null, 'approved', '[]', now()
  )$$,
  '22023', 'Publish compliance subject must be a SHA-256 hash',
  'NULL subject hash is rejected'
);
select throws_ok(
  $$select public.adstudio_bind_publish_compliance(
    'e1000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', repeat('b',63), 'approved', '[]', now()
  )$$,
  '22023', 'Publish compliance subject must be a SHA-256 hash',
  'invalid subject hash is rejected'
);
select throws_ok(
  $$select public.adstudio_bind_publish_compliance(
    'e1000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', repeat('b',64), 'passed', '[]', now()
  )$$,
  '22023', 'Invalid publish compliance status',
  'invalid status is rejected'
);
select is(
  (select subject_hash from public.adstudio_compliance_reports where id = 'e4000000-0000-4000-8000-000000000001'),
  repeat('a',64),
  'failed ownership and validation attempts do not mutate the bound report'
);

select * from finish();
rollback;
