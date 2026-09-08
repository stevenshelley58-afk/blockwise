import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const supervisor = readFileSync("hermes/tools/research-runtime/bin/supabase-supervisor.mjs", "utf8");
const migration = readFileSync("infra/research-db/migrations/202609080002_ad_radar_scan_truth.sql", "utf8");

test("scheduler uses the canonical namespace and tested bounded selector", () => {
  assert.match(supervisor, /dedupe_key: `ad-radar:collector:/);
  assert.doesNotMatch(supervisor, /dedupe_key: `ad-scan:/);
  assert.match(supervisor, /selectDueAdRadarPages\(pages, customerInterestScope/);
  assert.match(supervisor, /chunkIds\(ids\)/);
  assert.match(supervisor, /syncCustomerAdRadarInterests/);
});

test("scan truth migration makes partial evidence unknown and quiet zeros progressive", () => {
  assert.match(migration, /add column if not exists confirmed_zero_scans/);
  assert.match(migration, /schedule_ad_radar_after_run\(p_run_id uuid\)/);
  assert.match(migration, /v_run.status <> 'success'/);
  assert.match(migration, /v_run.result_summary ->> 'active_ads'/);
  assert.match(migration, /coalesce\(v_run.coverage_complete, false\) is not true/);
  assert.match(migration, /coalesce\(v_run.pagination_exhausted, false\) is not true/);
  assert.match(migration, /when 1 then interval '3 days'/);
  assert.match(migration, /when 2 then interval '7 days'/);
  assert.match(migration, /when 3 then interval '14 days'/);
  assert.match(migration, /else interval '30 days'/);
  assert.match(migration, /initial_fill_completed_at = coalesce/);
  assert.match(migration, /last_scheduled_scan_run_id/);
  assert.match(migration, /drop function if exists research.schedule_page_after_scan/);
});

test("collector preserves partial IDs and media failures remain retryable", () => {
  assert.match(supervisor, /classified\.ads\.map\(\(ad\) => ad\.node \|\| \{ ad_archive_id: ad\.id/);
  assert.match(supervisor, /if \(failed > 0\) throw new Error\("media_capture_failed"\)/);
});

test("provider cap remains per capture and no artificial 1000-credit runtime cap exists", () => {
  assert.match(supervisor, /HERMES_SCRAPINGBEE_MAX_CREDITS_PER_CAPTURE/);
  assert.doesNotMatch(supervisor, /MONTHLY_CREDIT_CAP", 1000/);
});

test("finalization targets exactly one run and replay precedes another paid request", () => {
  assert.match(supervisor, /ad_fetch_runs\?id=eq\.\$\{encode\(id\)\}/);
  assert.match(supervisor, /schedule_ad_radar_after_run/);
  assert.ok(supervisor.indexOf("const savedCapture = await loadCaptureJournal") < supervisor.indexOf("reserve: () => rpc"));
  assert.match(supervisor, /await saveCaptureJournal/);
  assert.match(supervisor, /return ensureFetchRun\(rest, row\)/);
});
