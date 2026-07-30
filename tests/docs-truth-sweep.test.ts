import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

test("research engine README links only existing local docs", () => {
  const readmePath = "docs/research-engine/README.md";
  const readme = read(readmePath);
  const baseDir = dirname(join(repoRoot, readmePath));
  const localLinks = [...readme.matchAll(/\[[^\]]+\]\(([^)#][^)]+\.md)\)/g)].map((match) => match[1]);

  assert.ok(localLinks.length > 0, "expected README to link research docs");

  for (const link of localLinks) {
    assert.ok(existsSync(join(baseDir, link)), `missing linked doc: ${link}`);
  }

  assert.match(readme, /Location ad search is removed and remains disabled/);
  assert.doesNotMatch(readme, /Do not use broad location discovery/);
});

test("research env docs include active Hermes, Apify, and Meta supervisor variables", () => {
  const envDoc = read("docs/research-engine/env.md");

  for (const key of [
    "HERMES_LOCATION_AD_SEARCH_ENABLED",
    "HERMES_META_AD_LIBRARY_ACCESS_TOKEN",
    "META_AD_LIBRARY_ACCESS_TOKEN",
    "META_AD_LIBRARY_TOKEN",
    "HERMES_META_OFFICIAL_API_ENABLED",
    "APIFY_TOKEN",
    "APIFY_API_TOKEN",
  ]) {
    assert.match(envDoc, new RegExp(`\\b${key}\\b`), `expected ${key} in env docs`);
  }
});

test("production readiness references real release commands", () => {
  const readiness = read("docs/runbooks/production-readiness.md");

  assert.match(readiness, /There is no `lint` script and no `audit:repo` script/);
  assert.match(readiness, /npm run verify:hard-reset/);
  assert.match(readiness, /npm run trigger:deploy/);
  assert.match(readiness, /paid-service watchdog as the Vercel Cron configured in\s+`vercel\.json`/);
  assert.doesNotMatch(readiness, /Verify Trigger\.dev deployed tasks[^\r\n]*(?:\r?\n {2}[^\r\n]*)*paid-service watchdog/);
});

test("launch plan is marked superseded", () => {
  const launchPlan = read("docs/LAUNCH_PLAN.md");

  assert.match(launchPlan.slice(0, 200), /Superseded: use `docs\/runbooks\/production-readiness\.md`/);
});

test("rollback documents export, publish, and Trigger deploy posture", () => {
  const rollback = read("docs/runbooks/rollback.md");

  assert.match(rollback, /Manual Ad Studio export is not a provider write/);
  assert.match(rollback, /created\s+paused/i);
  assert.match(rollback, /trigger-deploy/);
  assert.match(rollback, /Missing `TRIGGER_PROJECT_ID` is a hard failure in the GitHub deploy workflow/);
});
