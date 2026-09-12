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
