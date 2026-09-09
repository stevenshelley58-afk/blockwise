-- Opt-in VPS verification against the currently applied migration state:
-- docker exec -i blockwise-research-db psql -U postgres -d blockwise_research -v ON_ERROR_STOP=1 < supabase/tests/ad_db_archive_native.sql
-- Run from /root/work/blockwise on the VPS. Fixtures and assertions roll back.
-- Do not concatenate migrations 011-014 into this command after they are live.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';


create function pg_temp.assert_true(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'assertion failed: %', p_message;
  end if;
end;
$$;

create function pg_temp.assert_throws(p_sql text, p_state text, p_message text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'assertion failed: expected exception: %', p_message;
  exception when others then
    if sqlerrm = 'assertion failed: expected exception: ' || p_message then raise; end if;
    if p_state is not null and sqlstate <> p_state then
      raise exception 'assertion failed: % (state %, message %)', p_message, sqlstate, sqlerrm;
    end if;
    if position(p_message in sqlerrm) = 0 then
      raise exception 'assertion failed: % (state %, message %)', p_message, sqlstate, sqlerrm;
    end if;
  end;
end;
$$;

select pg_temp.assert_true(not has_function_privilege('public', 'research.link_verified_media_archive(uuid,text,text,text,bigint,text)', 'EXECUTE'), 'PUBLIC execute revoked');
select pg_temp.assert_true(not has_function_privilege('anon', 'research.link_verified_media_archive(uuid,text,text,text,bigint,text)', 'EXECUTE'), 'anon execute revoked');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'research.link_verified_media_archive(uuid,text,text,text,bigint,text)', 'EXECUTE'), 'authenticated execute revoked');
select pg_temp.assert_true(has_function_privilege('service_role', 'research.link_verified_media_archive(uuid,text,text,text,bigint,text)', 'EXECUTE'), 'service role execute granted');
select pg_temp.assert_true(has_table_privilege('service_role', 'research.v_ad_db_prospects', 'SELECT'), 'prospect SELECT restored');

insert into research.media_assets (id, kind, source_url, capture_status)
values ('a1000000-0000-4000-8000-000000000001', 'image', 'https://example.test/archive.png', 'pending');

set local role service_role;
select research.link_verified_media_archive('a1000000-0000-4000-8000-000000000001', repeat('a', 64), 'ad-db-archive', 'sha256/' || repeat('a', 64), 1024, 'image/png');
select research.link_verified_media_archive('a1000000-0000-4000-8000-000000000001', repeat('a', 64), 'ad-db-archive', 'sha256/' || repeat('a', 64), 1024, 'image/png');
reset role;

select pg_temp.assert_true((select count(*) = 1 from research.media_archive_objects where content_hash = repeat('a', 64)), 'RPC is idempotent');
select pg_temp.assert_true((select capture_status = 'captured' and archive_object_id is not null and archive_verified_at is not null and storage_bucket = 'ad-db-archive' and object_key = 'sha256/' || repeat('a', 64) and byte_size = 1024 and mime_type = 'image/png' from research.media_assets where id = 'a1000000-0000-4000-8000-000000000001'), 'asset metadata complete');
select pg_temp.assert_throws($q$select research.link_verified_media_archive('a1000000-0000-4000-8000-000000000001', null, 'ad-db-archive', 'sha256/' || repeat('b', 64), 1, 'image/png')$q$, null, 'content hash must be lowercase SHA-256');
select pg_temp.assert_throws($q$select research.link_verified_media_archive('a1000000-0000-4000-8000-000000000001', repeat('b', 64), null, 'sha256/' || repeat('b', 64), 1, 'image/png')$q$, null, 'archive requires a storage bucket');
select pg_temp.assert_throws($q$select research.link_verified_media_archive('a1000000-0000-4000-8000-000000000001', repeat('b', 64), 'ad-db-archive', null, 1, 'image/png')$q$, null, 'object key must be sha256/<content hash>');
select pg_temp.assert_throws($q$select research.link_verified_media_archive('a1000000-0000-4000-8000-000000000001', repeat('b', 64), 'ad-db-archive', 'sha256/' || repeat('b', 64), null, 'image/png')$q$, null, 'archive requires positive byte size');
select pg_temp.assert_throws($q$select research.link_verified_media_archive('a1000000-0000-4000-8000-000000000001', repeat('b', 64), 'ad-db-archive', 'sha256/' || repeat('b', 64), 1, null)$q$, null, 'archive requires a canonical MIME type');
select pg_temp.assert_throws($q$select research.link_verified_media_archive('a1000000-0000-4000-8000-000000000001', repeat('a', 64), 'ad-db-archive', 'sha256/' || repeat('a', 64), 2048, 'image/png')$q$, '23505', 'archive metadata conflict for content hash');
select pg_temp.assert_true((select byte_size = 1024 and mime_type = 'image/png' from research.media_archive_objects where content_hash = repeat('a', 64)), 'conflict preserves metadata');

insert into research.locations (id, postcode, suburb, state) values
  ('a2000000-0000-4000-8000-000000000002', '9988', 'Archive Fixture North', 'WA'),
  ('a3000000-0000-4000-8000-000000000003', '9989', 'Archive Fixture South', 'WA');
insert into research.agencies (id, name, state) values
  ('a4000000-0000-4000-8000-000000000004', 'Archive Test Agency', 'WA');
insert into research.agents (id, full_name, agency_id, state) values
  ('a5000000-0000-4000-8000-000000000005', 'Archive Test Agent', 'a4000000-0000-4000-8000-000000000004', 'WA');
insert into research.advertiser_pages (id, platform, page_id, page_name, agent_id, agency_id, owner_type) values
  ('a6000000-0000-4000-8000-000000000006', 'meta_ad_library', '990000000006', 'Archive Test Page', 'a5000000-0000-4000-8000-000000000005', null, 'agent');
insert into research.observed_ads (id, external_ad_id, advertiser_page_id, first_seen_provider) values
  ('a7000000-0000-4000-8000-000000000007', 'archive-test-ad', 'a6000000-0000-4000-8000-000000000006', 'fixture');
insert into research.location_links (subject_type, subject_id, location_id, postcode, suburb, state, relation_type) values
  ('observed_ad', 'a7000000-0000-4000-8000-000000000007', 'a2000000-0000-4000-8000-000000000002', '9988', 'Archive Fixture North', 'WA', 'copy_mention'),
  ('observed_ad', 'a7000000-0000-4000-8000-000000000007', 'a3000000-0000-4000-8000-000000000003', '9989', 'Archive Fixture South', 'WA', 'meta_targeting');

select pg_temp.assert_true((select ownership #>> '{agency,relationship}' = 'member_agency' from research.v_ad_db_ads where id = 'a7000000-0000-4000-8000-000000000007'), 'agency membership fallback');
select pg_temp.assert_true((select exists(select 1 from jsonb_array_elements(locations) item where item ->> 'relation' = 'copy_mention') from research.v_ad_db_ads where id = 'a7000000-0000-4000-8000-000000000007'), 'copy_mention provenance');
select pg_temp.assert_true((select exists(select 1 from jsonb_array_elements(locations) item where item ->> 'relation' = 'meta_targeting') from research.v_ad_db_ads where id = 'a7000000-0000-4000-8000-000000000007'), 'meta_targeting provenance');

select 'all native archive migration assertions passed' as result;
rollback;
