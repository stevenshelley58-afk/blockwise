create extension if not exists pgtap with schema extensions;

begin;

select plan(42);

select has_table('public', 'adstudio_creative_revisions', 'creative revisions table exists');
select has_table('public', 'adstudio_creative_revision_mutations', 'creative revision mutation claims exist');
select has_column('public', 'adstudio_creatives', 'active_revision_id', 'creatives point to an active revision');
select has_column(
  'public',
  'adstudio_creative_revision_mutations',
  'request_hash',
  'mutation claims bind to a canonical request hash'
);
select col_not_null('public', 'adstudio_creatives', 'active_revision_id', 'active revision is required');
select has_function(
  'public',
  'adstudio_append_creative_revision',
  array['uuid', 'uuid', 'uuid', 'jsonb', 'text', 'text', 'uuid', 'text'],
  'the compare-and-swap append function exists'
);
select has_function(
  'public',
  'adstudio_claim_creative_revision_mutation',
  array['uuid', 'uuid', 'uuid', 'uuid', 'text'],
  'the pre-dispatch revision claim function exists'
);

insert into public.workspaces (id, name)
values ('a1000000-0000-4000-8000-000000000001', 'Revision Test');

insert into public.workspaces (id, name)
values ('b1000000-0000-4000-8000-000000000001', 'Other Revision Test');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'c1000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'revision-test@example.test', '',
  '{}'::jsonb, '{}'::jsonb, now(), now(), now()
);
insert into public.profiles (id, email)
values ('c1000000-0000-4000-8000-000000000001', 'revision-test@example.test');
insert into public.workspace_members (workspace_id, profile_id, role)
values (
  'a1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'owner'
);

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

select is(
  (
    select state
    from public.adstudio_claim_creative_revision_mutation(
      'a1000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      (select active_revision_id from revision_test_base),
      'a6000000-0000-4000-8000-000000000001',
      repeat('a', 64)
    )
  ),
  'claimed',
  'the expected revision is claimed before provider work begins'
);

create temp table revision_test_append as
select *
from public.adstudio_append_creative_revision(
  'a1000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',
  (select active_revision_id from revision_test_base),
  '{"version":"edited","objects":[]}'::jsonb,
  'rendered',
  'targeted_edit',
  'a6000000-0000-4000-8000-000000000001',
  repeat('a', 64)
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
      'a6000000-0000-4000-8000-000000000001',
      repeat('a', 64)
    )
  ),
  (select revision_id::text from revision_test_append),
  'repeating the same mutation is idempotent'
);
select is(
  (
    select state
    from public.adstudio_claim_creative_revision_mutation(
      'a1000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      (select active_revision_id from revision_test_base),
      'a6000000-0000-4000-8000-000000000001',
      repeat('a', 64)
    )
  ),
  'completed',
  'a retry after completion is replayed without provider work'
);
select is(
  (
    select revision_id::text
    from public.adstudio_claim_creative_revision_mutation(
      'a1000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      (select active_revision_id from revision_test_base),
      'a6000000-0000-4000-8000-000000000001',
      repeat('a', 64)
    )
  ),
  (select revision_id::text from revision_test_append),
  'a completed retry returns the exact winning revision'
);
select is(
  (
    select request_hash
    from public.adstudio_creative_revision_mutations
    where id = 'a6000000-0000-4000-8000-000000000001'
  ),
  repeat('a', 64),
  'the claim stores the canonical request hash'
);
select throws_ok(
  $$
    select * from public.adstudio_claim_creative_revision_mutation(
      'a1000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      (select active_revision_id from revision_test_base),
      'a6000000-0000-4000-8000-000000000001',
      repeat('f', 64)
    )
  $$,
  '22023',
  'ADSTUDIO_MUTATION_CONTENT_MISMATCH',
  'the same mutation ID cannot replay different request content'
);

select throws_ok(
  format(
    $sql$
      select * from public.adstudio_claim_creative_revision_mutation(
        'a1000000-0000-4000-8000-000000000001',
        'a5000000-0000-4000-8000-000000000001',
        %L::uuid,
        'a6000000-0000-4000-8000-000000000002',
        repeat('b', 64)
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
      'a6000000-0000-4000-8000-000000000003',
      repeat('c', 64)
    )
  $$,
  'P0002',
  'Creative was not found in this workspace.',
  'the CAS lookup cannot cross workspace boundaries'
);

grant select, update, delete on public.adstudio_creatives to authenticated;
grant select on revision_test_append to authenticated;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000001"}',
  true
);
create temp table revision_test_before_direct_update as
select active_revision_id from public.adstudio_creatives
where workspace_id = 'a1000000-0000-4000-8000-000000000001'
  and id = 'a5000000-0000-4000-8000-000000000001';
select lives_ok(
  $$
    update public.adstudio_creatives
    set canvas_json = '{"version":"bypass","objects":[]}'::jsonb
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  $$,
  'authenticated direct DML is captured by the revision trigger'
);
select isnt(
  (
    select active_revision_id::text from public.adstudio_creatives
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  ),
  (select active_revision_id::text from revision_test_before_direct_update),
  'direct DML advances the active revision instead of bypassing history'
);
select is(
  (
    select count(*)::integer from public.adstudio_creative_revisions
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and creative_id = 'a5000000-0000-4000-8000-000000000001'
  ),
  3,
  'direct DML preserves both prior revisions and appends one snapshot'
);
select is(
  (
    select state
    from public.adstudio_claim_creative_revision_mutation(
      'a1000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      (
        select active_revision_id from public.adstudio_creatives
        where workspace_id = 'a1000000-0000-4000-8000-000000000001'
          and id = 'a5000000-0000-4000-8000-000000000001'
      ),
      'a6000000-0000-4000-8000-000000000005',
      repeat('e', 64)
    )
  ),
  'claimed',
  'an authenticated edit obtains the guarded pending claim'
);
select throws_ok(
  $$
    update public.adstudio_creatives
    set canvas_json = '{"version":"campaign-race","objects":[]}'::jsonb
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  $$,
  '55P03',
  'ADSTUDIO_EDIT_IN_PROGRESS',
  'ordinary version writes cannot race an active paid edit'
);
select throws_ok(
  $$
    update public.adstudio_creatives
    set pending_revision_mutation_id = null
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'An active creative revision claim cannot be cleared directly.',
  'authenticated direct DML cannot clear an active claim'
);
select throws_ok(
  $$
    update public.adstudio_creatives
    set pending_revision_mutation_id = 'a6000000-0000-4000-8000-000000000006'
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'Invalid creative revision claim transition.',
  'authenticated direct DML cannot replace an active claim'
);
select lives_ok(
  $$
    select public.adstudio_release_creative_revision_mutation(
      'a1000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a6000000-0000-4000-8000-000000000005'
    )
  $$,
  'the validated release transition clears the claim'
);
select is(
  (
    select pending_revision_mutation_id::text
    from public.adstudio_creatives
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  ),
  null,
  'the release RPC leaves no pending claim'
);
select throws_ok(
  format(
    $sql$
      update public.adstudio_creatives
      set active_revision_id = %L::uuid,
          canvas_json = '{"version":"edited","objects":[]}'::jsonb
      where workspace_id = 'a1000000-0000-4000-8000-000000000001'
        and id = 'a5000000-0000-4000-8000-000000000001'
    $sql$,
    (select revision_id from revision_test_append)
  ),
  '23503',
  'Creative active revision does not match its versioned fields.',
  'direct DML cannot move the active pointer backwards'
);
select throws_ok(
  $$
    delete from public.adstudio_creatives
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  $$,
  '23503',
  'Creative revision history must be preserved; archive the creative instead.',
  'authenticated direct DML cannot erase revision history'
);
select throws_ok(
  $$
    select * from public.adstudio_claim_creative_revision_mutation(
      'b1000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a6000000-0000-4000-8000-000000000004',
      repeat('d', 64)
    )
  $$,
  '42501',
  'Workspace access is not allowed.',
  'authenticated claims cannot cross workspace membership boundaries'
);
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

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
