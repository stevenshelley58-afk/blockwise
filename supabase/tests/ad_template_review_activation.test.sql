create extension if not exists pgtap with schema extensions;

begin;

select plan(18);

select has_function(
  'public',
  'activate_reviewed_ad_template',
  array['text', 'text'],
  'reviewed templates have an explicit activation function'
);
select has_function(
  'public',
  'quarantine_ad_template',
  array['text'],
  'active templates have a reversible quarantine function'
);

insert into public.ad_templates(template_id, template_json)
values (
  'review-activation-good',
  '{"schema":"blockwise.ad-template","templateId":"review-activation-good","assets":{"hero":{"fileName":"hero.png","mimeType":"image/png"}}}'::jsonb
), (
  'review-activation-incomplete',
  '{"schema":"blockwise.ad-template","templateId":"review-activation-incomplete","assets":{"hero":{"fileName":"hero.png","mimeType":"image/png"}}}'::jsonb
);

insert into public.ad_template_assets_direct(template_id, asset_key, file_name, mime_type, storage_path)
values (
  'review-activation-good',
  'hero',
  'hero.png',
  'image/png',
  'templates/review-activation-good/hero-hero.png'
);

select is(
  (select library_status from public.ad_templates where template_id = 'review-activation-good'),
  'quarantined',
  'a newly finalized template is hidden by default'
);
select ok(
  not has_function_privilege('authenticated', 'public.activate_reviewed_ad_template(text,text)', 'execute'),
  'authenticated customers cannot activate a template'
);
select ok(
  not has_function_privilege('authenticated', 'public.quarantine_ad_template(text)', 'execute'),
  'authenticated customers cannot change library status'
);
select ok(
  has_function_privilege('service_role', 'public.activate_reviewed_ad_template(text,text)', 'execute'),
  'service role can activate a verified template'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_like(
  $$select * from public.activate_reviewed_ad_template('review-activation-incomplete', 'trun_complete_001')$$,
  '%reviewed_template_assets_incomplete%',
  'activation rejects an incomplete declared asset set'
);
select throws_like(
  $$select * from public.activate_reviewed_ad_template('review-activation-good', 'bad run id')$$,
  '%reviewed_template_activation_invalid%',
  'activation rejects an invalid review-run identifier'
);
select lives_ok(
  $$select * from public.activate_reviewed_ad_template('review-activation-good', 'trun_complete_001')$$,
  'a complete template can be activated with corrected review evidence'
);

reset role;

select is(
  (select library_status from public.ad_templates where template_id = 'review-activation-good'),
  'active',
  'activation exposes the reviewed template'
);
select is(
  (select library_review_run_id from public.ad_templates where template_id = 'review-activation-good'),
  'trun_complete_001',
  'activation binds the customer entry to its Hermes run'
);
select ok(
  (select library_reviewed_at is not null from public.ad_templates where template_id = 'review-activation-good'),
  'activation records its timestamp'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}', true);
select is(
  (select count(*)::integer from public.ad_templates where template_id like 'review-activation-%'),
  1,
  'customers see the reviewed entry but not the incomplete entry'
);

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  $$select public.quarantine_ad_template('review-activation-good')$$,
  'the reviewed template can be quarantined again without deletion'
);

reset role;
select is(
  (select library_status from public.ad_templates where template_id = 'review-activation-good'),
  'quarantined',
  're-quarantine removes it from customer discovery'
);
select ok(
  (select library_review_run_id is null and library_reviewed_at is null from public.ad_templates where template_id = 'review-activation-good'),
  're-quarantine clears stale approval evidence'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}', true);
select is(
  (select count(*)::integer from public.ad_templates where template_id like 'review-activation-%'),
  0,
  'customers see no quarantined entries'
);

reset role;
select is(
  (select count(*)::integer from public.ad_templates where template_id like 'review-activation-%'),
  2,
  'both template rows remain available for inspection'
);
select is(
  (select count(*)::integer from public.ad_template_assets_direct where template_id = 'review-activation-good'),
  1,
  'the template asset row remains intact'
);

select * from finish();

rollback;
