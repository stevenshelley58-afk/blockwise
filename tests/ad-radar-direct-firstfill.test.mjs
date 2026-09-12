import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const supervisor = readFileSync(new URL('../hermes/tools/research-runtime/bin/supabase-supervisor.mjs', import.meta.url),'utf8');
const launcher = readFileSync(new URL('../scripts/vps/hermes-ad-db-first-fill-launcher.sh', import.meta.url),'utf8');
test('dedicated first fill enables Ad Radar independently of maintenance', () => {
 assert.match(launcher, /HERMES_AD_RADAR_ENABLED=true/);
 assert.match(supervisor, /if \(!firstFillOnly && !adPageRefreshEnabled\)/);
 assert.match(supervisor, /adRadarEnabled && \(firstFillOnly \|\| adPageRefreshEnabled\)/);
});
test('pending billing returns durable deferred work before terminal capture handling', () => {
 const pending = supervisor.indexOf('sourceProvider === "apify" && outcome.metadata?.billingPending');
 const failure = supervisor.indexOf('if (!["SUCCEEDED", "SUCCEEDED_PARTIAL"].includes(outcome.status))');
 assert.ok(pending > 0 && pending < failure);
 assert.match(supervisor, /outcome.status === "deferred"/);
 assert.match(supervisor, /available_at: new Date\(Date.now\(\) \+ 300_000\)/);
 assert.match(supervisor, /last_error: "apify_billing_pending"/);
});

test('scheduler loads the ownership evidence used by its WA gate', () => {
 assert.ok(supervisor.includes('agent:agents(state,status),agency:agencies(state,status)'));
 assert.ok(supervisor.includes('log("first-fill scheduling", scheduled)'));
});

test('purchased results reconcile before scheduling fresh paid captures', () => {
 const worker = supervisor.slice(supervisor.indexOf('async function runAdDbWorkerPass()'));
 assert.ok(worker.indexOf('last_error=eq.apify_billing_pending') < worker.indexOf('await enqueueDueAdPageRefreshJobs'));
});

test('first-fill page registry is exhaustive and failed attempts are not silently reset', () => {
 assert.ok(supervisor.includes('offset += adPageRefreshScanLimit'));
 assert.ok(supervisor.includes('pagePath + "&offset=" + offset'));
 assert.ok(supervisor.includes('recyclable && firstFillOnly && input.job_type === "blockwise-ad-collector"'));
 assert.ok(supervisor.includes('status=in.(pending,claimed,failed,blocked)&limit=5000'));
});

test('media failures and assets beyond the capture batch cannot report completion', () => {
 assert.ok(supervisor.includes('const archiveComplete = failed === 0 && remaining.length === 0'));
 assert.ok(supervisor.includes('blocked_reason: archiveComplete ? null : "media_archive_incomplete"'));
});

test('release installs locked image runtime before import preflight', () => {
 const release = readFileSync(new URL('../scripts/vps/hermes-ad-db-release.sh', import.meta.url),'utf8');
 assert.ok(release.indexOf('npm ci --omit=dev --ignore-scripts') < release.indexOf('"$launcher" --preflight'));
 const imports = readFileSync(new URL('../scripts/vps/hermes-ad-db-runtime-imports.mjs', import.meta.url),'utf8');
 assert.ok(imports.includes('await import("sharp")'));
 assert.ok(imports.includes('sharp.versions?.vips'));
});
