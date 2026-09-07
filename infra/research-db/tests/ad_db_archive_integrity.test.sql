create extension if not exists pgtap with schema extensions;

begin;
select plan(20);

select ok(
  not has_function_privilege('public', 'research.link_verified_media_archive(uuid,text,text,text,bigint,text)', 'EXECUTE'),
  'archive link RPC is not executable by PUBLIC'
);
select ok(
  not has_function_privilege('anon', 'research.link_verified_media_archive(uuid,text,text,text,bigint,text)', 'EXECUTE'),
  'archive link RPC is not executable by anon'
);
select ok(
  not has_function_privilege('authenticated', 'research.link_verified_media_archive(uuid,text,text,text,bigint,text)', 'EXECUTE'),
  'archive link RPC is not executable by authenticated'
);
select ok(
  has_function_privilege('service_role', 'research.link_verified_media_archive(uuid,text,text,text,bigint,text)', 'EXECUTE'),
  'archive link RPC is executable by service_role'
);
select ok(
  has_table_privilege('service_role', 'research.v_ad_db_prospects', 'SELECT'),
  'replacement prospect view remains selectable by service_role'
);

insert into research.media_assets (id, kind, source_url, capture_status)
values ('a1000000-0000-4000-8000-000000000001', 'image', 'https://example.test/archive.png', 'pending');

set local role service_role;
select lives_ok(
  $$ select research.link_verified_media_archive(
       'a1000000-0000-4000-8000-000000000001', repeat('a', 64), 'ad-db-archive',
       'sha256/' || repeat('a', 64), 1024, 'image/png') $$,
  'service role links verified archive metadata'
);
select lives_ok(
  $$ select research.link_verified_media_archive(
       'a1000000-0000-4000-8000-000000000001', repeat('a', 64), 'ad-db-archive',
       'sha256/' || repeat('a', 64), 1024, 'image/png') $$,
  're-linking identical verified metadata is idempotent'
);
reset role;

select is(
  (select count(*)::integer from research.media_archive_objects where content_hash = repeat('a', 64)),
  1,
  'idempotent linking creates one archive object'
);
select ok(
  (select capture_status = 'captured'
          and archive_object_id is not null
          and archive_verified_at is not null
          and storage_bucket = 'ad-db-archive'
          and object_key = 'sha256/' || repeat('a', 64)
          and byte_size = 1024
          and mime_type = 'image/png'
   from research.media_assets where id = 'a1000000-0000-4000-8000-000000000001'),
  'linked asset records complete verified archive metadata'
);

set local role service_role;
select throws_ok(
  $$ select research.link_verified_media_archive(
       'a1000000-0000-4000-8000-000000000001', null::text, 'ad-db-archive',
       'sha256/' || repeat('b', 64), 1, 'image/png') $$,
  'content hash must be lowercase SHA-256',
  'null content hash is rejected'
);
select throws_ok(
  $$ select research.link_verified_media_archive(
       'a1000000-0000-4000-8000-000000000001', repeat('b', 64), null::text,
       'sha256/' || repeat('b', 64), 1, 'image/png') $$,
  'archive requires a storage bucket',
  'null storage bucket is rejected'
);
select throws_ok(
  $$ select research.link_verified_media_archive(
       'a1000000-0000-4000-8000-000000000001', repeat('b', 64), 'ad-db-archive',
       'sha256/not-the-hash', 1, 'image/png') $$,
  'object key must be sha256/<content hash>',
  'non-content-addressed object key is rejected'
);
select throws_ok(
  $$ select research.link_verified_media_archive(
       'a1000000-0000-4000-8000-000000000001', repeat('b', 64), 'ad-db-archive',
       null::text, 1, 'image/png') $$,
  'object key must be sha256/<content hash>',
  'null object key is rejected'
);
select throws_ok(
  $$ select research.link_verified_media_archive(
       'a1000000-0000-4000-8000-000000000001', repeat('b', 64), 'ad-db-archive',
       'sha256/' || repeat('b', 64), null::bigint, 'image/png') $$,
  'archive requires positive byte size',
  'null byte size is rejected'
);
select throws_ok(
  $$ select research.link_verified_media_archive(
       'a1000000-0000-4000-8000-000000000001', repeat('b', 64), 'ad-db-archive',
       'sha256/' || repeat('b', 64), 1, null::text) $$,
  'archive requires a canonical MIME type',
  'null MIME type is rejected'
);
select throws_ok(
  $$ select research.link_verified_media_archive(
       'a1000000-0000-4000-8000-000000000001', repeat('a', 64), 'ad-db-archive',
       'sha256/' || repeat('a', 64), 2048, 'image/png') $$,
  '23505',
  'archive metadata conflict for content hash ' || repeat('a', 64),
  'same hash with mismatched metadata is rejected'
);
reset role;

select ok(
  (select byte_size = 1024 and mime_type = 'image/png'
   from research.media_archive_objects where content_hash = repeat('a', 64)),
  'a rejected conflict does not alter canonical archive metadata'
);

insert into research.locations (id, postcode, suburb, state)
values
  ('a2000000-0000-4000-8000-000000000002', '9988', 'Archive Fixture North', 'WA'),
  ('a3000000-0000-4000-8000-000000000003', '9989', 'Archive Fixture South', 'WA');
insert into research.agencies (id, name, state)
values ('a4000000-0000-4000-8000-000000000004', 'Archive Test Agency', 'WA');
insert into research.agents (id, full_name, agency_id, state)
values ('a5000000-0000-4000-8000-000000000005', 'Archive Test Agent', 'a4000000-0000-4000-8000-000000000004', 'WA');
insert into research.advertiser_pages (id, platform, page_id, page_name, agent_id, agency_id, owner_type)
values ('a6000000-0000-4000-8000-000000000006', 'meta_ad_library', '990000000006', 'Archive Test Page',
        'a5000000-0000-4000-8000-000000000005', null, 'agent');
insert into research.observed_ads (id, external_ad_id, advertiser_page_id, first_seen_provider)
values ('a7000000-0000-4000-8000-000000000007', 'archive-test-ad', 'a6000000-0000-4000-8000-000000000006', 'fixture');
insert into research.location_links (subject_type, subject_id, location_id, postcode, suburb, state, relation_type)
values
  ('observed_ad', 'a7000000-0000-4000-8000-000000000007', 'a2000000-0000-4000-8000-000000000002', '9988', 'Archive Fixture North', 'WA', 'copy_mention'),
  ('observed_ad', 'a7000000-0000-4000-8000-000000000007', 'a3000000-0000-4000-8000-000000000003', '9989', 'Archive Fixture South', 'WA', 'meta_targeting');

select is(
  (select ownership #>> '{agency,relationship}' from research.v_ad_db_ads where id = 'a7000000-0000-4000-8000-000000000007'),
  'member_agency',
  'agent agency is a membership fallback when the page has no agency'
);
select ok(
  (select exists (select 1 from jsonb_array_elements(locations) item where item ->> 'relation' = 'copy_mention')
   from research.v_ad_db_ads where id = 'a7000000-0000-4000-8000-000000000007'),
  'copy mention location provenance is preserved'
);
select ok(
  (select exists (select 1 from jsonb_array_elements(locations) item where item ->> 'relation' = 'meta_targeting')
   from research.v_ad_db_ads where id = 'a7000000-0000-4000-8000-000000000007'),
  'Meta targeting location provenance is preserved'
);

select * from finish();
rollback;
