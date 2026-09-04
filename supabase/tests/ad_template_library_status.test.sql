create extension if not exists pgtap with schema extensions;

begin;

select plan(16);

select has_column('public', 'ad_templates', 'library_status', 'templates have a customer library status');
select has_column('public', 'ad_templates', 'library_review_run_id', 'review activation records the Hermes run');
select has_column('public', 'ad_templates', 'library_reviewed_at', 'review activation records its timestamp');
select col_not_null('public', 'ad_templates', 'library_status', 'library status is required');
select col_has_default('public', 'ad_templates', 'library_status', 'library status defaults safely');
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.ad_templates'::regclass
      and conname = 'ad_templates_library_status_check'
      and contype = 'c'
  ),
  'the active/quarantined constraint exists'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.ad_templates'::regclass
      and conname = 'ad_templates_active_review_check'
      and contype = 'c'
  ),
  'active templates require review evidence'
);
select has_function('public', 'activate_reviewed_ad_template', array['text', 'text'], 'reviewed templates have an activation function');
select has_function('public', 'quarantine_ad_template', array['text'], 'templates have a reversible quarantine function');
select ok(not has_function_privilege('authenticated', 'public.activate_reviewed_ad_template(text,text)', 'execute'), 'customers cannot activate templates');
select ok(has_function_privilege('service_role', 'public.activate_reviewed_ad_template(text,text)', 'execute'), 'service role can activate reviewed templates');

insert into public.ad_templates(template_id, template_json)
values (
  'library-status-pgtest',
  '{"schema":"blockwise.ad-template","templateId":"library-status-pgtest","assets":{}}'::jsonb
);

select is(
  (select library_status from public.ad_templates where template_id = 'library-status-pgtest'),
  'quarantined',
  'new templates default to quarantined'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  $$select * from public.activate_reviewed_ad_template('library-status-pgtest', 'trun_pgtest_001')$$,
  'a complete template activates with review evidence'
);
reset role;

select is(
  (select library_status || ':' || library_review_run_id from public.ad_templates where template_id = 'library-status-pgtest'),
  'active:trun_pgtest_001',
  'activation binds the visible template to its review run'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}', true);
select is(
  (select count(*)::integer from public.ad_templates where template_id = 'library-status-pgtest'),
  1,
  'authenticated customers can read an active template'
);
reset role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  $$select public.quarantine_ad_template('library-status-pgtest')$$,
  'an active template can be quarantined without deletion'
);
reset role;

select * from finish();

rollback;
