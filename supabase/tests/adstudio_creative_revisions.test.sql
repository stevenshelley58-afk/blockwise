create extension if not exists pgtap with schema extensions;

begin;

select plan(22);

select has_table('public', 'adstudio_creative_revisions', 'creative revisions table exists');
select has_column('public', 'adstudio_creatives', 'active_revision_id', 'creatives point to an active revision');
select col_not_null('public', 'adstudio_creatives', 'active_revision_id', 'active revision is required');
select has_function(
  'public',
  'adstudio_append_creative_revision',
  array['uuid', 'uuid', 'uuid', 'jsonb', 'text', 'text', 'uuid'],
  'the compare-and-swap append function exists'
);

insert into public.workspaces (id, name)
values ('a1000000-0000-4000-8000-000000000001', 'Revision Test');

insert into public.adstudio_brand_kits (id, workspace_id, business_name)
values (
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'Revision Realty'
);

insert into public.adstudio_campaigns (
  id,
  workspace_id,
  brand_kit_id,
  name,
  goal,
  offer_id
) values (
  'a3000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'Revision Campaign',
  'seller_leads',
  'just-listed-double'
);

insert into public.adstudio_campaign_variants (
  id,
  workspace_id,
  campaign_id,
  angle,
  headline,
  offer,
  cta
) values (
  'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'listing',
  'Just listed',
  'Inspection',
  'Learn more'
);

insert into public.adstudio_creatives (
  id,
  workspace_id,
  campaign_id,
  variant_id,
  format,
  width,
  height,
  canvas_json,
  render_status
) values (
  'a5000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  '4:5',
  1080,
  1350,
  '{"version":"initial","objects":[]}'::jsonb,
  'rendered'
);

create temp table revision_test_base as
select active_revision_id
from public.adstudio_creatives
where workspace_id = 'a1000000-0000-4000-8000-000000000001'
  and id = 'a5000000-0000-4000-8000-000000000001';

select ok(
  (select active_revision_id is not null from revision_test_base),
  'a new creative receives an active initial revision'
);
select is(
  (
    select count(*)::integer
    from public.adstudio_creative_revisions
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and creative_id = 'a5000000-0000-4000-8000-000000000001'
  ),
  1,
  'a new creative receives exactly one initial revision'
);
select is(
  (
    select canvas_json ->> 'version'
    from public.adstudio_creative_revisions
    where id = (select active_revision_id from revision_test_base)
  ),
  'initial',
  'the initial revision snapshots the creative canvas'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table revision_test_append as
select *
from public.adstudio_append_creative_revision(
  'a1000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',
  (select active_revision_id from revision_test_base),
  '{"version":"edited","objects":[]}'::jsonb,
  'rendered',
  'targeted_edit',
  'a6000000-0000-4000-8000-000000000001'
);

select is(
  (select revision_number from revision_test_append),
  2,
  'the first edit appends revision 2'
);
select is(
  (
    select active_revision_id::text
    from public.adstudio_creatives
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  ),
  (select revision_id::text from revision_test_append),
  'the creative pointer advances to the appended revision'
);
select is(
  (
    select count(*)::integer
    from public.adstudio_creative_revisions
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and creative_id = 'a5000000-0000-4000-8000-000000000001'
  ),
  2,
  'the edit preserves revision 1 and appends one row'
);
select is(
  (
    select parent_revision_id::text
    from public.adstudio_creative_revisions
    where id = (select revision_id from revision_test_append)
  ),
  (select active_revision_id::text from revision_test_base),
  'the appended revision records its exact parent'
);
select is(
  (
    select canvas_json ->> 'version'
    from public.adstudio_creative_revisions
    where id = (select revision_id from revision_test_append)
  ),
  'edited',
  'the appended revision stores the edited canvas'
);
select is(
  (
    select revision_id::text
    from public.adstudio_append_creative_revision(
      'a1000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      (select active_revision_id from revision_test_base),
      '{"version":"edited","objects":[]}'::jsonb,
      'rendered',
      'targeted_edit',
      'a6000000-0000-4000-8000-000000000001'
    )
  ),
  (select revision_id::text from revision_test_append),
  'repeating the same mutation is idempotent'
);

select throws_ok(
  format(
    $sql$
      select * from public.adstudio_append_creative_revision(
        'a1000000-0000-4000-8000-000000000001',
        'a5000000-0000-4000-8000-000000000001',
        %L::uuid,
        '{"version":"stale","objects":[]}'::jsonb,
        'rendered',
        'targeted_edit',
        'a6000000-0000-4000-8000-000000000002'
      )
    $sql$,
    (select active_revision_id from revision_test_base)
  ),
  '40001',
  'ADSTUDIO_STALE_REVISION',
  'a stale base revision is rejected'
);
select is(
  (
    select active_revision_id::text
    from public.adstudio_creatives
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  ),
  (select revision_id::text from revision_test_append),
  'a stale write leaves the active pointer unchanged'
);
select throws_ok(
  $$
    select * from public.adstudio_append_creative_revision(
      'b1000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      '{"version":"cross-workspace","objects":[]}'::jsonb,
      'rendered',
      'targeted_edit',
      'a6000000-0000-4000-8000-000000000003'
    )
  $$,
  'P0002',
  'Creative was not found in this workspace.',
  'the CAS lookup cannot cross workspace boundaries'
);

select ok(
  not has_table_privilege('authenticated', 'public.adstudio_creative_revisions', 'UPDATE'),
  'authenticated users cannot update revision rows directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.adstudio_creative_revisions', 'DELETE'),
  'authenticated users cannot delete revision rows directly'
);
select ok(
  not has_table_privilege('service_role', 'public.adstudio_creative_revisions', 'UPDATE'),
  'service role cannot bypass immutable revisions with a direct update'
);
select ok(
  not has_table_privilege('service_role', 'public.adstudio_creative_revisions', 'DELETE'),
  'service role cannot bypass immutable revisions with a direct delete'
);
select is(
  (select count(*)::integer from public.adstudio_creatives where active_revision_id is null),
  0,
  'all creatives have an active revision after backfill and inserts'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.adstudio_creative_revisions'::regclass),
  'revision rows keep RLS enabled'
);

select * from finish();

rollback;
