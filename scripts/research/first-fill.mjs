#!/usr/bin/env node
/**
 * first-fill.mjs — Ad Radar v2 initial-fill orchestrator.
 *
 * Queues scan-enabled pages whose scan_state is 'needs_first_fill' (real Meta
 * Page ID only) for an idempotent initial-fill scan. One page scan = one
 * ad_fetch_runs row = N ad_fetch_attempts rows (one per provider request).
 * The research supervisor's ad-collector executes the queue and finalizes the
 * build run once it drains.
 *
 * Modes:
 *   (default)            queue 'needs_first_fill' pages
 *   --include-due        also queue scan-enabled pages whose next_scan_at is
 *                        due (bounded by --batch); refresh is normally driven
 *                        by the supervisor scheduler, not this script
 *   --dry-run            print the plan, touch nothing (queueing is the only
 *                        side effect of a real run — no provider calls)
 *   --report=<path>      write a reconciliation snapshot; reporting reads the
 *                        DB and never spends credits; run it AFTER collection
 *                        has happened (it does not wait for the queue)
 *   --finalize           mark the build run success/failed once the queue
 *                        for it has drained
 *   --credit-ceiling=N   refuse to queue if remaining provider credit budget
 *                        is below N (default: pages × 25)
 *
 * Usage:
 *   node scripts/research/first-fill.mjs --dry-run
 *   node scripts/research/first-fill.mjs --batch=20 --credit-ceiling=500
 *   node scripts/research/first-fill.mjs --report=/root/first-fill-report.json
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([a-z-]+)(?:=(.*))?$/iu.exec(arg);
  return match ? [match[1], match[2] === undefined ? true : match[2]] : [arg, true];
}));

const batch = Number(args.batch ?? 48);
const staggerMs = Number(args["stagger-ms"] ?? 5000);
const providerBalanceVerifiedAt = args["provider-balance-verified-at"] ? Date.parse(String(args["provider-balance-verified-at"])) : NaN;
const dryRun = args["dry-run"] === true;
const includeDue = args["include-due"] === true;
const finalize = args.finalize === true;
const reportPath = args.report ? resolve(String(args.report)) : null;
const creditCeiling = args["credit-ceiling"] !== undefined ? Number(args["credit-ceiling"]) : null;
const CREDITS_PER_REQUEST = 25;

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

function sql(query) {
  sqlRows(query);
}

const now = () => new Date().toISOString();

// --- report mode (read-only reconciliation snapshot) ---------------------------

const reportQueries = () => sqlRows(`
  select
    (select count(*) from research.advertiser_pages where scan_enabled = true and page_id ~ '^[0-9]+$') as pages_enabled,
    (select count(*) from research.advertiser_pages where scan_state = 'needs_first_fill' and scan_enabled) as pages_needing_first_fill,
    (select count(*) from research.ad_fetch_runs where scan_mode = 'initial_fill' and advertiser_page_id is not null) as runs_started,
    (select count(*) from research.ad_fetch_runs where scan_mode = 'initial_fill' and status = 'success') as pages_succeeded,
    (select count(*) from research.ad_fetch_runs where scan_mode = 'initial_fill' and status = 'success' and result_summary ? 'confirmed_absence') as pages_zero_ads,
    (select count(*) from research.ad_fetch_runs where scan_mode = 'initial_fill' and status = 'failed') as pages_failed,
    (select count(*) from research.ad_fetch_runs where status = 'running' and started_at < now() - interval '2 hours') as runs_stuck_running,
    (select coalesce(sum(credits_charged), 0) from research.ad_fetch_attempts) as attempt_credits_total,
    (select coalesce(sum(credits_charged), 0) from research.ad_fetch_attempts where outcome <> 'success') as attempt_credits_wasted,
    (select count(*) from research.ad_fetch_attempts) as attempts_total,
    (select count(*) from research.observed_ads) as ads_total,
    (select count(*) from research.observed_ads where active_status = 'active') as ads_active,
    (select count(*) from research.observed_ads where active_status = 'inactive') as ads_inactive,
    (select count(*) from research.observed_ads where active_status = 'unknown') as ads_unknown,
    (select count(*) from research.ad_creatives) as creatives_total,
    (select count(*) from research.media_assets where capture_status = 'captured') as media_captured,
    (select count(*) from research.media_assets where capture_status = 'blocked') as media_blocked,
    (select count(*) from research.ad_search_documents) as search_documents,
    (select count(*) from research.ad_search_documents where ad_status = 'active') as search_docs_active
`).map((row) => {
  const keys = ["pages_enabled", "pages_needing_first_fill", "runs_started", "pages_succeeded", "pages_zero_ads",
    "pages_failed", "runs_stuck_running", "attempt_credits_total", "attempt_credits_wasted", "attempts_total",
    "ads_total", "ads_active", "ads_inactive", "ads_unknown", "creatives_total",
    "media_captured", "media_blocked", "search_documents", "search_docs_active"];
  return Object.fromEntries(keys.map((key, i) => [key, Number(row[i])]));
})[0];

if (reportPath || args.report === true) {
  const reconciliation = reportQueries();
  const report = { ranAt: now(), reconciliation };
  console.log("Reconciliation snapshot (read-only; reflects current DB state):", JSON.stringify(reconciliation, null, 2));
  if (reportPath !== null && reportPath !== true) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Report written to ${reportPath}`);
  }
  process.exit(0);
}

// --- finalize mode -----------------------------------------------------------

if (finalize) {
  const drained = sqlRows(`
    select br.id::text, br.status,
      (select count(*) from research.work_queue wq
        where wq.job_type = 'blockwise-ad-collector'
          and wq.payload->>'build_run_id' = br.id::text
          and wq.status in ('pending','claimed')) as outstanding
    from research.build_runs br
    where br.mode = 'build' and br.input_payload->> 'kind' = 'first_fill' and br.status = 'running';
  `);
  for (const [runId, status, outstanding] of drained) {
    if (Number(outstanding) === 0) {
      const failed = Number(sqlRows(`
        select count(*) from research.work_queue wq
        where wq.payload->>'build_run_id' = '${runId}'
          and wq.status in ('failed','blocked');
      `)[0][0]);
      sql(`update research.build_runs set status = '${failed > 0 ? "partial" : "success"}', finished_at = now()
           where id = '${runId}'::uuid;`);
      console.log(`Build run ${runId}: finalized (${failed > 0 ? "partial" : "success"}).`);
    } else {
      console.log(`Build run ${runId}: ${outstanding} job(s) outstanding, still running.`);
    }
  }
  process.exit(0);
}

// --- page selection -----------------------------------------------------------

// Initial fill targets ONLY pages that have never had a successful scan.
// Refresh scheduling (next_scan_at due) belongs to the supervisor scheduler;
// --include-due exists for bounded manual operation.
const pageFilter = includeDue
  ? `and (ap.scan_state = 'needs_first_fill' or ap.next_scan_at <= now())`
  : `and ap.scan_state = 'needs_first_fill'`;

const pages = sqlRows(`
  select ap.id::text, ap.page_id, ap.page_name, ap.scan_state,
         (select count(*) from research.observed_ads oa where oa.advertiser_page_id = ap.id) as known_ads
  from research.advertiser_pages ap
  where ap.scan_enabled = true
    and ap.scan_state <> 'paused'
    and ap.page_id is not null
    and ap.page_id ~ '^[0-9]+$'
    ${pageFilter}
  order by ap.current_active_ad_count desc, ap.id
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
  console.log(`Estimated provider cost: ${pages.length * CREDITS_PER_REQUEST} credits (1 request/page at up to ${CREDITS_PER_REQUEST}).`);
  process.exit(0);
}

// Credit budget guard before queueing anything.
const budget = sqlRows(`
  select coalesce(max_credits, 0) - coalesce(reserved_credits, 0) - coalesce(spent_credits, 0) as remaining
  from research.provider_credit_budgets where provider = 'scrapingbee'
  order by period_start desc limit 1;
`);
if (budget.length === 0) { console.error("ABORT: no provider_credit_budgets row for scrapingbee."); process.exit(3); }
if (!Number.isFinite(providerBalanceVerifiedAt) || Date.now() - providerBalanceVerifiedAt > 86400000 || providerBalanceVerifiedAt > Date.now() + 60000) { console.error("ABORT: provider balance is unverified; pass fresh --provider-balance-verified-at."); process.exit(3); }
const remaining = Number(budget[0][0]); const needed = pages.length * CREDITS_PER_REQUEST; const requiredCeiling = creditCeiling ?? needed;
if (needed > requiredCeiling) { console.error("ABORT: selected pages exceed the explicit run credit ceiling; reduce --batch."); process.exit(3); }
if (!Number.isFinite(requiredCeiling) || requiredCeiling <= 0 || remaining < Math.min(needed, requiredCeiling)) { console.error("ABORT: credit budget remaining is below required ceiling."); process.exit(3); }
if (budget.length > 0 && creditCeiling !== null) {
  const remaining = Number(budget[0][0]);
  const needed = pages.length * CREDITS_PER_REQUEST;
  if (remaining < Math.min(needed, creditCeiling)) {
    console.error(`ABORT: credit budget remaining ${remaining} is below the ceiling ${creditCeiling} (needed ~${needed}).`);
    process.exit(3);
  }
} else if (creditCeiling === null && budget.length === 0) {
  console.error("ABORT: no provider_credit_budgets row for 'scrapingbee'. Seed the budget before queueing paid scans.");
  process.exit(3);
}

// Durable build run for provenance (the collector accepts an explicit one and
// finalizes it when the queue drains).
const buildRunId = sqlRows(
  `insert into research.build_runs (mode, status, trigger, input_payload)
   values ('build', 'running', 'manual', ${sqlValue({ kind: "first_fill", provider_balance_verified_at: new Date(providerBalanceVerifiedAt).toISOString(), credit_ceiling: requiredCeiling })})
   returning id::text;`,
)[0]?.[0];

let queued = 0;
let recycled = 0;
let skippedActive = 0;

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
          attempts = 0, max_attempts = 1, last_error = null, blocked_reason = null,
          payload = ${sqlValue({ advertiserPageId: page.id, metaPageId: page.pageId, build_run_id: buildRunId, scanMode: "initial_fill", country: "AU", activeStatus: "all", resultsLimit: 250, creditCeiling: requiredCeiling })},
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
          creditCeiling: requiredCeiling,
        })},
        'pending', ${sqlValue(new Date(Date.now() + index * staggerMs).toISOString())}, 1
      );`);
  queued += 1;
  if ((index + 1) % 100 === 0) console.log(`  queued ${index + 1}/${pages.length}`);
}

console.log(`Queued ${queued} new job(s), recycled ${recycled}, skipped ${skippedActive} already active.`);
console.log(`Build run ${buildRunId || "?"} stays 'running' until the queue drains (finalize with --finalize).`);
console.log("No provider credits were spent by this script; collection happens in the supervisor.");
