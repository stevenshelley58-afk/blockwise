#!/usr/bin/env node
/**
 * scrapingbee-pilot.mjs — 100-page ScrapingBee pilot (Ad Radar v2, plan §8).
 *
 * Cohorts (exactly as specified):
 *   30 pages with historical ads
 *   50 pages with no known ads (previous zero-ad / no_ads_confirmed)
 *   20 never-checked pages
 *
 * Rules:
 *   - Auto-Mode (mode=auto) capped at 25 credits per request.
 *   - Only genuinely blocked pages (403/429/challenge) are retried once with
 *     the stealth proxy tier.
 *   - No ScrapingBee AI extraction. No video bytes through ScrapingBee.
 *   - Every call is recorded into research.ad_fetch_runs (scan_mode='manual',
 *     provider='scrapingbee_meta_ad_library') with Spb-cost / Spb-auto-cost /
 *     Spb-request-id telemetry, duration, pagination and result counts.
 *   - Aborts (and reports) if the projected full-fill cost exceeds the
 *     configured monthly credit cap.
 *
 * Usage:
 *   SCRAPINGBEE_API_KEY=... node scripts/research/scrapingbee-pilot.mjs \
 *     [--limit-historical=30] [--limit-zero-ad=50] [--limit-never-checked=20] \
 *     [--monthly-cap=200000] [--max-cost=25] [--out=/root/pilot-report.json]
 *
 * DB access defaults to `docker exec blockwise-research-db psql`; override
 * with RESEARCH_DB_CONTAINER or RESEARCH_DB_PSQL (full psql command prefix).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const debugDir = process.env.PILOT_DEBUG_DIR || "/root/pilot-debug";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([a-z-]+)(?:=(.*))?$/iu.exec(arg);
  return match ? [match[1], match[2] === undefined ? true : match[2]] : [arg, true];
}));

const apiKey = process.env.SCRAPINGBEE_API_KEY || process.env.HERMES_SCRAPINGBEE_API_KEY || "";
if (!apiKey) {
  console.error("SCRAPINGBEE_API_KEY is required.");
  process.exit(2);
}

const limits = {
  historical: Number(args["limit-historical"] ?? 30),
  zero_ad: Number(args["limit-zero-ad"] ?? 50),
  never_checked: Number(args["limit-never-checked"] ?? 20),
};
const maxCost = Math.min(Number(args["max-cost"] ?? 25), 100);
const monthlyCap = Number(args["monthly-cap"] ?? 200_000);
const totalFullFillPages = Number(args["full-fill-pages"] ?? 1486);
const outPath = args.out ? resolve(String(args.out)) : null;
const timeoutMs = Number(process.env.SCRAPINGBEE_TIMEOUT_MS ?? 120_000);

// --- DB access ---------------------------------------------------------------

const dbContainer = process.env.RESEARCH_DB_CONTAINER || "blockwise-research-db";
const psqlPrefix = process.env.RESEARCH_DB_PSQL
  ? String(process.env.RESEARCH_DB_PSQL).split(" ")
  : ["docker", "exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "blockwise_research", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-F", "\x1f"];

function sqlValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  // Dollar-quote to survive JSON payloads; escape any embedded $$ tags.
  const tag = "$pj$";
  return `${tag}${text.replaceAll(tag, "")}${tag}`;
}

function sql(query) {
  const output = execFileSync(psqlPrefix[0], psqlPrefix.slice(1), {
    input: query,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return output;
}

function sqlRows(query) {
  const output = sql(query);
  return output.split("\n").filter((line) => line.length > 0).map((line) => line.split("\x1f"));
}

// --- Cohort selection --------------------------------------------------------

const cohortQueries = {
  historical: `
    select ap.id::text, ap.page_id, ap.page_name,
           (select count(*) from research.observed_ads oa where oa.advertiser_page_id = ap.id) as known_ads
    from research.advertiser_pages ap
    where ap.page_id is not null
      and ap.page_id !~ '^slug:'
      and exists (select 1 from research.observed_ads oa where oa.advertiser_page_id = ap.id)
    order by known_ads desc, ap.last_checked_at asc nulls first
    limit ${limits.historical};`,
  zero_ad: `
    select ap.id::text, ap.page_id, ap.page_name, 0::bigint as known_ads
    from research.advertiser_pages ap
    where ap.page_id is not null
      and ap.page_id !~ '^slug:'
      and ap.last_successful_check_at is not null
      and not exists (select 1 from research.observed_ads oa where oa.advertiser_page_id = ap.id)
    order by ap.last_checked_at asc
    limit ${limits.zero_ad};`,
  never_checked: `
    select ap.id::text, ap.page_id, ap.page_name, 0::bigint as known_ads
    from research.advertiser_pages ap
    where ap.page_id is not null
      and ap.page_id !~ '^slug:'
      and ap.last_successful_check_at is null
    order by ap.first_seen_at asc
    limit ${limits.never_checked};`,
};

const pages = [];
for (const [cohort, query] of Object.entries(cohortQueries)) {
  for (const row of sqlRows(query)) {
    const [id, pageId, pageName, knownAds] = row;
    pages.push({ cohort, id, pageId, pageName, knownAds: Number(knownAds) });
  }
}

if (pages.length === 0) {
  console.error("No pilot pages selected; aborting.");
  process.exit(2);
}
// Interleave cohorts so a budget-limited run still samples all three.
pages.sort((a, b) => {
  const order = { historical: 0, zero_ad: 1, never_checked: 2 };
  const bucket = (order[a.cohort] ?? 9) - (order[b.cohort] ?? 9);
  return bucket !== 0 ? bucket : a.id.localeCompare(b.id);
});
const interleaved = [];
const queues = new Map();
for (const page of pages) {
  if (!queues.has(page.cohort)) queues.set(page.cohort, []);
  queues.get(page.cohort).push(page);
}
while (interleaved.length < pages.length) {
  for (const queue of queues.values()) {
    const next = queue.shift();
    if (next) interleaved.push(next);
  }
}
pages.length = 0;
pages.push(...interleaved);
console.log(`Pilot cohorts: ${JSON.stringify(Object.entries(limits))}; selected ${pages.length} pages (interleaved).`);

// --- ScrapingBee helpers ------------------------------------------------------

function metaAdLibraryUrl(pageId) {
  const params = new URLSearchParams({
    active_status: "all",
    ad_type: "all",
    country: "AU",
    media_type: "all",
    view_all_page_id: pageId,
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

async function scrapingBeeUsage() {
  const response = await fetch(`https://app.scrapingbee.com/api/v1/usage?api_key=${encodeURIComponent(apiKey)}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`usage endpoint failed ${response.status}`);
  return response.json();
}

// Usage endpoint returns max_api_credit / used_api_credit (plan credits).
function usageSummary(usage) {
  const max = Number(usage?.max_api_credit ?? usage?.totalRequestLimit ?? usage?.credit?.limit ?? 0);
  const used = Number(usage?.used_api_credit ?? usage?.totalRequestUsed ?? usage?.credit?.used ?? 0);
  return { max, used, remaining: Math.max(0, max - used), concurrency: usage?.max_concurrency ?? null };
}

async function creditsRemaining() {
  try {
    const usage = await scrapingBeeUsage();
    return usageSummary(usage).remaining;
  } catch (error) {
    console.error(`Usage check failed (${error.message}); assuming 0 remaining for safety.`);
    return 0;
  }
}

function parseHtml(html) {
  const text = String(html || "");
  // Accept escaped-quote payload variants (\"search_results_connection\":...)
  // as well as plain JSON.
  const counts = [...text.matchAll(/\\?"search_results_connection\\?"\s*:\s*\{\\?"count\\?"\s*:\s*(\d+)/gu)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  const ids = new Set();
  for (const match of text.matchAll(/\\?"(?:adArchiveID|ad_archive_id)\\?"\s*:\s*\\?"(\d{10,})\\?"/gu)) ids.add(match[1]);
  const challengeDetected = /\/__rd_verify_[^"'\s<]+/iu.test(text) || /\bexecuteChallenge\s*\(/iu.test(text)
    || /\bchallenge=3\b/iu.test(text) || /ad_library_is_captcha_required\\?"\s*:\s*true/iu.test(text);
  const loginWall = /you must log in to continue/iu.test(text);
  // Absence is confirmed by the connection itself: count 0 with empty edges.
  // The marketing "No ads" banner is often absent from rendered payloads.
  const confirmedAbsence = /\\?"search_results_connection\\?"\s*:\s*\{\\?"count\\?"\s*:\s*0\s*,\\?"edges\\?"\s*:\s*\[\s*\]/iu.test(text);
  const connectionCount = counts.length ? Math.max(...counts) : null;
  return {
    adsSeen: ids.size || (connectionCount ?? 0),
    connectionCount,
    confirmedAbsence,
    challengeDetected,
    loginWall,
    parseable: ids.size > 0 || confirmedAbsence || counts.length > 0,
    sampleAdIds: [...ids].slice(0, 10),
  };
}

async function fetchViaScrapingBee({ url, stealth = false }) {
  const params = new URLSearchParams({
    api_key: apiKey,
    url,
  });
  if (stealth) {
    params.set("stealth_proxy", "true");
    params.set("render_js", "true");
    params.set("transparent_status_code", "true");
  } else {
    // Auto-Mode picks its own settings; transparent_status_code is
    // incompatible with mode=auto.
    params.set("mode", "auto");
    params.set("max_cost", String(maxCost));
  }
  const started = Date.now();
  const response = await fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  const html = await response.text();
  const header = (name) => response.headers.get(name);
  const credits = Number(header("spb-cost") ?? header("spb-auto-cost") ?? 0) || 0;
  const requestId = header("spb-request-id") || null;
  const initialStatus = Number(header("spb-initial-status-code") || NaN);
  return {
    httpStatus: response.status,
    initialStatus: Number.isNaN(initialStatus) ? null : initialStatus,
    credits,
    requestId,
    htmlBytes: html.length,
    durationMs: Date.now() - started,
    html,
    bodySnippet: html.length <= 400 ? html : "",
  };
}

// --- Pilot loop ---------------------------------------------------------------

const usageBefore = await scrapingBeeUsage();
const budgetBefore = usageSummary(usageBefore);
console.log("Usage before pilot:", JSON.stringify(usageBefore).slice(0, 400));
const creditFloor = Number(args["credit-floor"] ?? 0);
if (budgetBefore.remaining <= creditFloor) {
  console.error(`ABORT: only ${budgetBefore.remaining} credits remain (floor ${creditFloor}); pilot would exhaust the plan.`);
  process.exit(3);
}

const results = [];
let creditsSpent = 0;
let stealthRetries = 0;

for (const [index, page] of pages.entries()) {
  const remaining = await creditsRemaining();
  if (remaining <= creditFloor + maxCost) {
    console.error(`STOP: ${remaining} credits remaining, floor ${creditFloor} + max cost ${maxCost}; halting before page ${index + 1}.`);
    break;
  }
  const url = metaAdLibraryUrl(page.pageId);
  const runIdSql = `insert into research.ad_fetch_runs (
    advertiser_page_id, scan_mode, idempotency_key, source_provider, role, trigger,
    target_kind, target_value, input_payload, input_hash, status, result_summary
  ) values (
    '${page.id}'::uuid, 'manual', 'pilot:${page.id}:${Date.now()}', 'scrapingbee_meta_ad_library', 'primary', 'manual',
    'advertiser_page', ${sqlValue(page.id)}, ${sqlValue({ pilot: true, cohort: page.cohort, metaPageId: page.pageId })},
    md5(${sqlValue(page.id)}), 'running', ${sqlValue({ pilot: true, cohort: page.cohort })}
  ) returning id::text;`;
  const runId = sqlRows(runIdSql)[0]?.[0];
  if (!runId) {
    console.error(`Failed to insert ad_fetch_run for page ${page.id}; skipping.`);
    continue;
  }

  let attempt;
  let tier = "auto_mode";
  try {
    attempt = await fetchViaScrapingBee({ url });
    creditsSpent += attempt.credits;
    const parsed = parseHtml(attempt.html);
    const blocked = attempt.httpStatus >= 400 || attempt.httpStatus === 429
      || attempt.initialStatus === 403 || attempt.initialStatus === 429
      || parsed.challengeDetected || parsed.loginWall;
    if (blocked) {
      // Retry only genuinely blocked pages, once, on the stealth tier.
      stealthRetries += 1;
      tier = "stealth_proxy";
      const stealth = await fetchViaScrapingBee({ url, stealth: true });
      creditsSpent += stealth.credits;
      const stealthParsed = parseHtml(stealth.html);
      attempt = stealth;
      Object.assign(parsed, stealthParsed);
    }
    const success = parsed.parseable;
    const paginationExhausted = success && (parsed.adsSeen < 250);
    if (!success && attempt.httpStatus === 200) {
      // Persist unparseable payloads so variants can be diagnosed offline.
      try {
        mkdirSync(debugDir, { recursive: true });
        writeFileSync(`${debugDir}/${page.pageId}-${Date.now()}.html`, attempt.html.slice(0, 2_000_000));
      } catch { /* best effort */ }
    }
    sql(`update research.ad_fetch_runs set
      completed_at = now(),
      status = ${success ? "'success'" : "'failed'"},
      source_provider = 'scrapingbee_meta_ad_library',
      error = ${sqlValue(success ? null : (parsed.challengeDetected ? "challenge_detected" : parsed.loginWall ? "login_wall" : "payload_not_parseable"))},
      provider_request_count = ${tier === "stealth_proxy" ? 2 : 1},
      provider_credits = ${attempt.credits},
      provider_cost_usd = null,
      scrapingbee_tier = ${sqlValue(tier)},
      scraper_run_id = ${sqlValue(attempt.requestId)},
      coverage_complete = ${success ? (parsed.confirmedAbsence || paginationExhausted) : "null"},
      pagination_exhausted = ${success ? paginationExhausted : "null"},
      stop_reason = ${sqlValue(success ? (parsed.confirmedAbsence ? "confirmed_absence" : paginationExhausted ? "page_exhausted" : "results_limit_reached") : "blocked_or_unparseable")},
      dataset_checksum = md5(${sqlValue(JSON.stringify(parsed.sampleAdIds))}),
      result_summary = ${sqlValue({
        pilot: true,
        cohort: page.cohort,
        tier,
        ads_seen: parsed.adsSeen,
        connection_count: parsed.connectionCount,
        confirmed_absence: parsed.confirmedAbsence,
        challenge_detected: parsed.challengeDetected,
        login_wall: parsed.loginWall,
        html_bytes: attempt.htmlBytes,
        http_status: attempt.httpStatus,
        spb_initial_status: attempt.initialStatus,
        ...(attempt.bodySnippet ? { error_body: attempt.bodySnippet } : {}),
        duration_ms: attempt.durationMs,
        known_ads: page.knownAds,
        sample_ad_ids: parsed.sampleAdIds,
      })}
    where id = '${runId}'::uuid;`);
    results.push({
      pageId: page.id,
      metaPageId: page.pageId,
      cohort: page.cohort,
      runId,
      tier,
      success,
      adsSeen: parsed.adsSeen,
      confirmedAbsence: parsed.confirmedAbsence,
      credits: attempt.credits,
      durationMs: attempt.durationMs,
      httpStatus: attempt.httpStatus,
      requestId: attempt.requestId,
    });
    console.log(`[${index + 1}/${pages.length}] ${page.cohort} page=${page.pageId} tier=${tier} ads=${parsed.adsSeen} credits=${attempt.credits} ${attempt.durationMs}ms`);
  } catch (error) {
    sql(`update research.ad_fetch_runs set
      completed_at = now(),
      status = 'failed',
      error = ${sqlValue(String(error.message).slice(0, 500))},
      result_summary = ${sqlValue({ pilot: true, cohort: page.cohort, error: error.message })}
    where id = '${runId}'::uuid;`);
    results.push({ pageId: page.id, cohort: page.cohort, runId, success: false, error: error.message });
    console.error(`[${index + 1}/${pages.length}] ${page.cohort} page=${page.pageId} FAILED: ${error.message}`);
  }
}

const usageAfter = await scrapingBeeUsage();

// --- Reconciliation & projection ----------------------------------------------

const successes = results.filter((r) => r.success);
const byCohort = {};
for (const cohort of Object.keys(limits)) {
  const rows = results.filter((r) => r.cohort === cohort);
  byCohort[cohort] = {
    attempted: rows.length,
    succeeded: rows.filter((r) => r.success).length,
    withAds: rows.filter((r) => r.success && r.adsSeen > 0).length,
    zeroAds: rows.filter((r) => r.success && r.adsSeen === 0).length,
    failed: rows.filter((r) => !r.success).length,
    credits: rows.reduce((sum, r) => sum + (r.credits || 0), 0),
    avgDurationMs: rows.length ? Math.round(rows.reduce((s, r) => s + (r.durationMs || 0), 0) / rows.length) : null,
  };
}
const attemptedCount = results.length || 1;
const avgCredits = creditsSpent / attemptedCount;
const projectedFullFillCredits = Math.round(avgCredits * totalFullFillPages);
const projectedWithinCap = projectedFullFillCredits <= monthlyCap;

const report = {
  ranAt: new Date().toISOString(),
  cohorts: limits,
  selected: pages.length,
  byCohort,
  totals: {
    attempted: results.length,
    succeeded: successes.length,
    stealthRetries,
    creditsSpent,
    avgCreditsPerPage: Number(avgCredits.toFixed(3)),
  },
  projection: {
    fullFillPages: totalFullFillPages,
    projectedFullFillCredits,
    monthlyCap,
    withinCap: projectedWithinCap,
  },
  usage: { before: usageBefore, after: usageAfter },
  headerVsUsageNote:
    "credits reconcile: sum(Spb-cost/Spb-auto-cost response headers) vs usage endpoint delta",
  results,
};

console.log("\n=== Pilot summary ===");
console.log(JSON.stringify({ byCohort, totals: report.totals, projection: report.projection }, null, 2));
console.log(projectedWithinCap
  ? `Projected full-fill cost ${projectedFullFillCredits} credits is within the monthly cap (${monthlyCap}).`
  : `ABORT FULL FILL: projected cost ${projectedFullFillCredits} credits exceeds the monthly cap (${monthlyCap}).`);

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Report written to ${outPath}`);
}
