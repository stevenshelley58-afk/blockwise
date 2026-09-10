import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// A run that was handled as a failure and then re-finalized with a successful
// completion on the same idempotent run row must be able to schedule. Before
// migration 202609100001 the single ad_radar_scheduled_at stamp blocked that,
// leaving filled pages in scan_state='scanning' forever.
test("202609100001: a re-finalized run schedules, a handled run stays idempotent", { skip: process.env.AD_DB_SQL_TEST !== "1" }, () => {
  const migration = readFileSync(
    "infra/research-db/migrations/202609100001_research_ad_radar_schedule_stamp_freshness.sql",
    "utf8",
  );
  const sql = `BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
${migration}
DO $$
DECLARE
  fixture_page_id uuid := gen_random_uuid();
  retried_run uuid;
  fresh_run uuid;
  stale_next timestamptz;
  scheduled timestamptz;
  page_scan_state text;
  page_filled timestamptz;
  page_next timestamptz;
  page_active integer;
  t timestamptz := now();
BEGIN
  INSERT INTO research.advertiser_pages(id,platform,page_name,page_id,status,scan_enabled,scan_state,next_scan_at,consecutive_failures)
  VALUES(fixture_page_id,'facebook','stamp freshness fixture','999999999999998','resolved_collectable',true,'scanning',t - interval '30 minutes',1);

  -- Same run row as a rejected first attempt: handled as a failure at t, then
  -- re-finalized successfully five minutes later.
  INSERT INTO research.ad_fetch_runs(source_provider,target_kind,target_value,input_hash,advertiser_page_id,status,result_summary,coverage_complete,pagination_exhausted,completed_at,scan_mode,ad_radar_scheduled_at)
  VALUES('fixture','advertiser_page',fixture_page_id::text,md5(gen_random_uuid()::text),fixture_page_id,'success',jsonb_build_object('active_ads',3,'provider_credits',25),true,true,t + interval '5 minutes','initial_fill',t)
  RETURNING id INTO retried_run;

  scheduled := research.schedule_ad_radar_after_run(retried_run);
  SELECT scan_state, initial_fill_completed_at, next_scan_at INTO page_scan_state, page_filled, page_next
    FROM research.advertiser_pages WHERE id = fixture_page_id;
  IF page_scan_state <> 'healthy' THEN RAISE EXCEPTION 're-finalized run did not advance scan_state (got %)', page_scan_state; END IF;
  IF page_filled IS NULL THEN RAISE EXCEPTION 're-finalized run did not set initial_fill_completed_at'; END IF;
  IF page_next <> scheduled THEN RAISE EXCEPTION 'returned next_scan_at does not match the page'; END IF;

  -- The same completion is idempotent: a repeat call changes nothing.
  stale_next := page_next;
  PERFORM research.schedule_ad_radar_after_run(retried_run);
  SELECT next_scan_at INTO page_next FROM research.advertiser_pages WHERE id = fixture_page_id;
  IF page_next <> stale_next THEN RAISE EXCEPTION 'repeat call for one completion was not idempotent'; END IF;

  -- A run whose stamp is at or after its own completion is still treated as
  -- handled: this preserves the replay/historical-replay semantics.
  INSERT INTO research.ad_fetch_runs(source_provider,target_kind,target_value,input_hash,advertiser_page_id,status,result_summary,coverage_complete,pagination_exhausted,completed_at,scan_mode,ad_radar_scheduled_at)
  VALUES('fixture','advertiser_page',fixture_page_id::text,md5(gen_random_uuid()::text),fixture_page_id,'success',jsonb_build_object('active_ads',9),true,true,t - interval '2 hours','refresh',t + interval '10 minutes')
  RETURNING id INTO fresh_run;
  PERFORM research.schedule_ad_radar_after_run(fresh_run);
  SELECT next_scan_at, current_active_ad_count INTO page_next, page_active FROM research.advertiser_pages WHERE id = fixture_page_id;
  IF page_next <> stale_next THEN RAISE EXCEPTION 'handled run was scheduled again'; END IF;
  IF page_active <> 3 THEN RAISE EXCEPTION 'handled run changed active count'; END IF;
END $$;
ROLLBACK;`;
  const out = execFileSync(
    "docker",
    ["exec", "-i", "blockwise-research-db", "psql", "-U", "postgres", "-d", "blockwise_research", "-X", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8", timeout: 90000 },
  );
  assert.match(out, /DO\s+ROLLBACK/);
});
