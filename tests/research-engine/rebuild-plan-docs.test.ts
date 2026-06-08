import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const simplificationReviewPath = "docs/research-engine/simplification-review.md";
const apifyTaskPath = "docs/research-engine/codex-task-apify-cost-controls.md";

const simplificationReview = read(simplificationReviewPath);
const apifyTask = read(apifyTaskPath);

test("research rebuild docs define evidence-backed ad canaries", () => {
  const docs = `${simplificationReview}\n${apifyTask}`;

  for (const phrase of [
    "Known-good ad canaries",
    "realestate.com.au",
    "Domain",
    "Ray White Group",
    "WA branch",
    "two consecutive green captures",
    "last_known_good_ad_id",
    "last_known_good_run_id",
    "last_known_good_at",
    "research-raw-evidence",
    "explicit empty-state marker",
  ]) {
    assert.match(docs, literal(phrase), `${phrase} must be part of the canary contract`);
  }
});

test("research rebuild docs make Apify a capped fallback capture path", () => {
  const docs = `${simplificationReview}\n${apifyTask}`;

  for (const phrase of [
    "maxTotalChargedUsd",
    "maxResults",
    "HERMES_META_CAPTURE_RESULTS_LIMIT",
    "GET /v2/users/me/limits",
    "apify_monthly_cap_usd",
    "apify_per_run_cap_usd",
    "ad_fetch_runs.cost_usd",
    "v_health",
    "paid_spend_without_ingest",
    "apify_account_limit_usd",
    "PUT /v2/users/me/limits",
    "runtime_settings",
    "Fallback-only dispatch",
  ]) {
    assert.match(docs, literal(phrase), `${phrase} must be documented for Apify cost control`);
  }
});

test("research rebuild docs ban the expensive official Apify actor", () => {
  const docs = `${simplificationReview}\n${apifyTask}`;

  assert.match(
    docs,
    /apify\/facebook-ads-scraper[\s\S]{0,120}\bbanned\b|\bbanned\b[\s\S]{0,120}apify\/facebook-ads-scraper/i,
    "apify/facebook-ads-scraper must be explicitly banned",
  );
  assert.match(
    docs,
    /Autonomous cheapest-actor selection|Autonomous cheapest-actor/i,
    "the plan must include autonomous cheapest-actor selection",
  );
  assert.match(
    docs,
    /maxTotalChargedUsd\s*(?:<=|=)\s*0\.25[\s\S]{0,120}maxResults\s*(?:<=|=)\s*50/i,
    "actor benchmarks must be capped below production run limits",
  );
  assert.match(
    docs,
    /candidate[\s\S]{0,220}never auto-run an unvetted actor outside the capped benchmark/i,
    "unvetted actor candidates must not be eligible for production dispatch",
  );
});

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function literal(value: string): RegExp {
  return new RegExp(escapeRegExp(value), "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
