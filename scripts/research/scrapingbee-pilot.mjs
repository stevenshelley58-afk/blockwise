#!/usr/bin/env node
/**
 * scrapingbee-pilot.mjs — ScrapingBee validation pilot (Ad Radar v2).
 *
 * DRY-RUN BY DEFAULT: without --live the pilot prints the cohort plan,
 * estimated cost and DB budget state and makes ZERO provider calls and ZERO
 * writes. Pass --live to actually spend credits.
 *
 * Cohorts (plan §8 defaults):
 *   30 pages with historical ads
 *   50 pages with no known ads (previous zero-ad / no_ads_confirmed)
 *   20 never-checked pages
 *
 * Rules:
 *   - Auto-Mode (mode=auto) capped at 25 credits per request via max_cost.
 *   - NO automatic stealth retries. Stealth costs 75 credits per request and
 *     is only used when --stealth-retry=N explicitly allows up to N of them
 *     against blocked pages, each backed by its own atomic reservation.
 *   - No ScrapingBee AI extraction. No video bytes through ScrapingBee.
 *   - Shared deterministic parser (meta-ad-library-parser.mjs) — the same
 *     module the production supervisor uses. Challenge/login walls are
 *     failures, never zero-ad results.
 *   - Pagination evidence comes ONLY from page_info.has_next_page.
 *   - Atomic DB credit budget: every request reserves first via
 *     research.reserve_provider_credits('scrapingbee', cost, monthly-cap)
 *     and settles with the actual Spb-cost. The reservation fails closed.
 *   - One row per provider request in research.ad_fetch_attempts, regardless
 *     of outcome; paid failed attempts are never dropped.
 *   - /usage is rate-limited to 6 calls/min: fetched once before the loop,
 *     refreshed at most every 65 s, and once after. It informs the floor
 *     check only; the DB budget is the spending authority.
 *
 * Usage:
 *   SCRAPINGBEE_API_KEY=... node scripts/research/scrapingbee-pilot.mjs          # dry run
 *   SCRAPINGBEE_API_KEY=... node scripts/research/scrapingbee-pilot.mjs --live \
 *     [--limit-historical=30] [--limit-zero-ad=50] [--limit-never-checked=20] \
 *     [--monthly-cap=800] [--max-cost=25] [--stealth-retry=0] [--out=/root/pilot-report.json]
 *
 * DB access defaults to `docker exec blockwise-research-db psql`; override
 * with RESEARCH_DB_CONTAINER or RESEARCH_DB_PSQL (full psql command prefix).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyMetaAdLibraryPayload } from "../../hermes/tools/research-runtime/bin/meta-ad-library-parser.mjs";

const debugDir = process.env.PILOT_DEBUG_DIR || "/root/pilot-debug";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([a-z-]+)(?:=(.*))?$/iu.exec(arg);
  return match ? [match[1], match[2] === undefined ? true : match[2]] : [arg, true];
}));

const live = args.live === true;
const apiKey = process.env.SCRAPINGBEE_API_KEY || process.env.HERMES_SCRAPINGBEE_API_KEY || "";
if (live && !apiKey) {
  console.error("SCRAPINGBEE_API_KEY is required for --live runs.");
  process.exit(2);
}

const limits = {
  historical: Number(args["limit-historical"] ?? 30),
  zero_ad: Number(args["limit-zero-ad"] ?? 50),
  never_checked: Number(args["limit-never-checked"] ?? 20),
};
const maxCost = Math.min(Number(args["max-cost"] ?? 25), 25); // mode=auto caps at the 25-credit tier
const monthlyCap = Number(args["monthly-cap"] ?? 200_000);
const stealthRetryBudget = Number(args["stealth-retry"] ?? 0); // default: never
const STEALTH_COST = 75;
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
  return execFileSync(psqlPrefix[0], psqlPrefix.slice(1), {
    input: query,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

function sqlRows(query) {
  return sql(query).split("\n").filter((line) => line.length > 0).map((line) => line.split("\x1f"));
}

// --- Atomic DB credit budget ---------------------------------------------------

function reserveCredits(cost) {
  const rows = sqlRows(
    `select research.reserve_provider_credits('scrapingbee', ${cost}, ${monthlyCap});`,
  );
  return rows[0]?.[0] ?? null;
}

function settleCredits(budgetId, reserved, actual) {
  if (!budgetId) return;
  try {
    sql(`select research.settle_provider_credits('${budgetId}', ${reserved}, ${actual});`);
  } catch (error) {
    console.error(`WARNING: credit settle failed (budget ${budgetId}): ${error.message}`);
  }
}

function budgetState() {
  const rows = sqlRows(`
    select coalesce(max_credits, 0), coalesce(reserved_credits, 0), coalesce(spent_credits, 0)
    from research.provider_credit_budgets where provider = 'scrapingbee'
    order by period_start desc limit 1;
  `);
  if (rows.length === 0) return null;
  const [max, reserved, spent] = rows[0].map(Number);
  return { max, reserved, spent, remaining: Math.max(0, max - reserved - spent) };
}

// --- Cohort selection --------------------------------------------------------

const cohortQueries = {
  historical: `
    select ap.id::text, ap.page_id, ap.page_name,
           (select count(*) from research.observed_ads oa where oa.advertiser_page_id = ap.id) as known_ads
    from research.advertiser_pages ap
    where ap.page_id is not null
      and ap.page_id ~ '^[0-9]+$'
      and exists (select 1 from research.observed_ads oa where oa.advertiser_page_id = ap.id)
    order by known_ads desc, ap.last_checked_at asc nulls first
    limit ${limits.historical};`,
  zero_ad: `
    select ap.id::text, ap.page_id, ap.page_name, 0::bigint as known_ads
    from research.advertiser_pages ap
    where ap.page_id is not null
      and ap.page_id ~ '^[0-9]+$'
      and ap.last_successful_check_at is not null
      and not exists (select 1 from research.observed_ads oa where oa.advertiser_page_id = ap.id)
    order by ap.last_checked_at asc
    limit ${limits.zero_ad};`,
  never_checked: `
    select ap.id::text, ap.page_id, ap.page_name, 0::bigint as known_ads
    from research.advertiser_pages ap
    where ap.page_id is not null
      and ap.page_id ~ '^[0-9]+$'
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
const queues = new Map();
for (const page of pages) {
  if (!queues.has(page.cohort)) queues.set(page.cohort, []);
  queues.get(page.cohort).push(page);
}
const interleaved = [];
while (interleaved.length < pages.length) {
  for (const queue of queues.values()) {
    const next = queue.shift();
    if (next) interleaved.push(next);
  }
}
pages.length = 0;
pages.push(...interleaved);
console.log(`Pilot cohorts: ${JSON.stringify(Object.entries(limits))}; selected ${pages.length} pages (interleaved).`);

const projectedCost = pages.length * maxCost + Math.min(stealthRetryBudget, pages.length) * STEALTH_COST;
const budget = budgetState();
if (budget) {
  console.log(`DB credit budget: ${budget.spent}/${budget.max} spent, ${budget.reserved} reserved, ${budget.remaining} remaining.`);
}
console.log(`Projected pilot cost: up to ${projectedCost} credits (${pages.length} pages x ${maxCost}${stealthRetryBudget > 0 ? ` + up to ${stealthRetryBudget} stealth x ${STEALTH_COST}` : ""}).`);
if (budget && budget.remaining < projectedCost) {
  console.error(`ABORT: DB budget remaining ${budget.remaining} is below the projected cost ${projectedCost}.`);
  process.exit(3);
}
if (!live) {
  console.log("\nDRY RUN (default): no provider calls, no DB writes. Pass --live to spend credits.");
  for (const page of pages.slice(0, 10)) {
    console.log(`  would scan ${page.cohort} page_id=${page.pageId} knownAds=${page.knownAds}`);
  }
  console.log(`  ... and ${Math.max(0, pages.length - 10)} more.`);
  process.exit(0);
}

// --- ScrapingBee helpers -------------------------------------------------------

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

// /usage is limited to 6 calls/min — cached aggressively; the DB budget is
// the spending authority, this is only a floor guard.
let usageCache = { at: 0, value: null };
async function cachedUsage() {
  if (usageCache.value && Date.now() - usageCache.at < 65_000) return usageCache.value;
  const response = await fetch(`https://app.scrapingbee.com/api/v1/usage?api_key=${encodeURIComponent(apiKey)}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`usage endpoint failed ${response.status}`);
  usageCache = { at: Date.now(), value: await response.json() };
  return usageCache.value;
}

// Usage endpoint returns max_api_credit / used_api_credit (plan credits).
function usageSummary(usage) {
  const max = Number(usage?.max_api_credit ?? usage?.totalRequestLimit ?? usage?.credit?.limit ?? 0);
  const used = Number(usage?.used_api_credit ?? usage?.totalRequestUsed ?? usage?.credit?.used ?? 0);
  return { max, used, remaining: Math.max(0, max - used), concurrency: usage?.max_concurrency ?? null };
}

async function creditsRemaining() {
  try {
    return usageSummary(await cachedUsage()).remaining;
  } catch (error) {
    console.error(`Usage check failed (${error.message}); treating remaining as 0 for the floor guard (DB budget still gates).`);
    return 0;
  }
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
  const spbCost = header("spb-cost");
  const spbAutoCost = header("spb-auto-cost");
  const credits = Number(spbCost ?? spbAutoCost ?? 0) || 0;
  const requestId = header("spb-request-id") || null;
  const initialStatus = Number(header("spb-initial-status-code") || NaN);
  return {
    httpStatus: response.status,
    initialStatus: Number.isNaN(initialStatus) ? null : initialStatus,
    credits,
    spbCost: spbCost === null ? null : Number(spbCost),
    spbAutoCost: spbAutoCost === null ? null : Number(spbAutoCost),
    requestId,
    htmlBytes: html.length,
    durationMs: Date.now() - started,
    html,
    bodySnippet: html.length <= 400 ? html : "",
  };
}

async function recordAttempt({ runId, page, tier, attempt, outcome, error, startedAt }) {
  try {
    sql(`insert into research.ad_fetch_attempts (
      ad_fetch_run_id, advertiser_page_id, provider, attempt_index, idempotency_key, tier,
      request_url_host, request_params, http_status, provider_http_status,
      spb_cost, spb_auto_cost, spb_request_id, credits_charged, cost_usd,
      outcome, response_bytes, duration_ms, error, started_at, completed_at
    ) values (
      ${runId ? `'${runId}'::uuid` : "null"}, '${page.id}'::uuid, 'scrapingbee_meta_ad_library', 1,
      ${sqlValue(`pilot:${page.id}:${startedAt}`)}, ${sqlValue(tier)},
      'app.scrapingbee.com', ${sqlValue({ mode: stealthCostTier(tier), max_cost: maxCost, target_host: "www.facebook.com" })},
      ${attempt?.httpStatus ?? "null"}, ${attempt?.initialStatus ?? "null"},
      ${attempt?.spbCost ?? "null"}, ${attempt?.spbAutoCost ?? "null"}, ${sqlValue(attempt?.requestId ?? null)},
      ${attempt?.credits ?? 0}, ${((attempt?.credits ?? 0) * 0.001).toFixed(6)},
      ${sqlValue(outcome)}, ${attempt?.htmlBytes ?? "null"}, ${attempt?.durationMs ?? "null"},
      ${sqlValue(error ?? null)}, ${sqlValue(new Date(startedAt).toISOString())}, ${sqlValue(new Date().toISOString())}
    );`);
  } catch (dbError) {
    console.error(`WARNING: ad_fetch_attempts insert failed: ${dbError.message}`);
  }
}

function stealthCostTier(tier) {
  return tier === "stealth_proxy" ? "stealth_proxy" : "auto";
}

// --- Pilot loop ---------------------------------------------------------------

const usageBefore = await cachedUsage();
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
  const remaining = await creditsRemaining(); // cached; refreshed at most every 65 s
  if (remaining <= creditFloor + maxCost) {
    console.error(`STOP: ${remaining} credits remaining (cached), floor ${creditFloor} + max cost ${maxCost}; halting before page ${index + 1}.`);
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
  let outcome = "success";
  let error = null;
  try {
    // Atomic reservation BEFORE spending; fails closed when the budget
    // (or the --monthly-cap ceiling) cannot cover the worst case.
    let budgetId;
    try {
      budgetId = reserveCredits(maxCost);
    } catch (reserveError) {
      console.error(`STOP: credit reservation failed: ${String(reserveError.message).split("\n")[0]}`);
      break;
    }
    attempt = await fetchViaScrapingBee({ url });
    creditsSpent += attempt.credits;
    const classified = classifyMetaAdLibraryPayload(attempt.html);
    const blocked = attempt.httpStatus >= 400 || attempt.httpStatus === 429
      || attempt.initialStatus === 403 || attempt.initialStatus === 429
      || classified.outcome === "challenge" || classified.outcome === "login_wall";
    if (classified.outcome === "unparseable") {
      outcome = "unparseable";
      error = "payload could not be parsed";
    } else if (blocked) {
      outcome = "blocked";
      error = classified.outcome === "challenge" ? "challenge_detected"
        : classified.outcome === "login_wall" ? "login_wall"
        : `http_${attempt.httpStatus}${attempt.initialStatus ? `_initial_${attempt.initialStatus}` : ""}`;
    }
    await recordAttempt({ runId, page, tier, attempt, outcome, error, startedAt: Date.now() - (attempt?.durationMs ?? 0) });

    // NO automatic stealth. Only an explicit --stealth-retry budget allows
    // one, each with its own atomic reservation against the DB budget.
    if (blocked && stealthRetries < stealthRetryBudget) {
      const stealthRemaining = budget.remaining - creditsSpent;
      if (stealthRemaining < STEALTH_COST) {
        console.error(`  stealth skipped: budget remaining ${stealthRemaining} < ${STEALTH_COST}`);
      } else {
        let stealthBudgetId;
        try {
          stealthBudgetId = reserveCredits(STEALTH_COST);
        } catch {
          console.error("  stealth skipped: reservation failed");
        }
        if (stealthBudgetId) {
          stealthRetries += 1;
          tier = "stealth_proxy";
          const stealth = await fetchViaScrapingBee({ url, stealth: true });
          creditsSpent += stealth.credits;
          const stealthClassified = classifyMetaAdLibraryPayload(stealth.html);
          attempt = stealth;
          Object.assign(classified, stealthClassified);
          const stealthOk = stealthClassified.outcome === "success" || stealthClassified.outcome === "partial"
            || stealthClassified.outcome === "confirmed_absence";
          outcome = stealthOk ? "success" : stealthClassified.outcome === "unparseable" ? "unparseable" : "blocked";
          error = stealthOk ? null : `stealth_${outcome}`;
          await recordAttempt({ runId, page, tier, attempt: stealth, outcome, error, startedAt: Date.now() - (stealth?.durationMs ?? 0) });
          settleCredits(stealthBudgetId, STEALTH_COST, stealth.credits);
        }
      }
    }
    settleCredits(budgetId, maxCost, attempt.credits);

    // Shared parser classification. Challenge/login walls are failures,
    // NEVER zero-ad results; only the connection itself confirms absence.
    const success = classified.outcome === "success" || classified.outcome === "partial"
      || classified.outcome === "confirmed_absence";
    // Pagination evidence ONLY from page_info.has_next_page.
    const paginationExhausted = success && classified.pageInfo.hasNextPage === false;
    if (classified.outcome === "unparseable" && attempt.httpStatus === 200) {
      // Persist unparseable payloads so variants can be diagnosed offline
      // without re-spending.
      try {
        mkdirSync(debugDir, { recursive: true });
        writeFileSync(`${debugDir}/${page.pageId}-${Date.now()}.html`, attempt.html.slice(0, 2_000_000));
      } catch { /* best effort */ }
    }
    sql(`update research.ad_fetch_runs set
      completed_at = now(),
      status = ${success ? "'success'" : "'failed'"},
      source_provider = 'scrapingbee_meta_ad_library',
      error = ${sqlValue(success ? null : error)},
      provider_request_count = ${tier === "stealth_proxy" ? 2 : 1},
      provider_credits = ${attempt.credits},
      provider_cost_usd = null,
      scrapingbee_tier = ${sqlValue(tier)},
      scraper_run_id = ${sqlValue(attempt.requestId)},
      coverage_complete = ${success ? (classified.outcome === "confirmed_absence" || paginationExhausted) : "null"},
      pagination_exhausted = ${success ? paginationExhausted : "null"},
      stop_reason = ${sqlValue(success ? (classified.outcome === "confirmed_absence" ? "confirmed_absence" : paginationExhausted ? "page_exhausted" : "results_limit_reached") : "blocked_or_unparseable")},
      dataset_checksum = md5(${sqlValue(JSON.stringify(classified.adIds.slice(0, 10)))}),
      result_summary = ${sqlValue({
        pilot: true,
        cohort: page.cohort,
        tier,
        outcome: classified.outcome,
        ads_seen: classified.adIds.length,
        connection_count: classified.connectionCount,
        confirmed_absence: classified.outcome === "confirmed_absence",
        challenge_detected: classified.outcome === "challenge",
        login_wall: classified.outcome === "login_wall",
        has_next_page: classified.pageInfo.hasNextPage,
        end_cursor: classified.pageInfo.endCursor,
        html_bytes: attempt.htmlBytes,
        http_status: attempt.httpStatus,
        spb_initial_status: attempt.initialStatus,
        ...(attempt.bodySnippet ? { error_body: attempt.bodySnippet } : {}),
        duration_ms: attempt.durationMs,
        known_ads: page.knownAds,
        sample_ad_ids: classified.adIds.slice(0, 10),
      })}
    where id = '${runId}'::uuid;`);
    results.push({
      pageId: page.id,
      metaPageId: page.pageId,
      cohort: page.cohort,
      runId,
      tier,
      success,
      outcome: classified.outcome,
      adsSeen: classified.adIds.length,
      confirmedAbsence: classified.outcome === "confirmed_absence",
      hasNextPage: classified.pageInfo.hasNextPage,
      credits: attempt.credits,
      durationMs: attempt.durationMs,
      httpStatus: attempt.httpStatus,
      requestId: attempt.requestId,
    });
    console.log(`[${index + 1}/${pages.length}] ${page.cohort} page=${page.pageId} tier=${tier} outcome=${classified.outcome} ads=${classified.adIds.length} credits=${attempt.credits} ${attempt.durationMs}ms`);
  } catch (loopError) {
    error = String(loopError.message).slice(0, 500);
    outcome = "error";
    sql(`update research.ad_fetch_runs set
      completed_at = now(),
      status = 'failed',
      error = ${sqlValue(error)},
      result_summary = ${sqlValue({ pilot: true, cohort: page.cohort, error: loopError.message })}
    where id = '${runId}'::uuid;`);
    await recordAttempt({ runId, page, tier, attempt, outcome, error, startedAt: Date.now() });
    results.push({ pageId: page.id, cohort: page.cohort, runId, success: false, error: loopError.message });
    console.error(`[${index + 1}/${pages.length}] ${page.cohort} page=${page.pageId} FAILED: ${loopError.message}`);
  }
}

// /usage exactly once after the loop for reconciliation.
let usageAfter = null;
try {
  usageCache = { at: 0, value: null };
  usageAfter = await cachedUsage();
} catch { /* reconciliation is best-effort */ }

// --- Reconciliation & projection ----------------------------------------------

const successes = results.filter((r) => r.success);
const byCohort = {};
for (const cohort of Object.keys(limits)) {
  const rows = results.filter((r) => r.cohort === cohort);
  byCohort[cohort] = {
    attempted: rows.length,
    succeeded: rows.filter((r) => r.success).length,
    withAds: rows.filter((r) => r.success && r.adsSeen > 0).length,
    zeroAds: rows.filter((r) => r.success && r.adsSeen === 0 && r.confirmedAbsence).length,
    failed: rows.filter((r) => !r.success).length,
    credits: rows.reduce((sum, r) => sum + (r.credits || 0), 0),
    avgDurationMs: rows.length ? Math.round(rows.reduce((s, r) => s + (r.durationMs || 0), 0) / rows.length) : null,
  };
}
const attemptedCount = results.length || 1;
const avgCredits = creditsSpent / attemptedCount;
const projectedFullFillCredits = Math.round(avgCredits * totalFullFillPages);
const projectedWithinCap = projectedFullFillCredits <= monthlyCap;
const finalBudget = budgetState();

const report = {
  ranAt: new Date().toISOString(),
  mode: "live",
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
  dbBudget: { before: budget, after: finalBudget },
  usage: { before: usageBefore, after: usageAfter },
  headerVsUsageNote:
    "credits reconcile: sum(Spb-cost/Spb-auto-cost response headers) vs usage endpoint delta; DB attempt rows must match both",
  results,
};

console.log("\n=== Pilot summary ===");
console.log(JSON.stringify({ byCohort, totals: report.totals, projection: report.projection, dbBudget: report.dbBudget }, null, 2));
console.log(projectedWithinCap
  ? `Projected full-fill cost ${projectedFullFillCredits} credits is within the monthly cap (${monthlyCap}).`
  : `ABORT FULL FILL: projected cost ${projectedFullFillCredits} credits exceeds the monthly cap (${monthlyCap}).`);

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Report written to ${outPath}`);
}
