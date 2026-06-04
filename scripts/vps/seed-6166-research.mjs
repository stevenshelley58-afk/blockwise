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

const buildRun = await rest("build_runs?select=id&status=eq.running&order=started_at.desc&limit=1");
const buildRunId = buildRun?.[0]?.id || null;
const now = new Date().toISOString();

await rest("refresh_policies?on_conflict=postcode,state", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  body: JSON.stringify({
    postcode: "6166",
    state: "WA",
    priority: 1,
    refresh_cadence_minutes: 720,
    next_refresh_at: now,
    active: true,
    notes: "Hermes roster-backed 6166 build target: Coogee, Henderson, Lake Coogee, Munster, Wattleup.",
  }),
});

const active = await rest("work_queue?select=id,status&dedupe_key=eq.census%3AWA%3A6166&status=in.(pending,claimed)&limit=1");
if (!active.length) {
  const recyclable = await rest("work_queue?select=id,status&dedupe_key=eq.census%3AWA%3A6166&status=in.(failed,blocked)&limit=1");
  if (recyclable.length) {
    await rest(`work_queue?id=eq.${recyclable[0].id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "pending",
        available_at: now,
        attempts: 0,
        claimed_at: null,
        claimed_by: null,
        claim_token: null,
        claim_expires_at: null,
        last_error: null,
        blocked_reason: null,
        result: {},
        completed_at: null,
        payload: {
          postcode: "6166",
          state: "WA",
          build_run_id: buildRunId,
          verified_roster_first: true,
          location_search_allowed: false,
          legacy_discovery_allowed: false,
        },
      }),
    });
  } else {
    await rest("work_queue", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        queue_name: "research",
        job_type: "blockwise-agent-census",
        dedupe_key: "census:WA:6166",
        priority: 1,
        payload: {
          postcode: "6166",
          state: "WA",
          build_run_id: buildRunId,
          verified_roster_first: true,
          location_search_allowed: false,
          legacy_discovery_allowed: false,
        },
        status: "pending",
        available_at: now,
        max_attempts: 3,
      }),
    });
  }
}

console.log(JSON.stringify({ buildRunId, refreshPolicy: "6166", censusQueued: true }));
