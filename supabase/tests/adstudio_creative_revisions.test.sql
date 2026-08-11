create extension if not exists pgtap with schema extensions;

begin;

select plan(67);

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

grant select on public.adstudio_creatives to authenticated;
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
select throws_ok(
  $$
    update public.adstudio_creatives
    set canvas_json = '{"version":"bypass","objects":[]}'::jsonb
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'authenticated users cannot replace canvas JSON directly'
);
select is(
  (
    select active_revision_id::text from public.adstudio_creatives
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  ),
  (select active_revision_id::text from revision_test_before_direct_update),
  'blocked direct DML leaves the active revision unchanged'
);
select is(
  (
    select count(*)::integer from public.adstudio_creative_revisions
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and creative_id = 'a5000000-0000-4000-8000-000000000001'
  ),
  2,
  'blocked direct DML appends no attacker-controlled snapshot'
);
select throws_ok(
  $$
    insert into public.adstudio_creatives (
      id, workspace_id, campaign_id, variant_id, format, width, height,
      canvas_json, render_status
    ) values (
      'a5000000-0000-4000-8000-000000000099',
      'a1000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000001',
      '4:5', 1080, 1350,
      '{"version":"browser-insert","objects":[]}'::jsonb,
      'rendered'
    )
  $$,
  '42501',
  null,
  'authenticated users cannot insert server-owned creative state'
);
select throws_ok(
  $$
    select public.adstudio_persist_campaign_pack(
      '{}'::jsonb, '{}'::jsonb, '[]'::jsonb,
      '[{"canvas_json":{"version":"browser-pack"}}]'::jsonb,
      '[]'::jsonb, '{}'::jsonb
    )
  $$,
  '42501',
  null,
  'authenticated users cannot proxy arbitrary canvas JSON through whole-pack persistence'
);
select throws_ok(
  $$
    select * from public.adstudio_claim_creative_revision_mutation(
      'a1000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a6000000-0000-4000-8000-000000000005',
      repeat('e', 64)
    )
  $$,
  '42501',
  null,
  'an authenticated browser session cannot claim a revision mutation directly'
);
select throws_ok(
  $$
    select * from public.adstudio_append_creative_revision(
      'a1000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      '{"version":"browser-injected","objects":[{"content":"arbitrary pixels"}]}'::jsonb,
      'rendered',
      'targeted_edit',
      'a6000000-0000-4000-8000-000000000005',
      repeat('e', 64)
    )
  $$,
  '42501',
  null,
  'an authenticated browser session cannot append arbitrary replacement canvas JSON'
);
select throws_ok(
  $$
    select public.adstudio_release_creative_revision_mutation(
      'a1000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a6000000-0000-4000-8000-000000000005'
    )
  $$,
  '42501',
  null,
  'an authenticated browser session cannot release a revision mutation directly'
);
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
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
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000001"}',
  true
);
select throws_ok(
  $$
    update public.adstudio_creatives
    set canvas_json = '{"version":"campaign-race","objects":[]}'::jsonb
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'authenticated version writes are denied before they can race a paid edit'
);
select throws_ok(
  $$
    update public.adstudio_creatives
    set pending_revision_mutation_id = null
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'authenticated direct DML cannot clear an active claim'
);
select throws_ok(
  $$
    update public.adstudio_creatives
    set pending_revision_mutation_id = 'a6000000-0000-4000-8000-000000000006'
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'authenticated direct DML cannot replace an active claim'
);
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
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
select lives_ok(
  $$
    update public.adstudio_creatives
    set canvas_json = '{"version":"service-update","objects":[]}'::jsonb,
        render_status = 'rendered'
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  $$,
  'service-owned direct persistence updates a workspace-scoped creative'
);
select is(
  (
    select canvas_json ->> 'version'
    from public.adstudio_creatives
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  ),
  'service-update',
  'the service update persists its server-built canvas'
);
select is(
  (
    select count(*)::integer
    from public.adstudio_creative_revisions
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and creative_id = 'a5000000-0000-4000-8000-000000000001'
  ),
  3,
  'service persistence remains revisioned by the database guard'
);
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000001"}',
  true
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
  '42501',
  null,
  'authenticated direct DML cannot move the active pointer backwards'
);
select throws_ok(
  $$
    delete from public.adstudio_creatives
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
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
  null,
  'an authenticated session cannot probe another workspace through a revision RPC'
);
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select ok(
  has_table_privilege('authenticated', 'public.adstudio_creatives', 'SELECT'),
  'authenticated users retain safe creative reads'
);
select ok(
  not has_table_privilege('authenticated', 'public.adstudio_creatives', 'INSERT'),
  'authenticated users cannot insert creatives'
);
select ok(
  not has_table_privilege('authenticated', 'public.adstudio_creatives', 'UPDATE'),
  'authenticated users cannot update any creative field'
);
select ok(
  not has_table_privilege('authenticated', 'public.adstudio_creatives', 'DELETE'),
  'authenticated users cannot delete creatives'
);
select ok(
  has_table_privilege('service_role', 'public.adstudio_creatives', 'INSERT'),
  'service role can insert server-owned creatives'
);
select ok(
  has_table_privilege('service_role', 'public.adstudio_creatives', 'UPDATE'),
  'service role can update server-owned creatives'
);
select ok(
  has_table_privilege('service_role', 'public.adstudio_creatives', 'DELETE'),
  'service role retains server-owned creative deletion authority'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.adstudio_persist_campaign_pack(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ),
  'authenticated users cannot execute whole-pack persistence'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.adstudio_persist_campaign_pack(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ),
  'service role can execute whole-pack persistence'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.adstudio_claim_creative_revision_mutation(uuid,uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated cannot execute the revision claim RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.adstudio_release_creative_revision_mutation(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot execute the revision release RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.adstudio_append_creative_revision(uuid,uuid,uuid,jsonb,text,text,uuid,text)',
    'EXECUTE'
  ),
  'authenticated cannot execute the arbitrary-canvas append RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.adstudio_claim_creative_revision_mutation(uuid,uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'service role can execute the revision claim RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.adstudio_release_creative_revision_mutation(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'service role can execute the revision release RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.adstudio_append_creative_revision(uuid,uuid,uuid,jsonb,text,text,uuid,text)',
    'EXECUTE'
  ),
  'service role can execute the revision append RPC'
);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  $$
    select public.adstudio_release_creative_revision_mutation(
      'a1000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a6000000-0000-4000-8000-000000000099'
    )
  $$,
  'service_role executes a revision mutation RPC'
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

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  $$
    select public.adstudio_persist_campaign_pack(
      (
        select to_jsonb(row_value)
        from public.adstudio_brand_kits row_value
        where id = 'a2000000-0000-4000-8000-000000000001'
      ),
      (
        select to_jsonb(row_value)
        from public.adstudio_campaigns row_value
        where id = 'a3000000-0000-4000-8000-000000000001'
      ),
      (
        select jsonb_agg(to_jsonb(row_value))
        from public.adstudio_campaign_variants row_value
        where campaign_id = 'a3000000-0000-4000-8000-000000000001'
      ),
      (
        select jsonb_agg(
          to_jsonb(row_value) || jsonb_build_object(
            'canvas_json', '{"version":"service-pack","objects":[]}'::jsonb,
            'render_status', 'rendered'
          )
        )
        from public.adstudio_creatives row_value
        where campaign_id = 'a3000000-0000-4000-8000-000000000001'
      ),
      '[]'::jsonb,
      jsonb_build_object(
        'id', 'a7000000-0000-4000-8000-000000000001',
        'workspace_id', 'a1000000-0000-4000-8000-000000000001',
        'campaign_id', 'a3000000-0000-4000-8000-000000000001',
        'status', 'passed',
        'issues_json', '[]'::jsonb,
        'checked_at', now()
      )
    )
  $$,
  'service_role executes transactional whole-pack persistence'
);
select is(
  (
    select canvas_json ->> 'version'
    from public.adstudio_creatives
    where workspace_id = 'a1000000-0000-4000-8000-000000000001'
      and id = 'a5000000-0000-4000-8000-000000000001'
  ),
  'service-pack',
  'the service-only pack RPC persists its server-built creative state'
);
reset role;

select * from finish();

rollback;
