/** Bounded, stage-isolated lane scheduling for the single Ad Radar queue. */
export const AD_RADAR_LANE_DEFAULTS = Object.freeze({
  collector: Object.freeze({ name: "collector", concurrency: 4, jobTypes: Object.freeze(["blockwise-ad-collector"]), dedupePrefix: "ad-radar:collector:" }),
  discovery: Object.freeze({ name: "discovery", concurrency: 4, jobTypes: Object.freeze(["blockwise-ad-directory-discovery-entity"]), payload: Object.freeze({ handler: "blockwise-ad-directory-discovery-entity" }), dedupePrefix: "ad-radar:directory:entity:" }),
  media: Object.freeze({ name: "media", concurrency: 4, jobTypes: Object.freeze(["blockwise-media-collector"]), payload: Object.freeze({ ad_db_child: true }), dedupePrefix: "ad-radar:media:" }),
  classifier: Object.freeze({ name: "classifier", concurrency: 1, jobTypes: Object.freeze(["blockwise-ad-classifier"]), payload: Object.freeze({ ad_db_child: true, classifierMode: "deterministic" }), dedupePrefix: "ad-radar:classifier:" }),
  directory: Object.freeze({ name: "directory", concurrency: 1, jobTypes: Object.freeze(["blockwise-ad-directory-discovery"]), payload: Object.freeze({ handler: "blockwise-ad-directory-discovery" }), dedupePrefix: "ad-radar:directory:" }),
});
export const AD_RADAR_LANE_NAMES = Object.freeze(Object.keys(AD_RADAR_LANE_DEFAULTS));
const laneEnvName = (name) => `HERMES_AD_RADAR_${String(name).toUpperCase()}_CONCURRENCY`;
export function boundedPositiveInt(value, fallback, { min = 1, max = 25 } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}
export function resolveAdRadarLaneConfigs(environment = {}, overrides = {}) {
  return Object.fromEntries(AD_RADAR_LANE_NAMES.map((name) => {
    const base = AD_RADAR_LANE_DEFAULTS[name];
    const override = overrides[name] || {};
    const configured = override.concurrency ?? environment[laneEnvName(name)];
    return [name, Object.freeze({
      ...base, ...override, name,
      concurrency: boundedPositiveInt(configured, base.concurrency),
      jobTypes: Object.freeze([...(override.jobTypes || base.jobTypes)]),
      payload: override.payload ? Object.freeze({ ...override.payload }) : base.payload,
    })];
  }));
}
function matchesPayload(payload, required = {}) {
  return Object.entries(required).every(([key, value]) => payload?.[key] === value);
}
export function laneAcceptsJob(job, lane) {
  if (!job || !lane || !lane.jobTypes?.includes(job.job_type)) return false;
  if (lane.dedupePrefix && !String(job.dedupe_key || "").startsWith(lane.dedupePrefix)) return false;
  if (Array.isArray(lane.payloadAny)) return lane.payloadAny.some((required) => matchesPayload(job.payload, required));
  return matchesPayload(job.payload, lane.payload);
}
export function laneForJob(job, laneConfigs = AD_RADAR_LANE_DEFAULTS) {
  return Object.values(laneConfigs).find((lane) => laneAcceptsJob(job, lane)) || null;
}
export function selectLaneJobs(jobs, lane, limit = lane?.concurrency || 1) {
  const selected = [];
  const ids = new Set();
  const boundedLimit = boundedPositiveInt(limit, lane?.concurrency || 1);
  for (const job of jobs || []) {
    if (!laneAcceptsJob(job, lane) || !job.id || ids.has(job.id)) continue;
    ids.add(job.id);
    selected.push(job);
    if (selected.length >= boundedLimit) break;
  }
  return selected;
}
export async function runLaneBatch({ jobs, lane, runJob }) {
  if (typeof runJob !== "function") throw new TypeError("runJob must be a function");
  const selected = selectLaneJobs(jobs, lane);
  const results = await Promise.allSettled(selected.map((job) => runJob(job, lane)));
  return {
    lane: lane.name,
    attempted: selected.length,
    completed: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
    jobIds: selected.map((job) => job.id),
    results,
  };
}
export function startAdRadarLaneLoops({
  lanes,
  pollMs = 10_000,
  runLanePass,
  // Idle polling must keep this standalone service alive.
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onError = () => {},
}) {
  if (!Array.isArray(lanes) || lanes.length === 0) throw new TypeError("lanes must be a non-empty array");
  if (typeof runLanePass !== "function") throw new TypeError("runLanePass must be a function");
  const waiters = new Set();
  let stopping = false;
  let started = false;
  let tasks = [];
  const wake = () => { for (const resolve of waiters) resolve(); waiters.clear(); };
  const waitForPoll = async () => {
    let wakePoll;
    const wakePromise = new Promise((resolve) => {
      wakePoll = resolve;
      waiters.add(resolve);
    });
    try {
      await Promise.race([sleep(pollMs), wakePromise]);
    } finally {
      waiters.delete(wakePoll);
    }
  };
  const loop = async (lane) => {
    while (!stopping) {
      let result;
      try { result = await runLanePass(lane); }
      catch (error) { try { onError(error, lane); } catch { /* logging must not stop another lane */ } }
      // Drain available work without paying a ten-second idle delay per item.
      // Yield once to IO/signals so fast local jobs cannot starve shutdown.
      if (!stopping) {
        if (result?.attempted > 0) await sleep(0);
        else await waitForPoll();
      }
    }
  };
  const controller = {
    get tasks() { return tasks; },
    start() {
      if (started) throw new Error("Ad Radar lane loops already started");
      started = true;
      tasks = lanes.map((lane) => loop(lane));
      return controller;
    },
    async stop() {
      stopping = true;
      wake();
      await Promise.allSettled(tasks);
    },
    get stopping() { return stopping; },
  };
  return controller;
}
