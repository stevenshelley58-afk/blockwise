import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

test('media archive provenance aliases share one object and remain idempotent', { skip: process.env.AD_DB_MEDIA_ALIAS_SQL_TEST !== '1' }, () => {
  const database = process.env.AD_DB_MEDIA_ALIAS_DB || 'ad_radar_parallel_verify_20260908';
  assert.match(database, /^ad_radar_.*verify_[0-9]+$/, 'SQL regression requires an isolated verification database');
  const migration = readFileSync('infra/research-db/migrations/202609080004_ad_db_media_provenance_aliases.sql', 'utf8');
  const sql = `${migration}
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $$
DECLARE p uuid; c uuid; oaid uuid; a1 uuid; a2 uuid; object_id uuid; n integer; h text := md5(clock_timestamp()::text) || md5(random()::text); source_one text := 'https://alias-regression.invalid/one-' || h; source_two text := 'https://alias-regression.invalid/two-' || h; ignored research.media_assets; rejected boolean := false;
BEGIN
  INSERT INTO research.advertiser_pages(platform, page_name, page_id) VALUES ('facebook', 'archive alias regression', '999999') RETURNING id INTO p;
  INSERT INTO research.observed_ads(external_ad_id, advertiser_page_id, first_seen_provider, payload_hash) VALUES (h, p, 'test', h) RETURNING id INTO oaid;
  INSERT INTO research.ad_creatives(observed_ad_id, format, creative_hash) VALUES (oaid, 'image', h) RETURNING id INTO c;
  INSERT INTO research.media_assets(ad_creative_id, observed_ad_id, kind, source_url, capture_status) VALUES (c, oaid, 'image', source_one, 'pending') RETURNING id INTO a1;
  INSERT INTO research.media_assets(ad_creative_id, observed_ad_id, kind, source_url, capture_status) VALUES (c, oaid, 'image', source_two, 'pending') RETURNING id INTO a2;
  SELECT * INTO ignored FROM research.link_verified_media_archive(a1, h, 'ad-db', 'sha256/' || h, 123, 'image/jpeg');
  SELECT archive_object_id INTO object_id FROM research.media_assets WHERE id = a1;
  IF object_id IS NULL THEN RAISE EXCEPTION 'first alias was not archived'; END IF;
  SELECT * INTO ignored FROM research.link_verified_media_archive(a2, h, 'ad-db', 'sha256/' || h, 123, 'image/jpeg');
  SELECT count(*) INTO n FROM research.media_archive_objects WHERE content_hash = h;
  IF n <> 1 OR (SELECT archive_object_id FROM research.media_assets WHERE id = a2) <> object_id THEN RAISE EXCEPTION 'aliases did not share one object'; END IF;
  SELECT * INTO ignored FROM research.link_verified_media_archive(a2, h, 'ad-db', 'sha256/' || h, 123, 'image/jpeg');
  SELECT count(*) INTO n FROM research.media_archive_objects WHERE content_hash = h;
  IF n <> 1 THEN RAISE EXCEPTION 'repeated link created another object'; END IF;
  BEGIN
    INSERT INTO research.media_assets(ad_creative_id, observed_ad_id, kind, source_url, capture_status) VALUES (c, oaid, 'image', source_one, 'pending');
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'duplicate creative/source URL was accepted'; END IF;
  rejected := false;
  BEGIN UPDATE research.media_assets SET archive_verified_at = now(), archive_object_id = null WHERE id = a1;
  EXCEPTION WHEN OTHERS THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'archive verification without object was accepted'; END IF;
END $$;
ROLLBACK;`;
  const out = execFileSync('docker', ['exec', '-i', 'blockwise-research-db', 'psql', '-U', 'postgres', '-d', database, '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', timeout: 90000 });
  assert.match(out, /DO\s+ROLLBACK/);
});
