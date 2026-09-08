import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AD_RADAR_LANE_DEFAULTS,
  laneForJob,
  laneAcceptsJob,
  resolveAdRadarLaneConfigs,
  runLaneBatch,
  selectLaneJobs,
  startAdRadarLaneLoops,
} from "../hermes/tools/research-runtime/bin/ad-radar-lane-scheduler.mjs";
const supervisorSource = readFileSync(new URL("../hermes/tools/research-runtime/bin/supabase-supervisor.mjs", import.meta.url), "utf8");

test("supervisor wires one scheduler and independent bounded lane loops", () => {
  assert.match(supervisorSource, /startAdRadarLaneLoops/);
  assert.match(supervisorSource, /runAdDbSupervisorPass\(\)/);
  assert.match(supervisorSource, /enqueueAdRadarDirectoryDiscovery/);
  assert.match(supervisorSource, /enqueueClassificationBackfillJobs/);
  assert.match(supervisorSource, /Object\.values\(adRadarLaneConfigs\)/);
  assert.match(supervisorSource, /await Promise\.all\(\[scheduler\.stop\(\), workers\.stop\(\)\]\)/);
  assert.doesNotMatch(supervisorSource, /runAdDbWorkerPass/);
});

test("exact worker execution is marked-lane gated", () => {
  assert.match(supervisorSource, /const lane = laneForJob\(job, adRadarLaneConfigs\)/);
  assert.match(supervisorSource, /exact mode requires a canonical marked Ad Radar lane job/);
});

const row = (job_type, dedupe_key, payload = {}, id = `${job_type}-${dedupe_key}`) => ({ id, job_type, dedupe_key, payload });

test("lane defaults are bounded and stage-specific", () => {
  const lanes = resolveAdRadarLaneConfigs({
    HERMES_AD_RADAR_COLLECTOR_CONCURRENCY: "100",
    HERMES_AD_RADAR_MEDIA_CONCURRENCY: "bad",
    HERMES_AD_RADAR_CLASSIFIER_CONCURRENCY: "2",
  });
  assert.equal(lanes.collector.concurrency, 25);
  assert.equal(lanes.media.concurrency, 4);
  assert.equal(lanes.classifier.concurrency, 2);
  assert.equal(lanes.discovery.concurrency, 4);
  assert.equal(lanes.directory.concurrency, 1);
});
test("selectors reject legacy, wrong-stage, and unmarked child jobs", () => {
  assert.equal(laneForJob(row("blockwise-ad-collector", "ad-radar:collector:p"))?.name, "collector");
  assert.equal(laneForJob(row("blockwise-agent-census", "ad-radar:directory:p", { handler: "blockwise-ad-directory-discovery" }), AD_RADAR_LANE_DEFAULTS), null);
  assert.equal(laneForJob(row("blockwise-media-collector", "ad-radar:media:c", { ad_db_child: false })), null);
  assert.equal(laneAcceptsJob(row("blockwise-page-resolver", "ad-radar:discovery:a", { ad_radar_discovery: false }), AD_RADAR_LANE_DEFAULTS.discovery), false);
  assert.equal(laneAcceptsJob(row("blockwise-ad-classifier", "classifier:c:h:v", { ad_db_child: true, classifierMode: "deterministic" }), AD_RADAR_LANE_DEFAULTS.classifier), false);
});
test("canonical classifier and directory markers remain isolated", () => {
  assert.equal(laneForJob(row("blockwise-ad-classifier", "ad-radar:classifier:c:h:v", { ad_db_child: true, classifierMode: "deterministic" }))?.name, "classifier");
  assert.equal(laneForJob(row("blockwise-ad-directory-discovery", "ad-radar:directory:wa", { handler: "blockwise-ad-directory-discovery" }))?.name, "directory");
  assert.equal(laneForJob(row("blockwise-ad-directory-discovery-entity", "ad-radar:directory:entity:agent:a", { handler: "blockwise-ad-directory-discovery-entity" }))?.name, "discovery");
  assert.equal(laneForJob(row("blockwise-page-resolver", "ad-radar:discovery:a", { ad_radar_discovery: true }))?.name, undefined);
});
test("selection deduplicates IDs and respects lane capacity", () => {
  const jobs = [
    row("blockwise-media-collector", "ad-radar:media:a", { ad_db_child: true }, "a"),
    row("blockwise-media-collector", "ad-radar:media:a-duplicate", { ad_db_child: true }, "a"),
    row("blockwise-media-collector", "ad-radar:media:b", { ad_db_child: true }, "b"),
    row("blockwise-ad-collector", "ad-radar:collector:c", {}, "c"),
  ];
  assert.deepEqual(selectLaneJobs(jobs, AD_RADAR_LANE_DEFAULTS.media, 1).map((job) => job.id), ["a"]);
  assert.deepEqual(selectLaneJobs(jobs, AD_RADAR_LANE_DEFAULTS.media, 4).map((job) => job.id), ["a", "b"]);
});
test("lane batch only invokes selected jobs and reports isolated failures", async () => {
  const seen = [];
  const result = await runLaneBatch({
    jobs: [row("blockwise-media-collector", "ad-radar:media:a", { ad_db_child: true }, "a"), row("blockwise-media-collector", "ad-radar:media:b", { ad_db_child: true }, "b")],
    lane: AD_RADAR_LANE_DEFAULTS.media,
    runJob: async (job) => { seen.push(job.id); if (job.id === "b") throw new Error("isolated"); },
  });
  assert.deepEqual(seen.sort(), ["a", "b"]);
  assert.deepEqual({ attempted: result.attempted, completed: result.completed, failed: result.failed }, { attempted: 2, completed: 1, failed: 1 });
});
test("independent loops continue while one lane pass is slow and stop drains", async () => {
  const calls = [];
  let releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  const runner = startAdRadarLaneLoops({
    lanes: [{ name: "slow" }, { name: "fast" }],
    pollMs: 1,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    runLanePass: async (lane) => {
      calls.push(lane.name);
      if (lane.name === "slow" && calls.filter((name) => name === "slow").length === 1) await slow;
      else if (lane.name === "fast" && calls.filter((name) => name === "fast").length >= 3) releaseSlow();
    },
  }).start();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.ok(calls.includes("fast"));
  assert.ok(calls.filter((name) => name === "fast").length >= 3);
  await runner.stop();
  assert.equal(runner.stopping, true);
});
test("busy lane drains immediately and uses idle delay only after empty pass", async () => {
  const sleeps = [];
  let calls = 0;
  let notifyIdle;
  const idle = new Promise(resolve => { notifyIdle = resolve; });
  const runner = startAdRadarLaneLoops({
    lanes: [{name: "test"}], pollMs: 10000,
    runLanePass: async () => ({attempted: ++calls < 3 ? 1 : 0}),
    sleep: async ms => {
      sleeps.push(ms);
      if (ms === 10000) { notifyIdle(); return new Promise(() => {}); }
    },
  }).start();
  await idle;
  await runner.stop();
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [0, 0, 10000]);
});
test("standalone idle lane keeps its service process alive", async t => {
  const {spawn} = await import("node:child_process");
  const moduleUrl = new URL("../hermes/tools/research-runtime/bin/ad-radar-lane-scheduler.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module","-e",
    `import {startAdRadarLaneLoops} from ${JSON.stringify(moduleUrl)};
     startAdRadarLaneLoops({lanes:[{name:"idle"}],runLanePass:async()=>({attempted:0})}).start();`],
    {stdio:"ignore"});
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  const exited = new Promise(resolve => child.once("exit", resolve));
  await new Promise(resolve => setTimeout(resolve,250));
  assert.equal(child.exitCode,null,"idle worker must not silently exit with code zero");
  child.kill("SIGTERM");
  await exited;
});
