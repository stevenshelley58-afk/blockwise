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
    method: "GET",
    headers: { ...headers, Prefer: "count=exact" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} failed ${response.status}: ${text.slice(0, 300)}`);
  const range = response.headers.get("content-range") || "*/0";
  return Number(range.split("/").pop() || 0);
}

const [
  agencies,
  pages,
  ads,
  snapshots,
  creatives,
  media,
  customerCards,
  queue,
  pageStatuses,
  recentPages,
  recentAds,
] = await Promise.all([
  count("agencies?select=id&is_real_estate=eq.true&status=eq.licensed_verified"),
  count("advertiser_pages?select=id"),
  count("observed_ads?select=id"),
  count("ad_snapshots?select=id"),
  count("ad_creatives?select=id"),
  count("media_assets?select=id"),
  count("v_customer_meta_ad_library_cards?select=library_id"),
  rest("work_queue?select=job_type,status&order=created_at.desc&limit=1000"),
  rest("advertiser_pages?select=status&page_id=not.is.null&limit=1000"),
  rest("advertiser_pages?select=id,page_id,page_name,status,confidence,last_checked_at&order=updated_at.desc&limit=10"),
  rest("observed_ads?select=external_ad_id,advertiser_page_id,active_status,last_seen_at&order=last_seen_at.desc&limit=10"),
]);

const queueCounts = {};
for (const job of queue || []) {
  const key = `${job.job_type}:${job.status}`;
  queueCounts[key] = (queueCounts[key] || 0) + 1;
}

const pageStatusCounts = {};
for (const page of pageStatuses || []) {
  pageStatusCounts[page.status] = (pageStatusCounts[page.status] || 0) + 1;
}

console.log(JSON.stringify({
  counts: { agencies, pages, ads, snapshots, creatives, media, customerCards },
  pageStatusCounts,
  queueCounts,
  recentPages,
  recentAds,
}, null, 2));
