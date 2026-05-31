#!/usr/bin/env node

const DEFAULT_POSTCODES = [
  "6008",
  "6000",
  "6005",
  "6006",
  "6007",
  "6009",
  "6010",
  "6011",
  "6014",
  "6015",
  "6016",
  "6017",
  "6018",
  "6019",
  "6020",
  "6050",
  "6051",
  "6052",
  "6151",
  "6152",
  "6153",
  "6158",
  "6159",
  "6160",
];

const env = process.env;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function required(name, fallback) {
  const value = env[name] || fallback;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function parseIntEnv(name, fallback) {
  const raw = env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parsePostcodes() {
  const configured = env.HERMES_RESEARCH_TARGET_POSTCODES;
  const values = configured ? configured.split(",") : DEFAULT_POSTCODES;
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

const supabaseUrl = required("HERMES_SUPABASE_URL", env.SUPABASE_URL).replace(/\/+$/u, "");
const serviceRoleKey = required("HERMES_SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY);
const mode = env.HERMES_RESEARCH_MODE === "build" ? "build" : "maintain";
const workerId = env.HERMES_QUEUE_WORKER_ID || `hermes-supervisor-${Math.random().toString(36).slice(2)}`;
const intervalMs = parseIntEnv("HERMES_QUEUE_LOOP_INTERVAL_MS", 60_000);
const maxPolicies = parseIntEnv("HERMES_RESEARCH_SUPERVISOR_POLICY_LIMIT", mode === "build" ? 50 : 10);
const targetPostcodes = parsePostcodes();

function log(message, metadata = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: "blockwise-research-supervisor", message, ...metadata }));
}

async function rest(schema, path, init = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Accept-Profile": schema,
      "Content-Profile": schema,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${schema}.${path} failed ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function rpc(functionName, payload) {
  return rest("research", `rpc/${functionName}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function ensureBuildRun() {
  const existing = await rest(
    "research",
    `build_runs?select=id,started_at&mode=eq.${mode}&status=eq.running&order=started_at.desc&limit=1`,
  );
  if (existing?.[0]?.id) return existing[0].id;

  const created = await rest("research", "build_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      mode,
      market: "WA",
      target_postcodes: targetPostcodes,
      source_provider: "hermes",
      trigger: "scheduled",
      status: "running",
      notes: "Fresh Hermes-owned research run started by deterministic supervisor.",
      metadata: {
        owner: "hermes",
        runner: "supabase-supervisor",
        location_search_allowed: false,
        legacy_workers_allowed: false,
      },
    }),
  });
  const id = created?.[0]?.id;
  if (!id) throw new Error("Supabase did not return a build_run id");
  await recordEvent("insert", "build_runs", id, { mode, targetPostcodes });
  return id;
}

async function recordEvent(eventType, tableName, rowId, payload = {}) {
  await rest("research", "ingest_events", {
    method: "POST",
    body: JSON.stringify({
      event_type: eventType,
      table_name: tableName,
      row_id: rowId,
      source_provider: "hermes",
      payload,
    }),
  });
}

async function dueRefreshPolicies() {
  const now = encodeURIComponent(new Date().toISOString());
  const selected = targetPostcodes.map((postcode) => `"${postcode}"`).join(",");
  const filter = selected ? `&postcode=in.(${selected})` : "";
  return rest(
    "research",
    `refresh_policies?select=id,postcode,state,priority,refresh_cadence_minutes,next_refresh_at&active=eq.true&next_refresh_at=lte.${now}${filter}&order=priority.asc,next_refresh_at.asc&limit=${maxPolicies}`,
  );
}

async function activeDedupeExists(dedupeKey) {
  const encoded = encodeURIComponent(dedupeKey);
  const rows = await rest(
    "research",
    `work_queue?select=id,status&dedupe_key=eq.${encoded}&status=in.(pending,claimed,failed,blocked)&limit=1`,
  );
  return rows.length > 0;
}

async function enqueueCensusJob(policy, buildRunId) {
  const dedupeKey = `census:${policy.state}:${policy.postcode}`;
  if (await activeDedupeExists(dedupeKey)) return false;

  const created = await rest("research", "work_queue", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      queue_name: "research",
      job_type: "blockwise-agent-census",
      dedupe_key: dedupeKey,
      priority: policy.priority ?? 3,
      payload: {
        postcode: policy.postcode,
        state: policy.state,
        build_run_id: buildRunId,
        verified_roster_first: true,
        location_search_allowed: false,
        legacy_discovery_allowed: false,
      },
      status: "pending",
      max_attempts: 3,
    }),
  });
  const id = created?.[0]?.id;
  if (id) await recordEvent("insert", "work_queue", id, { dedupeKey, job_type: "blockwise-agent-census" });
  return Boolean(id);
}

async function runWatchdogs() {
  const stale = await rpc("watchdog_requeue_stale_jobs", { p_limit: 100 });
  const providerFailures = await rpc("watchdog_record_provider_failures", {
    p_since: "24 hours",
    p_failure_threshold: 3,
  });
  const zeroAds = await rpc("watchdog_record_zero_ad_anomalies", {
    p_since: "48 hours",
    p_limit: 100,
  });
  const missingMedia = await rpc("watchdog_record_missing_media", {
    p_since: "24 hours",
    p_limit: 100,
  });
  const unclassified = await rpc("watchdog_record_unclassified_creatives", {
    p_since: "24 hours",
    p_limit: 100,
  });
  return {
    stale: stale.length,
    providerFailures: providerFailures.length,
    zeroAds: zeroAds.length,
    missingMedia: missingMedia.length,
    unclassified: unclassified.length,
  };
}

async function tick() {
  const buildRunId = await ensureBuildRun();
  const policies = await dueRefreshPolicies();
  let enqueued = 0;
  for (const policy of policies) {
    if (await enqueueCensusJob(policy, buildRunId)) enqueued += 1;
  }
  const watchdogs = await runWatchdogs();
  log("tick complete", { mode, workerId, buildRunId, duePolicies: policies.length, enqueued, watchdogs });
}

async function main() {
  log("starting", { mode, workerId, intervalMs, targetPostcodes });
  for (;;) {
    try {
      await tick();
    } catch (error) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        component: "blockwise-research-supervisor",
        level: "error",
        message: error.message,
      }));
    }
    if (env.HERMES_RESEARCH_RUN_ONCE === "true") break;
    await sleep(intervalMs);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
