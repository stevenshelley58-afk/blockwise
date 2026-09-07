import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

test('008 lifecycle: distinct comparable scans, miss/seen/miss reset, retention and no invented reactivation', {skip: process.env.AD_DB_SQL_TEST !== '1'}, () => {
  const migration = readFileSync('supabase/migrations/202609050008_ad_db_lifecycle_retention.sql', 'utf8');
  const sql = `BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
${migration}
DO $$
DECLARE p uuid; a uuid; r uuid; seen text := gen_random_uuid()::text;
  result jsonb; misses integer; state text; n integer; t timestamptz := now();
BEGIN
  INSERT INTO research.advertiser_pages(platform,page_name,page_id)
  VALUES('facebook','rollback lifecycle test', '999' || (extract(epoch from clock_timestamp())*1000000)::bigint::text) RETURNING id INTO p;
  INSERT INTO research.observed_ads(external_ad_id,advertiser_page_id,first_seen_provider,active_status)
  VALUES(seen,p,'test','active') RETURNING id INTO a;
  FOR n IN 1..5 LOOP
    INSERT INTO research.ad_fetch_runs(source_provider,target_kind,target_value,input_hash,advertiser_page_id,status,coverage_complete,pagination_exhausted,completed_at,input_payload)
    VALUES('test','advertiser_page',p::text,gen_random_uuid()::text,p,'success',true,true,t+n*interval '1 minute','{"country":"AU","activeStatus":"all"}') RETURNING id INTO r;
    result := research.mark_missing_ads_inactive(r,CASE WHEN n IN (2,5) THEN ARRAY[seen] ELSE ARRAY[]::text[] END);
    IF result->>'allowed' <> 'true' THEN RAISE EXCEPTION 'scan % not accepted: %',n,result; END IF;
    SELECT missing_successive_checks,active_status INTO misses,state FROM research.observed_ads WHERE id=a;
    IF n=1 AND (misses<>1 OR state<>'active') THEN RAISE EXCEPTION 'first miss'; END IF;
    IF n=2 AND (misses<>0 OR state<>'active') THEN RAISE EXCEPTION 'seen did not reset'; END IF;
    IF n=3 AND (misses<>1 OR state<>'active') THEN RAISE EXCEPTION 'miss-seen-miss falsely inactive'; END IF;
    IF n=4 AND (misses<>2 OR state<>'inactive') THEN RAISE EXCEPTION 'two misses'; END IF;
    IF n=5 AND state<>'inactive' THEN RAISE EXCEPTION 'historical sighting reactivated'; END IF;
    result := research.mark_missing_ads_inactive(r,ARRAY[]::text[]);
    IF result->>'reason'<>'run_already_reconciled' THEN RAISE EXCEPTION 'repeat not idempotent'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM research.observed_ads WHERE id=a AND ad_delivery_stopped_at IS NOT NULL) THEN RAISE EXCEPTION 'invented delivery date'; END IF;
  INSERT INTO research.ad_fetch_runs(source_provider,target_kind,target_value,input_hash,advertiser_page_id,status,coverage_complete,pagination_exhausted,completed_at,input_payload)
  VALUES('test','advertiser_page',p::text,gen_random_uuid()::text,p,'success',true,true,t,'{"country":"AU","activeStatus":"all"}') RETURNING id INTO r;
  result := research.mark_missing_ads_inactive(r,ARRAY[]::text[]);
  IF result->>'reason'<>'run_out_of_order' THEN RAISE EXCEPTION 'older run accepted'; END IF;
  UPDATE research.ad_fetch_runs SET completed_at=NULL WHERE id=r;
  result := research.mark_missing_ads_inactive(r,ARRAY[]::text[]);
  IF result->>'reason'<>'run_not_complete_comparable' THEN RAISE EXCEPTION 'null completion accepted'; END IF;
  UPDATE research.ad_fetch_runs SET completed_at=t+interval '10 minutes',coverage_complete=false WHERE id=r;
  result := research.mark_missing_ads_inactive(r,ARRAY[]::text[]);
  IF result->>'reason'<>'run_not_complete_comparable' THEN RAISE EXCEPTION 'partial accepted'; END IF;
  PERFORM * FROM research.purge_confirmed_inactive_ads(0,true);
  IF NOT EXISTS(SELECT 1 FROM research.observed_ads WHERE id=a) THEN RAISE EXCEPTION 'archive purged'; END IF;
END $$;
ROLLBACK;`;
  const out = execFileSync('docker', ['exec','-i','blockwise-research-db','psql','-U','postgres','-d','blockwise_research','-X','-v','ON_ERROR_STOP=1'], {input:sql,encoding:'utf8',timeout:90000});
  assert.match(out,/DO\s+ROLLBACK/);
});
