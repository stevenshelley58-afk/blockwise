import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CONTENT_RUN_JOB_TYPE } from "../../hermes/tools/research-runtime/bin/content-engine.mjs";
import { resolveAdRadarRuntime } from "../../hermes/tools/research-runtime/bin/ad-radar-runtime-gate.mjs";

const supervisor = readFileSync("hermes/tools/research-runtime/bin/supabase-supervisor.mjs", "utf8");
const migration = readFileSync("supabase/migrations/20260730021835_launch_disable_ad_radar.sql", "utf8");
const compose = readFileSync("infra/coolify/docker-compose.research.yml", "utf8");
const envDocs = readFileSync("docs/research-engine/env.md", "utf8");
const operatorRunbook = readFileSync("docs/research-engine/operator-runbook.md", "utf8");

test("Ad Radar shutdown claims only content work while preserving the content fast lane", () => {
  const adRadarJobTypes = ["blockwise-agent-census", "blockwise-ad-collector"];
  const disabled = resolveAdRadarRuntime({}, CONTENT_RUN_JOB_TYPE, adRadarJobTypes);
  const enabled = resolveAdRadarRuntime({ HERMES_AD_RADAR_ENABLED: "true" }, CONTENT_RUN_JOB_TYPE, adRadarJobTypes);

  assert.deepEqual(disabled, {
    adRadarEnabled: false,
    handledJobTypes: [CONTENT_RUN_JOB_TYPE],
  });
  assert.deepEqual(enabled, {
    adRadarEnabled: true,
    handledJobTypes: [...adRadarJobTypes, CONTENT_RUN_JOB_TYPE],
  });
  assert.match(supervisor, /p_job_types:\s*HANDLED_JOB_TYPES/u);
  assert.match(supervisor, /jobTypes:\s*\[CONTENT_RUN_JOB_TYPE\]/u);
});

test("Ad Radar shutdown skips every research phase without cancelling queued work", () => {
  const tickStart = supervisor.indexOf("async function tick()");
  const tickEnd = supervisor.indexOf("let lastCustomerReadModelPublishAt", tickStart);
  const tick = supervisor.slice(tickStart, tickEnd);

  assert.ok(tickStart >= 0 && tickEnd > tickStart, "tick function must remain inspectable");
  assert.match(tick, /if \(adRadarEnabled\) \{[\s\S]*ensureBuildRun\(\)[\s\S]*ensureSourceBackedRefreshPolicies\(\)[\s\S]*enqueueDueCensusJobs\(buildRunId\)[\s\S]*enqueueDueAdPageRefreshJobs\(buildRunId\)/u);
  assert.match(tick, /if \(adRadarEnabled\) \{[\s\S]*runWatchdogs\(\)[\s\S]*maybePublishCustomerReadModels\(\)[\s\S]*maybeRunAccuracyAudit\(\)[\s\S]*maybeRunInactiveAdPurge\(\)/u);
  assert.match(tick, /Ad Radar runtime phases skipped[\s\S]*adRadarEnabled:\s*false[\s\S]*HERMES_AD_RADAR_ENABLED=false/u);
  assert.match(tick, /tick complete[\s\S]*adRadarEnabled/u);
  assert.doesNotMatch(tick, /(?:delete|cancel)[\s\S]*work_queue/iu, "the disabled path must leave queued work intact");
});

test("launch migration removes client access without destructive data or object operations", () => {
  for (const table of [
    "customer_ad_radar_cards",
    "customer_ad_radar_creative_versions",
    "property_checks",
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"));
    assert.match(migration, new RegExp(`grant all on table public\\.${table} to service_role`, "i"));
  }
  assert.match(migration, /drop policy if exists customer_ad_radar_cards_public_read/i);
  assert.match(migration, /drop policy if exists customer_ad_radar_creative_versions_authenticated_read/i);
  assert.match(migration, /revoke all on function public\.search_customer_meta_ad_library_cards\(text, integer, text\) from public/i);
  assert.match(migration, /grant execute on function public\.search_customer_meta_ad_library_cards\(text, integer, text\) to service_role/i);
  assert.match(migration, /update storage\.buckets[\s\S]*set public = false[\s\S]*id = 'research-ad-creatives'/i);
  assert.doesNotMatch(migration, /\b(?:drop\s+table|truncate|delete\s+from\s+(?:storage\.objects|public\.(?:customer_ad_radar_cards|customer_ad_radar_creative_versions|property_checks)))/i);
});

test("launch defaults disable Ad Radar while keeping the global runtime available", () => {
  assert.match(compose, /BLOCKWISE_RESEARCH_RUNTIME_ENABLED:\s*\$\{BLOCKWISE_RESEARCH_RUNTIME_ENABLED:-true\}/u);
  assert.match(compose, /HERMES_AD_RADAR_ENABLED:\s*\$\{HERMES_AD_RADAR_ENABLED:-false\}/u);
  assert.match(envDocs, /HERMES_AD_RADAR_ENABLED[\s\S]*`false`[\s\S]*blockwise-content-run-orchestrator/u);
  assert.match(operatorRunbook, /HERMES_AD_RADAR_ENABLED=false[\s\S]*content-engine fast lane/u);
});
