#!/usr/bin/env node
/**
 * first-fill.mjs — Ad Radar v2 first fill orchestrator (plan §9).
 *
 * Queues every scan-enabled advertiser page with a real Meta Page ID for an
 * idempotent initial-fill scan. The research supervisor's ad-collector
 * (ScrapingBee primary when enabled) executes the queue:
 *
 *   1. Queue all unique Page IDs (scan_enabled=true, real page_id).
 *   2. Each page is processed exactly once per fill (dedupe_key per page).
 *   3. Zero-ad results are stored as valid observations by the collector.
 *   4. Ads and media import through the normal ingestion path.
 *   5. Lifecycle, creatives and search documents rebuild automatically
 *      (mark_missing_ads_inactive / triggers).
 *   6. Reconciliation report via --report.
 *
 * Usage:
 *   node scripts/research/first-fill.mjs [--batch=1486] [--stagger-ms=5000] \
 *     [--dry-run] [--report=/root/first-fill-report.json]
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([a-z-]+)(?:=(.*))?$/iu.exec(arg);
  return match ? [match[1], match[2] === undefined ? true : match[2]] : [arg, true];
}));

const batch = Number(args.batch ?? 1486);
const staggerMs = Number(args["stagger-ms"] ?? 5000);
const dryRun = args["dry-run"] === true;
const reportPath = args.report ? resolve(String(args.report)) : null;

const dbContainer = process.env.RESEARCH_DB_CONTAINER || "blockwise-research-db";
const psqlPrefix = process.env.RESEARCH_DB_PSQL
  ? String(process.env.RESEARCH_DB_PSQL).split(" ")
  : ["docker", "exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "blockwise_research", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-F", "\x1f"];

function sqlValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `$pj$${text.replaceAll("$pj$", "")}$pj$`;
}

function sqlRows(query) {
  const output = execFileSync(psqlPrefix[0], psqlPrefix.slice(1), {
    input: query,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return output.split("\n").filter((line) => line.length > 0).map((line) => line.split("\x1f"));
}

// Pages eligible for the first fill: real Meta Page ID, scanning enabled,
// not paused. Slugs and scan-disabled pages are excluded by the registry.
const pages = sqlRows(`
  select ap.id::text, ap.page_id, ap.page_name, ap.scan_state,
         (select count(*) from research.observed_ads oa where oa.advertiser_page_id = ap.id) as known_ads
  from research.advertiser_pages ap
  where ap.scan_enabled = true
    and ap.scan_state <> 'paused'
    and ap.page_id is not null
    and ap.page_id !~ '^slug:'
  order by ap.scan_state = 'needs_first_fill' desc,
           ap.current_active_ad_count desc,
           ap.id
  limit ${batch};
`).map(([id, pageId, pageName, scanState, knownAds]) => ({
  id, pageId, pageName, scanState, knownAds: Number(knownAds),
}));

console.log(`First fill: ${pages.length} eligible page(s)${dryRun ? " (dry run)" : ""}`);
const byState = {};
for (const page of pages) byState[page.scanState] = (byState[page.scanState] || 0) + 1;
console.log("By scan state:", JSON.stringify(byState));

if (dryRun) {
  for (const page of pages.slice(0, 10)) {
    console.log(`  would queue ${page.id} page_id=${page.pageId} state=${page.scanState} knownAds=${page.knownAds}`);
  }
  process.exit(0);
}

// Durable build run for provenance (the collector accepts an explicit one).
const buildRunId = sqlRows(
  `insert into research.build_runs (mode, status)
   values ('first_fill_v2', 'running')
   returning id::text;`,
)[0]?.[0];

let queued = 0;
let recycled = 0;
let skippedActive = 0;
const now = () => new Date().toISOString();

for (const [index, page] of pages.entries()) {
  const dedupeKey = `first-fill-v2:${page.id}`;
  const existing = sqlRows(
    `select id::text, status from research.work_queue
     where dedupe_key = ${sqlValue(dedupeKey)} and status in ('pending','claimed','failed','blocked') limit 1;`,
  );
  if (existing.length > 0) {
    const [jobId, status] = existing[0];
    if (status === "pending" || status === "claimed") {
      skippedActive += 1;
      continue;
    }
    sql(`update research.work_queue set
          status = 'pending',
          available_at = ${sqlValue(new Date(Date.now() + index * staggerMs).toISOString())},
          claimed_at = null, claimed_by = null, claim_token = null, claim_expires_at = null,
          attempts = 0, max_attempts = 3, last_error = null, blocked_reason = null,
          result = ${sqlValue({})}, completed_at = null
        where id = ${sqlValue(jobId)};`);
    recycled += 1;
    continue;
  }
  sql(`insert into research.work_queue (
        queue_name, job_type, dedupe_key, advertiser_page_id, priority, payload,
        status, available_at, max_attempts
      ) values (
        'research', 'blockwise-ad-collector', ${sqlValue(dedupeKey)}, ${sqlValue(page.id)}, 4,
        ${sqlValue({
          advertiserPageId: page.id,
          metaPageId: page.pageId,
          build_run_id: buildRunId || undefined,
          scanMode: "initial_fill",
          country: "AU",
          activeStatus: "all",
          resultsLimit: 250,
        })},
        'pending', ${sqlValue(new Date(Date.now() + index * staggerMs).toISOString())}, 3
      );`);
  queued += 1;
  if ((index + 1) % 100 === 0) console.log(`  queued ${index + 1}/${pages.length}`);
}

console.log(`Queued ${queued} new job(s), recycled ${recycled}, skipped ${skippedActive} already active.`);

// --- Reconciliation snapshot ---------------------------------------------------

const reportRows = sqlRows(`
  select
    (select count(*) from research.advertiser_pages where scan_enabled = true and page_id !~ '^slug:') as pages_enabled,
    (select count(*) from research.ad_fetch_runs where scan_mode = 'initial_fill' and advertiser_page_id is not null) as runs_started,
    (select count(*) from research.ad_fetch_runs where scan_mode = 'initial_fill' and status = 'success') as pages_succeeded,
    (select count(*) from research.ad_fetch_runs where scan_mode = 'initial_fill' and status = 'success' and result_summary ? 'confirmed_absence') as pages_zero_ads,
    (select count(*) from research.ad_fetch_runs where scan_mode = 'initial_fill' and status = 'failed') as pages_failed,
    (select coalesce(sum(provider_credits), 0) from research.ad_fetch_runs where source_provider = 'scrapingbee_meta_ad_library') as scrapingbee_credits,
    (select coalesce(sum(provider_request_count), 0) from research.ad_fetch_runs where source_provider = 'scrapingbee_meta_ad_library') as scrapingbee_calls,
    (select count(*) from research.observed_ads) as ads_total,
    (select count(*) from research.observed_ads where active_status = 'active') as ads_active,
    (select count(*) from research.observed_ads where active_status = 'inactive') as ads_inactive,
    (select count(*) from research.observed_ads where active_status = 'unknown') as ads_unknown,
    (select count(*) from research.ad_creatives) as creatives_total,
    (select count(*) from research.media_assets where capture_status = 'captured') as media_captured,
    (select count(*) from research.media_assets where capture_status = 'blocked') as media_blocked,
    (select count(*) from research.ad_search_documents) as search_documents
`).map((row) => {
  const keys = ["pages_enabled", "runs_started", "pages_succeeded", "pages_zero_ads", "pages_failed",
    "scrapingbee_credits", "scrapingbee_calls", "ads_total", "ads_active",
    "ads_inactive", "ads_unknown", "creatives_total", "media_captured", "media_blocked", "search_documents"];
  return Object.fromEntries(keys.map((key, i) => [key, Number(row[i])]));
})[0];

const report = {
  ranAt: now(),
  buildRunId: buildRunId || null,
  queued,
  recycled,
  skippedActive,
  byScanState: byState,
  reconciliation: reportRows,
};

console.log("Reconciliation snapshot:", JSON.stringify(reportRows, null, 2));

if (reportPath) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report written to ${reportPath}`);
}
