const supabaseUrl = process.env.HERMES_SUPABASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.HERMES_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or service role key in environment.");
}

const api = `${supabaseUrl.replace(/\/$/u, "")}/rest/v1`;
const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  "accept-profile": "research",
  "content-profile": "research",
  "content-type": "application/json",
};

async function rest(path, options = {}) {
  const response = await fetch(`${api}/${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path}: ${response.status} ${await response.text()}`);
  if (response.status === 204) return [];
  return response.json();
}

const jobs = await rest("work_queue?select=id,status,attempts,claimed_by,claimed_at,claim_expires_at&dedupe_key=eq.census%3AWA%3A6166&limit=1");
const job = jobs[0];

if (!job) {
  throw new Error("No census:WA:6166 work_queue job exists.");
}

if (job.status === "complete") {
  console.log(JSON.stringify({ requeued: false, reason: "already_complete", job }, null, 2));
  process.exit(0);
}

const updated = await rest(`work_queue?id=eq.${job.id}`, {
  method: "PATCH",
  headers: { Prefer: "return=representation" },
  body: JSON.stringify({
    status: "pending",
    priority: 0,
    available_at: new Date().toISOString(),
    claimed_at: null,
    claimed_by: null,
    claim_token: null,
    claim_expires_at: null,
    last_error: null,
    blocked_reason: null,
    result: {
      manually_requeued_for_6166_start: true,
      previous_status: job.status,
      previous_claimed_by: job.claimed_by,
      previous_claimed_at: job.claimed_at,
      previous_claim_expires_at: job.claim_expires_at,
    },
  }),
});

console.log(JSON.stringify({ requeued: true, job: updated[0] }, null, 2));
