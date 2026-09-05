/**
 * Offline verification for the Ad Radar v2 lifecycle/credit repair.
 *
 * No database required: these tests verify the applied migration files and
 * the supervisor/pilot source invariants that the review demanded. Migration
 * checksums are re-verified against the ledger rows recorded in
 * 202609050007, so any post-apply edit to an applied migration fails here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join("supabase", "migrations");
const migration = (name) => readFileSync(join(migrationsDir, name), "utf8");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const M005 = "202609050005_lifecycle_repair_attempts_credit_budget.sql";
const M006 = "202609050006_lifecycle_repeat_call_fix.sql";
const M007 = "202609050007_credit_cap_and_ledger_backfill.sql";

// --- Ledger integrity ----------------------------------------------------------

test("ledger rows in 007 carry the exact checksums of the applied migration files", () => {
  const m007 = migration(M007);
  for (const [name, version] of [[M005, "202609050005"], [M006, "202609050006"]]) {
    const fileChecksum = sha256(migration(name));
    const ledgerRow = m007.match(new RegExp(`\\('${version}',\\s*'${name}',\\s*'([0-9a-f]{64})'`));
    assert.ok(ledgerRow, `007 must record a ledger row for ${version}`);
    assert.equal(ledgerRow[1], fileChecksum, `ledger checksum for ${version} must match the file on disk`);
  }
});

test("005 records ledger rows for the four previously applied migrations", () => {
  const m005 = migration(M005);
  for (const version of ["202609050001", "202609050002", "202609050003", "202609050004"]) {
    assert.match(m005, new RegExp(`'${version}'`), `005 must backfill the ledger row for ${version}`);
  }
});

// --- Lifecycle function invariants (005 + 006) ----------------------------------

test("mark_missing_ads_inactive only changes lifecycle on complete comparable runs", () => {
  const body = migration(M006);
  assert.match(body, /v_run\.status <> 'success'/);
  assert.match(body, /coalesce\(v_run\.coverage_complete, false\) <> true/);
  assert.match(body, /coalesce\(v_run\.pagination_exhausted, false\) <> true/);
  assert.match(body, /'reason', 'run_not_complete_comparable'/);
});

test("mark_missing_ads_inactive is callable repeatedly within one transaction", () => {
  const body = migration(M006);
  assert.match(body, /drop table if exists _seen_ads;/);
  assert.match(body, /create temp table _seen_ads on commit drop/);
});

test("the _seen_ads temp table uses valid SQL (no alias on unnest select list)", () => {
  for (const name of [M005, M006]) {
    const body = migration(name);
    assert.doesNotMatch(
      body,
      /select distinct unnest\([^)]*\) as external_ad_id\s+where/,
      `${name}: invalid "select distinct unnest(...) as x where" pattern must not exist`,
    );
    assert.match(body, /from unnest\(p_seen_external_ad_ids\) as x\s+where x is not null/);
  }
});

test("a single miss is lifecycle-neutral; inactivity requires two consecutive misses", () => {
  const body = migration(M006);
  // First miss only stamps the miss counter and missing_since.
  assert.match(body, /missing_successive_checks = least\(99, coalesce\(oa\.missing_successive_checks, 0\) \+ 1\)/);
  assert.match(body, /missing_since = coalesce\(oa\.missing_since, v_checked_at\)/);
  // Inactive flip requires >= 2 consecutive complete comparable misses.
  assert.match(body, /oa\.missing_successive_checks >= 2/);
});

test("disappearance never invents a source delivery stop date", () => {
  const body = migration(M006);
  assert.doesNotMatch(body, /source_delivery_stopped_at\s*=/);
  assert.doesNotMatch(body, /delivery_stopped/);
  assert.doesNotMatch(body, /inactive_from/);
  assert.match(body, /-- Delivery dates come from the source only; an ad disappearing from a scan\n\s*-- never invents a stopped date\./);
});

test("reactivation from inactive to active is handled on reappearance", () => {
  const body = migration(M006);
  assert.match(body, /active_status = 'active',\s+reactivated_at = v_checked_at/);
});

// --- Credit budget invariants (005 + 007) ----------------------------------------

test("reserve_provider_credits is a single row-locked atomic UPDATE", () => {
  const m005 = migration(M005);
  const fn = m005.slice(m005.indexOf("function research.reserve_provider_credits"), m005.indexOf("settle_provider_credits"));
  assert.match(fn, /for update/);
  assert.match(fn, /max_credits - b\.reserved_credits - b\.spent_credits >= p_credits/);
  assert.match(fn, /returning b\.id into v_budget_id/);
  assert.match(fn, /credit_budget_exhausted/);
});

test("007 adds a 3-arg reserve overload enforcing the external monthly cap atomically", () => {
  const m007 = migration(M007);
  assert.match(m007, /function research\.reserve_provider_credits\(\s*p_provider text,\s*p_credits numeric,\s*p_max_credits numeric\s*\)/);
  assert.match(m007, /<= least\(b\.max_credits, coalesce\(p_max_credits, b\.max_credits\)\)/);
});

test("settle decrements the reservation and accumulates actual spend", () => {
  const m005 = migration(M005);
  assert.match(m005, /reserved_credits = greatest\(0, reserved_credits - coalesce\(p_reserved, 0\)\)/);
  assert.match(m005, /spent_credits = spent_credits \+ coalesce\(p_actual, 0\)/);
});

test("ad_fetch_attempts records every provider request with ScrapingBee receipts", () => {
  const m005 = migration(M005);
  assert.match(m005, /create table if not exists research\.ad_fetch_attempts/);
  assert.match(m005, /spb_cost numeric/);
  assert.match(m005, /spb_auto_cost numeric/);
  assert.match(m005, /spb_request_id text/);
  assert.match(m005, /outcome text not null\s+check \(outcome in \('success', 'blocked', 'unparseable', 'error'\)\)/);
});

test("007 models the fresh 1,000-credit allocation as a new budget period", () => {
  const m007 = migration(M007);
  assert.match(m007, /values \('scrapingbee', current_date, 1000, 0\)/);
});

// --- Supervisor enforcement (source-level, offline) -------------------------------

const supervisorPath = "hermes/tools/research-runtime/bin/supabase-supervisor.mjs";
const supervisor = readFileSync(supervisorPath, "utf8");

test("ScrapingBee is disabled in the supervisor unless explicitly enabled", () => {
  assert.match(
    supervisor,
    /const scrapingBeeEnabled = env\.HERMES_SCRAPINGBEE_ENABLED === "true" && Boolean\(scrapingBeeApiKey\.trim\(\)\);/,
  );
});

test("the monthly credit cap is enforced inside the atomic reservation", () => {
  assert.match(supervisor, /p_max_credits: scrapingBeeMonthlyCreditCap/);
  assert.match(supervisor, /positiveInt\("HERMES_SCRAPINGBEE_MONTHLY_CREDIT_CAP"/);
});

test("a failed paid ScrapingBee attempt is never followed by a second paid attempt", () => {
  assert.match(supervisor, /let scrapingBeeAttempted = false;/);
  assert.match(supervisor, /if \(!scrapingBeeEnabled \|\| scrapingBeeAttempted\) return null;/);
  assert.match(supervisor, /scrapingBeeAttempted = true;/);
});

test("paid failed attempts are recorded, never dropped", () => {
  assert.match(supervisor, /async function recordAdFetchAttempt/);
  assert.match(supervisor, /"ad_fetch_attempts"/);
});

test("/usage is cached and used for reconciliation only, never as the gate", () => {
  assert.match(supervisor, /Date\.now\(\) - scrapingBeeUsageCache\.at < 20_000/);
  assert.match(supervisor, /Informational only\./);
});

test("coverage_complete derives only from page_info, never from result-list size", () => {
  assert.match(supervisor, /const paginationExhausted = classified\.pageInfo\.hasNextPage === false;/);
  assert.match(supervisor, /const coverageComplete = confirmedAbsence \|\| paginationExhausted;/);
});

test("supervisor uses the shared deterministic parser", () => {
  assert.match(supervisor, /import \{ classifyMetaAdLibraryPayload \} from "\.\/meta-ad-library-parser\.mjs";/);
});

// --- Pilot defaults (source-level, offline) ---------------------------------------

const pilot = readFileSync("scripts/research/scrapingbee-pilot.mjs", "utf8");

test("pilot is dry-run by default and never touches the provider before --live", () => {
  assert.match(pilot, /const live = args\.live === true;/);
  const dryRunExit = pilot.indexOf("would scan");
  const firstProviderFetch = pilot.indexOf("app.scrapingbee.com/api/v1/?");
  const dryRunGuard = pilot.indexOf("if (!live) {");
  assert.ok(dryRunGuard > 0 && dryRunGuard < firstProviderFetch, "the !live guard must precede any provider call");
  assert.ok(dryRunExit > 0 && dryRunExit < firstProviderFetch);
});

test("pilot has no automatic stealth retries", () => {
  assert.match(pilot, /const stealthRetryBudget = Number\(args\["stealth-retry"\] \?\? 0\); \/\/ default: never/);
  // The stealth path must be gated on the explicit remaining budget.
  assert.match(pilot, /if \(blocked && stealthRetries < stealthRetryBudget\) \{/);
  assert.match(pilot, /NO automatic stealth/);
});

test("pilot caches /usage instead of calling it before every page", () => {
  assert.match(pilot, /Date\.now\(\) - usageCache\.at < 65_000/);
  const usageCallCount = (pilot.match(/app\.scrapingbee\.com\/api\/v1\/usage/g) || []).length;
  assert.equal(usageCallCount, 1, "usage endpoint must be referenced exactly once (inside cachedUsage)");
});

test("pilot uses the shared parser and the atomic DB budget", () => {
  assert.match(pilot, /import \{ classifyMetaAdLibraryPayload \} from "\.\.\/\.\.\/hermes\/tools\/research-runtime\/bin\/meta-ad-library-parser\.mjs";/);
  assert.match(pilot, /reserve_provider_credits\('scrapingbee', \$\{cost\}, \$\{monthlyCap\}\)/);
  assert.match(pilot, /settle_provider_credits/);
});

test("pilot reserves credits before each paid request and settles with actual Spb-cost", () => {
  assert.match(pilot, /budgetId = reserveCredits\(maxCost\);/);
  assert.match(pilot, /settleCredits\(budgetId, maxCost, attempt\.credits\);/);
});
