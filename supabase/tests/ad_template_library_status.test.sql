create extension if not exists pgtap with schema extensions;

begin;

select plan(16);

select has_column('public', 'ad_templates', 'library_status', 'direct templates have a customer library status');
select col_type_is('public', 'ad_templates', 'library_status', 'text', 'library status is text');
select col_not_null('public', 'ad_templates', 'library_status', 'library status is required');
select col_has_default('public', 'ad_templates', 'library_status', 'library status defaults safely');
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ad_templates'::regclass
      and conname = 'ad_templates_library_status_check'
      and contype = 'c'
  ),
  'the named active/quarantined constraint exists'
);

select has_column('public', 'ad_templates', 'library_review_run_id', 'review activation records the Hermes run');
select has_column('public', 'ad_templates', 'library_reviewed_at', 'review activation records its timestamp');

insert into public.ad_templates(
  template_id,
  template_json,
  library_status,
  library_review_run_id,
  library_reviewed_at
)
values (
  'library-status-active',
  '{"templateId":"library-status-active"}'::jsonb,
  'active',
  'trun_reviewed_active',
  now()
);

insert into public.ad_templates(template_id, template_json, library_status)
values ('library-status-quarantined', '{"templateId":"library-status-quarantined"}'::jsonb, 'quarantined');

insert into public.ad_templates(template_id, template_json)
values ('library-status-default', '{"templateId":"library-status-default"}'::jsonb);

insert into public.ad_template_assets_direct(template_id, asset_key, file_name, mime_type, storage_path)
values
  ('library-status-active', 'hero', 'hero.png', 'image/png', 'templates/library-status-active/hero-hero.png'),
  ('library-status-quarantined', 'hero', 'hero.png', 'image/png', 'templates/library-status-quarantined/hero-hero.png');

select is(
  (select library_status from public.ad_templates where template_id = 'library-status-default'),
  'quarantined',
  'new direct templates default to quarantined'
);

select throws_like(
  $$
    insert into public.ad_templates(template_id, template_json, library_status)
    values ('library-status-invalid', '{}'::jsonb, 'retired')
  $$,
  '%ad_templates_library_status_check%',
  'unsupported library states are rejected'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}', true);

select is(
  (select count(*)::integer from public.ad_templates where template_id like 'library-status-%'),
  1,
  'authenticated customers see only active direct templates'
);
select is(
  (select count(*)::integer from public.ad_template_assets_direct where template_id like 'library-status-%'),
  1,
  'authenticated customers cannot read assets belonging to quarantined templates'
);
select is(
  (select count(*)::integer from public.ad_templates where template_id = 'library-status-quarantined'),
  0,
  'an exact authenticated template lookup omits a quarantined row'
);

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (select count(*)::integer from public.ad_templates where template_id = 'library-status-quarantined'),
  1,
  'service-role inspection still sees the quarantined template'
);
select is(
  (select count(*)::integer from public.ad_template_assets_direct where template_id = 'library-status-quarantined'),
  1,
  'service-role inspection still sees its asset row'
);

reset role;
select is(
  (select count(*)::integer from public.ad_templates where template_id like 'library-status-%'),
  3,
  'customer omission preserves every template row'
);
select is(
  (select count(*)::integer from public.ad_template_assets_direct where template_id like 'library-status-%'),
  2,
  'customer omission preserves both asset rows'
);

select * from finish();

rollback;
