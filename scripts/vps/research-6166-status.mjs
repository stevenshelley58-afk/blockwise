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

async function count(path) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: { ...headers, Prefer: "count=exact" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} failed ${response.status}: ${text.slice(0, 300)}`);
  return Number((response.headers.get("content-range") || "*/0").split("/").pop() || 0);
}

const [policy, queue, agencies, serviceAreas, cards] = await Promise.all([
  rest("refresh_policies?select=postcode,state,priority,next_refresh_at,active&postcode=eq.6166&limit=1"),
  rest("work_queue?select=id,job_type,status,priority,attempts,claimed_at,claimed_by,claim_expires_at,available_at,updated_at,last_error,blocked_reason,result,payload&or=(dedupe_key.eq.census:WA:6166,payload->>postcode.eq.6166)&order=created_at.desc&limit=20"),
  count("agencies?select=id&primary_postcode=eq.6166"),
  count("agent_service_areas?select=id&postcode=eq.6166"),
  count("v_customer_meta_ad_library_cards?select=library_id&or=(postcode.eq.6166,postcodes.cs.{6166})"),
]);

console.log(JSON.stringify({ policy, queue, counts: { agencies, serviceAreas, customerCards: cards } }, null, 2));
