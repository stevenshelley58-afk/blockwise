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
const creatives = await rest("ad_creatives?select=id,observed_ad_id,creative_hash&order=created_at.desc&limit=1000");
const stamp = Date.now();
let queued = 0;

for (const creative of creatives || []) {
  await rest(`ad_creatives?id=eq.${creative.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      classification_status: "unclassified",
      display_state: "pending_review",
    }),
  });
  await rest("work_queue", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      queue_name: "research",
      job_type: "blockwise-ad-classifier",
      dedupe_key: `classifier-recheck:${creative.id}:${stamp}`,
      priority: 1,
      payload: {
        adCreativeId: creative.id,
        observedAdId: creative.observed_ad_id,
        build_run_id: buildRunId,
      },
      status: "pending",
      max_attempts: 3,
    }),
  });
  queued += 1;
}

console.log(JSON.stringify({ buildRunId, creatives: creatives.length, queued }));
