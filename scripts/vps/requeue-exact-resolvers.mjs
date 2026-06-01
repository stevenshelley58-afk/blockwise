#!/usr/bin/env node

const supabaseUrl = (process.env.HERMES_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/u, "");
const serviceRoleKey = process.env.HERMES_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("missing supabase env");
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Accept-Profile": "research",
  "Content-Profile": "research",
  "Content-Type": "application/json",
};

async function rest(path, init = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} failed ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

const build = await rest("build_runs?select=id&status=eq.running&order=started_at.desc&limit=1");
const buildRunId = build?.[0]?.id || null;
const jobs = await rest("work_queue?select=id,payload,status,completed_at&job_type=eq.blockwise-page-resolver&order=created_at.desc&limit=1000");
const byAgency = new Map();

for (const job of jobs || []) {
  const payload = job.payload || {};
  if (!payload.subjectId || payload.subjectKind !== "agency") continue;
  if (!payload.censusDecisionId || !Array.isArray(payload.sourceDocumentIds) || payload.sourceDocumentIds.length === 0) continue;
  if (!byAgency.has(payload.subjectId)) byAgency.set(payload.subjectId, payload);
}

const highPriorityNames = [
  /ray white.*cottesloe/iu,
  /realmark urban/iu,
  /abel property/iu,
  /jody fewster/iu,
  /realty lane/iu,
  /realestate 88/iu,
];

let inserted = 0;
let boosted = 0;
const stamp = Date.now();
const availableAt = new Date().toISOString();

for (const payload of byAgency.values()) {
  const name = String(payload.agencyName || "");
  const isBoosted = highPriorityNames.some((pattern) => pattern.test(name));
  await rest("work_queue", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      queue_name: "research",
      job_type: "blockwise-page-resolver",
      dedupe_key: `page-resolver-exact:${payload.subjectId}:${stamp}`,
      priority: isBoosted ? 1 : 25,
      payload: {
        ...payload,
        build_run_id: buildRunId,
        forceRevisit: true,
        exactNameResolver: true,
        location_search_allowed: false,
        legacy_discovery_allowed: false,
      },
      status: "pending",
      available_at: availableAt,
      max_attempts: 3,
    }),
  });
  inserted += 1;
  if (isBoosted) boosted += 1;
}

console.log(JSON.stringify({ buildRunId, sourceJobs: jobs.length, uniqueAgencies: byAgency.size, inserted, boosted }));
