#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const DEFAULT_POSTCODES = "6008,6000,6005,6006,6007,6009,6010,6011,6014,6015,6016,6017,6018,6019,6020,6050,6051,6052,6151,6152,6153,6158,6159,6160,6166".split(",");
const env = process.env;
const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();
const json = (value) => JSON.stringify(value);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const positiveInt = (name, fallback) => {
  const parsed = Number.parseInt(env[name] || `${fallback}`, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
};
const required = (name, fallback) => {
  const value = env[name] || fallback;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const uniqueCsv = (value, fallback) => [...new Set((value ? value.split(",") : fallback).map((part) => part.trim()).filter(Boolean))];

const supabaseUrl = required("HERMES_SUPABASE_URL", env.SUPABASE_URL).replace(/\/+$/u, "");
const serviceRoleKey = required("HERMES_SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY);
const mode = env.HERMES_RESEARCH_MODE === "build" ? "build" : "maintain";
const workerId = env.HERMES_QUEUE_WORKER_ID || `hermes-research-${randomUUID()}`;
const intervalMs = positiveInt("HERMES_QUEUE_LOOP_INTERVAL_MS", 60_000);
const supervisorLimit = positiveInt("HERMES_RESEARCH_SUPERVISOR_POLICY_LIMIT", mode === "build" ? 50 : 10);
const claimLimit = positiveInt("HERMES_QUEUE_CLAIM_LIMIT", mode === "build" ? 4 : 1);
const claimTtlSeconds = positiveInt("HERMES_QUEUE_CLAIM_TTL_SECONDS", 900);
const maxJobsPerTick = positiveInt("HERMES_QUEUE_MAX_JOBS_PER_TICK", mode === "build" ? 4 : 1);
const fetchTimeoutMs = positiveInt("HERMES_RESEARCH_FETCH_TIMEOUT_MS", 8_000);
const metaCaptureTimeoutMs = positiveInt("HERMES_META_CAPTURE_TIMEOUT_MS", 30_000);
const targetPostcodes = uniqueCsv(env.HERMES_RESEARCH_TARGET_POSTCODES, DEFAULT_POSTCODES);
const sourceTemplates = uniqueCsv(env.HERMES_CENSUS_SOURCE_URL_TEMPLATES, []);
const metaCaptureProvider = env.HERMES_META_CAPTURE_PROVIDER || (env.HERMES_META_CAPTURE_ENDPOINT ? "http_json" : "hermes_browser");
const metaCaptureEndpoint = env.HERMES_META_CAPTURE_ENDPOINT || "";
const metaBrowserExecutable = env.HERMES_META_BROWSER_EXECUTABLE || env.CHROMIUM_BIN || "chromium";
const mediaBucket = env.HERMES_RESEARCH_AD_CREATIVES_BUCKET || "research-ad-creatives";

const POSTCODE_ROSTER_SOURCES = {
  "6000": [{ suburb: "Perth", slug: "perth" }],
  "6005": [{ suburb: "West Perth", slug: "west-perth" }],
  "6006": [{ suburb: "North Perth", slug: "north-perth" }],
  "6007": [{ suburb: "Leederville", slug: "leederville" }],
  "6008": [{ suburb: "Subiaco", slug: "subiaco" }],
  "6009": [{ suburb: "Nedlands", slug: "nedlands" }],
  "6010": [{ suburb: "Claremont", slug: "claremont" }],
  "6011": [{ suburb: "Cottesloe", slug: "cottesloe" }],
  "6014": [{ suburb: "Wembley", slug: "wembley" }],
  "6015": [{ suburb: "City Beach", slug: "city-beach" }],
  "6016": [{ suburb: "Glendalough", slug: "glendalough" }],
  "6017": [{ suburb: "Osborne Park", slug: "osborne-park" }],
  "6018": [{ suburb: "Innaloo", slug: "innaloo" }],
  "6019": [{ suburb: "Scarborough", slug: "scarborough" }],
  "6020": [{ suburb: "Carine", slug: "carine" }],
  "6050": [{ suburb: "Mount Lawley", slug: "mount-lawley" }],
  "6051": [{ suburb: "Maylands", slug: "maylands" }],
  "6052": [{ suburb: "Inglewood", slug: "inglewood" }],
  "6151": [{ suburb: "South Perth", slug: "south-perth" }],
  "6152": [{ suburb: "Como", slug: "como" }],
  "6153": [{ suburb: "Applecross", slug: "applecross" }],
  "6158": [{ suburb: "East Fremantle", slug: "east-fremantle" }],
  "6159": [{ suburb: "North Fremantle", slug: "north-fremantle" }],
  "6160": [{ suburb: "Fremantle", slug: "fremantle" }],
  "6166": [
    { suburb: "Coogee", slug: "coogee" },
    { suburb: "Henderson", slug: "henderson" },
    { suburb: "Lake Coogee", slug: "lake-coogee" },
    { suburb: "Munster", slug: "munster" },
    { suburb: "Wattleup", slug: "wattleup" },
  ],
};

function log(message, metadata = {}, level = "info") {
  console.log(json({ ts: now(), component: "blockwise-research-runtime", level, message, ...metadata }));
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
  if (!response.ok) throw new Error(`${init.method || "GET"} ${schema}.${path} failed ${response.status}: ${text.slice(0, 700)}`);
  return text ? JSON.parse(text) : null;
}

async function storage(path, init = {}) {
  const response = await fetch(`${supabaseUrl}/storage/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method || "GET"} storage.${path} failed ${response.status}: ${text.slice(0, 700)}`);
  return text ? JSON.parse(text) : null;
}

const rpc = (functionName, payload) => rest("research", `rpc/${functionName}`, { method: "POST", body: json(payload) });
const encode = (value) => encodeURIComponent(value);

async function recordEvent(eventType, tableName, rowId, payload = {}, extra = {}) {
  const row = { event_type: eventType, table_name: tableName, row_id: rowId, source_provider: "hermes", payload, ...extra };
  try {
    await rest("research", "ingest_events", {
      method: "POST",
      body: json(row),
    });
  } catch (error) {
    if (!/schema cache|column .* does not exist|PGRST204|42703/i.test(error.message)) throw error;
    const compatibleRow = { ...row };
    delete compatibleRow.work_queue_id;
    delete compatibleRow.agent_decision_id;
    delete compatibleRow.source_document_id;
    delete compatibleRow.build_run_id;
    delete compatibleRow.ad_fetch_run_id;
    delete compatibleRow.payload_hash;
    delete compatibleRow.diff;
    await rest("research", "ingest_events", {
      method: "POST",
      body: json(compatibleRow),
    });
  }
}

async function ensureBuildRun() {
  const existing = await rest("research", `build_runs?select=id,started_at&mode=eq.${mode}&status=eq.running&order=started_at.desc&limit=1`);
  if (existing?.[0]?.id) return existing[0].id;
  const created = await rest("research", "build_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: json({
      mode,
      market: "WA",
      target_postcodes: targetPostcodes,
      source_provider: "hermes",
      trigger: "scheduled",
      status: "running",
      notes: "Hermes research run started by deterministic queue runtime.",
      metadata: { owner: "hermes", runner: "supabase-supervisor", location_search_allowed: false, legacy_workers_allowed: false },
    }),
  });
  const id = created?.[0]?.id;
  if (!id) throw new Error("Supabase did not return a build_run id");
  await recordEvent("insert", "build_runs", id, { mode, targetPostcodes });
  return id;
}

async function enqueueDueCensusJobs(buildRunId) {
  const selected = targetPostcodes.map((postcode) => `"${postcode}"`).join(",");
  const policies = await rest(
    "research",
    `refresh_policies?select=id,postcode,state,priority,refresh_cadence_minutes,next_refresh_at&active=eq.true&next_refresh_at=lte.${encode(now())}&postcode=in.(${selected})&order=priority.asc,next_refresh_at.asc&limit=${supervisorLimit}`,
  );
  let enqueued = 0;
  for (const policy of policies) {
    const dedupeKey = `census:${policy.state}:${policy.postcode}`;
    const existing = await rest("research", `work_queue?select=id&dedupe_key=eq.${encode(dedupeKey)}&status=in.(pending,claimed,failed,blocked)&limit=1`);
    if (existing.length) continue;
    const created = await rest("research", "work_queue", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: json({
        queue_name: "research",
        job_type: "blockwise-agent-census",
        dedupe_key: dedupeKey,
        priority: policy.priority ?? 3,
        payload: { postcode: policy.postcode, state: policy.state, build_run_id: buildRunId, verified_roster_first: true, location_search_allowed: false, legacy_discovery_allowed: false },
        status: "pending",
        max_attempts: 3,
      }),
    });
    if (created?.[0]?.id) {
      enqueued += 1;
      await recordEvent("insert", "work_queue", created[0].id, { dedupeKey, job_type: "blockwise-agent-census" }, { work_queue_id: created[0].id });
    }
  }
  return { duePolicies: policies.length, enqueued };
}

async function runWatchdogs() {
  const [stale, providerFailures, zeroAds, missingMedia, unclassified] = await Promise.all([
    rpc("watchdog_requeue_stale_jobs", { p_limit: 100 }),
    rpc("watchdog_record_provider_failures", { p_since: "24 hours", p_failure_threshold: 3 }),
    rpc("watchdog_record_zero_ad_anomalies", { p_since: "48 hours", p_limit: 100 }),
    rpc("watchdog_record_missing_media", { p_since: "24 hours", p_limit: 100 }),
    rpc("watchdog_record_unclassified_creatives", { p_since: "24 hours", p_limit: 100 }),
  ]);
  return { stale: stale.length, providerFailures: providerFailures.length, zeroAds: zeroAds.length, missingMedia: missingMedia.length, unclassified: unclassified.length };
}

async function claimJobs() {
  try {
    const claimed = await rpc("claim_work_queue_jobs", {
      p_worker_id: workerId,
      p_queue_name: "research",
      p_job_types: [
        "blockwise-agent-census",
        "blockwise-page-resolver",
        "blockwise-ad-collector",
        "blockwise-media-collector",
        "blockwise-ad-classifier",
      ],
      p_limit: claimLimit,
      p_claim_ttl_seconds: claimTtlSeconds,
    });
    for (const job of claimed) await recordEvent("claim", "work_queue", job.id, { job_type: job.job_type, workerId }, { work_queue_id: job.id });
    return claimed;
  } catch (error) {
    if (!/claim_work_queue_jobs|PGRST202|404/i.test(error.message)) throw error;
    log("claim RPC unavailable, using direct REST fallback", { error: error.message }, "warning");
  }

  const pending = await rest("research", `work_queue?select=*&queue_name=eq.research&status=eq.pending&available_at=lte.${encode(now())}&job_type=in.(blockwise-agent-census,blockwise-page-resolver,blockwise-ad-collector,blockwise-media-collector,blockwise-ad-classifier)&order=priority.asc,available_at.asc,created_at.asc&limit=${claimLimit}`);
  const claimed = [];
  for (const job of pending) {
    const token = randomUUID();
    const updated = await rest("research", `work_queue?id=eq.${job.id}&status=eq.pending`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: json({ status: "claimed", claimed_at: now(), claimed_by: workerId, claim_token: token, claim_expires_at: new Date(Date.now() + claimTtlSeconds * 1000).toISOString(), attempts: (job.attempts ?? 0) + 1 }),
    });
    if (updated?.[0]) claimed.push(updated[0]);
  }
  return claimed;
}

async function finishJob(job, status, patch, eventType = status === "complete" ? "complete" : status === "blocked" ? "block" : "fail") {
  const updated = await rest("research", `work_queue?id=eq.${job.id}&claim_token=eq.${job.claim_token}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: json({
      status,
      claimed_at: null,
      claimed_by: null,
      claim_token: null,
      claim_expires_at: null,
      completed_at: status === "complete" || status === "blocked" ? now() : null,
      ...patch,
    }),
  });
  if (!updated?.[0]?.id) throw new Error(`Could not ${status} claimed job ${job.id}; claim token no longer matches`);
  await recordEvent(eventType, "work_queue", job.id, patch.result || {}, { work_queue_id: job.id });
}

async function sourceDocument(source, url, body, metadata = {}) {
  const contentHash = hash(body);
  const existing = await rest("research", `source_documents?select=id&source=eq.${encode(source)}&content_hash=eq.${contentHash}&limit=1`);
  if (existing?.[0]?.id) return existing[0].id;
  const created = await rest("research", "source_documents", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: json({ source, source_url: url, content_hash: contentHash, mime_type: "text/html", byte_size: Buffer.byteLength(body), metadata }),
  });
  return created?.[0]?.id;
}

function normalizeName(name) {
  return name.toLowerCase().replace(/&/gu, " and ").replace(/[^a-z0-9]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function titleCase(value) {
  return String(value || "")
    .split(/[\s-]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function reiwaRosterSources(payload) {
  const configured = POSTCODE_ROSTER_SOURCES[payload.postcode] || [];
  return configured.map((source) => ({
    source: "reiwa_agent_finder",
    suburb: source.suburb,
    url: `https://reiwa.com.au/real-estate-agents/${source.slug}/`,
  }));
}

function evidenceUrls(payload) {
  const direct = [payload.source_url, payload.website_url, payload.agency_url, payload.evidence_url, ...(Array.isArray(payload.source_urls) ? payload.source_urls : []), ...(Array.isArray(payload.evidence_urls) ? payload.evidence_urls : [])];
  const templated = sourceTemplates.map((template) => template.replaceAll("{postcode}", payload.postcode).replaceAll("{state}", payload.state || "WA"));
  const roster = reiwaRosterSources(payload).map((source) => source.url);
  return [...new Set([...direct, ...templated, ...roster].filter((url) => typeof url === "string" && /^https:\/\//iu.test(url)))];
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; BlockwiseHermesResearch/1.0; +https://blockwise.au)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-AU,en;q=0.9",
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`fetch ${url} failed ${response.status}: ${text.slice(0, 160)}`);
    return text.slice(0, 1_000_000);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFacebookPageDocument(url) {
  try {
    const html = await fetchText(url);
    if (facebookPageIdFromHtml(html, facebookSlugFromUrl(url))) return html;
  } catch {
    // Browser capture below handles Facebook's logged-out response variance.
  }
  const baseHtml = await browserDumpDom(url, Math.max(metaCaptureTimeoutMs, 15_000)).then((html) => html.slice(0, 2_500_000));
  if (facebookPageIdFromHtml(baseHtml, facebookSlugFromUrl(url))) return baseHtml;
  return browserDumpDom(facebookAboutUrl(url), Math.max(metaCaptureTimeoutMs, 15_000)).then((html) => html.slice(0, 2_500_000));
}

function facebookAboutUrl(url) {
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/about`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

async function browserDumpDom(url, budgetMs) {
  const { stdout } = await execFileAsync(
    metaBrowserExecutable,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      `--virtual-time-budget=${Math.min(budgetMs, 45_000)}`,
      "--dump-dom",
      url,
    ],
    {
      timeout: budgetMs + 10_000,
      maxBuffer: 24 * 1024 * 1024,
    },
  );
  return stdout;
}

function agencyFromPayload(payload) {
  const name = payload.agency_name || payload.name;
  if (!name || typeof name !== "string") return null;
  return {
    name: name.trim(),
    website_url: typeof payload.website_url === "string" ? payload.website_url : null,
    primary_postcode: payload.postcode,
    state: payload.state || "WA",
    evidence_url: typeof payload.evidence_url === "string" ? payload.evidence_url : typeof payload.website_url === "string" ? payload.website_url : null,
    confidence: Number.isFinite(payload.confidence) ? Math.max(0, Math.min(100, payload.confidence)) : 80,
  };
}

function agencyFromHtml(url, html, payload) {
  const title = /<title[^>]*>([^<]+)<\/title>/iu.exec(html)?.[1]?.replace(/\s+/gu, " ").trim();
  const siteName = /property\s*=\s*["']og:site_name["'][^>]*content\s*=\s*["']([^"']+)["']/iu.exec(html)?.[1]?.trim();
  const name = payload.agency_name || siteName || title?.replace(/\s*\|.*$/u, "").replace(/\s*-.*$/u, "");
  const realEstateProof = /\b(real estate|property management|property sales|licensed real estate|reiwa|residential sales)\b/iu.test(html);
  const postcodeProof = new RegExp(`\\b${payload.postcode}\\b`, "u").test(html);
  if (!name || !realEstateProof || (!postcodeProof && !payload.force_without_postcode_match)) return null;
  return {
    name,
    website_url: url,
    primary_postcode: payload.postcode,
    primary_suburb: payload.suburb || titleCase(String(payload.postcode || "")),
    state: payload.state || "WA",
    evidence_url: url,
    confidence: postcodeProof ? 82 : 70,
  };
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">");
}

function parseJsonLdObjects(html) {
  const out = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu;
  for (const match of html.matchAll(pattern)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]).trim());
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) {
        if (Array.isArray(value?.["@graph"])) out.push(...value["@graph"]);
        else out.push(value);
      }
    } catch {
      // Ignore malformed structured-data blocks. The source document is still stored.
    }
  }
  return out.filter((value) => value && typeof value === "object");
}

function extractReiwaRosterEntries(url, html, payload) {
  if (!/reiwa\.com\.au\/real-estate-agents\//iu.test(url)) return [];
  const configured = reiwaRosterSources(payload).find((source) => source.url === url);
  const suburb = payload.suburb || configured?.suburb || titleCase(url.split("/").filter(Boolean).pop()?.replace(/-/gu, " ") || payload.postcode);
  const entries = [];
  for (const item of parseJsonLdObjects(html)) {
    if (item["@type"] !== "Person" || !item.name || !item.worksFor?.name) continue;
    const agency = item.worksFor;
    const address = agency.address || {};
    entries.push({
      name: agency.name,
      website_url: typeof agency.url === "string" ? agency.url : url,
      reiwa_url: typeof agency.url === "string" ? agency.url : null,
      logo_url: typeof agency.logo === "string" ? agency.logo : typeof agency.image === "string" ? agency.image : null,
      primary_postcode: address.postalCode || payload.postcode,
      primary_suburb: address.addressLocality || suburb,
      state: address.addressRegion || payload.state || "WA",
      evidence_url: url,
      confidence: address.postalCode === payload.postcode ? 92 : 86,
      evidence_type: "listing_portal",
      agent: {
        full_name: item.name,
        email: typeof item.email === "string" ? item.email : null,
        phone: typeof item.telephone === "string" ? item.telephone : null,
        website_url: typeof item.url === "string" ? item.url : null,
        image_url: typeof item.image === "string" ? item.image : null,
        primary_postcode: payload.postcode,
        primary_suburb: suburb,
      },
    });
  }
  return entries;
}

async function ensureServiceArea(input) {
  const filters = [
    `postcode=eq.${encode(input.postcode)}`,
    `suburb=eq.${encode(input.suburb)}`,
    `match_type=eq.${input.match_type}`,
    input.agency_id ? `agency_id=eq.${input.agency_id}` : null,
    input.agent_id ? `agent_id=eq.${input.agent_id}` : null,
  ].filter(Boolean).join("&");
  try {
    const existing = await rest("research", `agent_service_areas?select=id&${filters}&limit=1`);
    if (existing.length) return existing[0].id;
    const created = await rest("research", "agent_service_areas", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: json(input),
    });
    return created?.[0]?.id;
  } catch (error) {
    if (missingSchemaRelation(error, "agent_service_areas")) return null;
    throw error;
  }
}

async function upsertVerifiedAgency(agency, sourceDocumentId, job) {
  const row = {
    name: agency.name,
    normalized_name: normalizeName(agency.name),
    state: agency.state,
    primary_postcode: agency.primary_postcode,
    primary_suburb: agency.primary_suburb,
    website_url: agency.website_url,
    is_real_estate: true,
    status: "licensed_verified",
    review_status: "ready",
    confidence: agency.confidence,
    metadata: {
      source: "hermes-agent-census",
      work_queue_id: job.id,
      evidence_url: agency.evidence_url,
      reiwa_url: agency.reiwa_url || null,
      logo_url: agency.logo_url || null,
    },
    last_seen_at: now(),
  };
  const agencies = await rest("research", "agencies?on_conflict=normalized_name,state", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: json(row),
  });
  const agencyId = agencies?.[0]?.id;
  if (!agencyId) throw new Error(`Agency upsert returned no id for ${agency.name}`);

  await ensureServiceArea({
    agency_id: agencyId,
    postcode: agency.primary_postcode,
    suburb: agency.primary_suburb || agency.primary_postcode,
    state: agency.state,
    match_type: "office_postcode",
    confidence: agency.confidence,
    evidence: { evidence_url: agency.evidence_url, reiwa_url: agency.reiwa_url || null },
    source_document_id: sourceDocumentId,
  });
  let agentId = null;
  let agentDecisionId = null;
  if (agency.agent?.full_name) {
    const agentNorm = normalizeName(agency.agent.full_name);
    const existingAgent = await rest("research", `agents?select=id&normalized_name=eq.${encode(agentNorm)}&agency_id=eq.${agencyId}&limit=1`);
    if (existingAgent?.[0]?.id) {
      agentId = existingAgent[0].id;
      await rest("research", `agents?id=eq.${agentId}`, {
        method: "PATCH",
        body: json({
          email: agency.agent.email,
          phone: agency.agent.phone,
          website_url: agency.agent.website_url,
          primary_postcode: agency.agent.primary_postcode || agency.primary_postcode,
          primary_suburb: agency.agent.primary_suburb || agency.primary_suburb,
          status: "licensed_verified",
          review_status: "ready",
          confidence: agency.confidence,
          metadata: { image_url: agency.agent.image_url || null, evidence_url: agency.evidence_url },
          last_seen_at: now(),
        }),
      });
    } else {
      const createdAgent = await rest("research", "agents", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: json({
          full_name: agency.agent.full_name,
          normalized_name: agentNorm,
          agency_id: agencyId,
          state: agency.state,
          primary_suburb: agency.agent.primary_suburb || agency.primary_suburb,
          primary_postcode: agency.agent.primary_postcode || agency.primary_postcode,
          email: agency.agent.email,
          phone: agency.agent.phone,
          website_url: agency.agent.website_url,
          status: "licensed_verified",
          review_status: "ready",
          confidence: agency.confidence,
          metadata: { image_url: agency.agent.image_url || null, evidence_url: agency.evidence_url },
        }),
      });
      agentId = createdAgent?.[0]?.id || null;
    }
    if (agentId) {
      await ensureServiceArea({
        agent_id: agentId,
        agency_id: agencyId,
        postcode: agency.agent.primary_postcode || agency.primary_postcode,
        suburb: agency.agent.primary_suburb || agency.primary_suburb || agency.primary_postcode,
        state: agency.state,
        match_type: "agent_profile_listing",
        confidence: agency.confidence,
        evidence: { evidence_url: agency.evidence_url, agent_url: agency.agent.website_url || null },
        source_document_id: sourceDocumentId,
      });
      await rest("research", "real_estate_verifications", {
        method: "POST",
        body: json({
          subject_type: "agent",
          subject_id: agentId,
          agent_id: agentId,
          agency_id: agencyId,
          verification_status: "verified",
          evidence_type: agency.evidence_type || "listing_portal",
          evidence_url: agency.evidence_url,
          evidence: { agent_name: agency.agent.full_name, agency_name: agency.name },
          source_document_id: sourceDocumentId,
          verified_by: "blockwise-agent-census",
          verified_at: now(),
          confidence: agency.confidence,
          notes: "Hermes deterministic census verification from roster source.",
        }),
      });
      const agentDecision = await rest("research", "agent_decisions", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: json({
          decision_type: "real_estate_verification",
          subject_type: "agent",
          subject_id: agentId,
          decision: {
            verified: true,
            method: "deterministic_census",
            agency_id: agencyId,
            location_search_allowed: false,
          },
          rationale: "Verified from supplied or configured public roster evidence before any page or ad collection.",
          confidence: agency.confidence,
          evidence: { urls: [agency.evidence_url, agency.agent.website_url].filter(Boolean), agent_name: agency.agent.full_name, agency_name: agency.name },
          source_document_ids: [sourceDocumentId],
          hermes_session_id: workerId,
          hermes_skill: "blockwise-agent-census",
          model: "deterministic",
        }),
      });
      agentDecisionId = agentDecision?.[0]?.id || null;
    }
  }
  const decision = await rest("research", "agent_decisions", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: json({
      decision_type: "real_estate_verification",
      subject_type: "agency",
      subject_id: agencyId,
      decision: {
        verified: true,
        method: "deterministic_census",
        postcode: agency.primary_postcode,
        suburb: agency.primary_suburb || null,
        agent_id: agentId,
        location_search_allowed: false,
      },
      rationale: "Verified from supplied or configured public roster evidence before any page or ad collection.",
      confidence: agency.confidence,
      evidence: { urls: [agency.evidence_url, agency.reiwa_url].filter(Boolean) },
      source_document_ids: [sourceDocumentId],
      hermes_session_id: workerId,
      hermes_skill: "blockwise-agent-census",
      model: "deterministic",
    }),
  });
  const decisionId = decision?.[0]?.id;
  await rest("research", "real_estate_verifications", {
    method: "POST",
    body: json({ subject_type: "agency", subject_id: agencyId, agency_id: agencyId, verification_status: "verified", evidence_type: agency.evidence_type || "agency_website", evidence_url: agency.evidence_url, evidence: { agency_name: agency.name, reiwa_url: agency.reiwa_url || null }, source_document_id: sourceDocumentId, verified_by: "blockwise-agent-census", verified_at: now(), confidence: agency.confidence, notes: "Hermes deterministic census verification." }),
  });
  if (decisionId) await recordEvent("verify", "agencies", agencyId, { agency_name: agency.name }, { work_queue_id: job.id, agent_decision_id: decisionId, source_document_id: sourceDocumentId });
  return {
    agencyId,
    agentId,
    decisionId,
    followUp: decisionId ? {
      queue_name: "research",
      job_type: "blockwise-page-resolver",
      dedupe_key: `page-resolver:agency:${agencyId}`,
      priority: 20,
      payload: {
        subjectKind: "agency",
        subjectId: agencyId,
        build_run_id: job.payload?.build_run_id || null,
        censusDecisionId: decisionId,
        sourceDocumentIds: [sourceDocumentId],
        agencyName: agency.name,
        reiwaUrl: agency.reiwa_url || null,
        websiteUrl: agency.website_url || null,
        forceRevisit: false,
        location_search_allowed: false,
      },
      status: "pending",
      max_attempts: 3,
    } : null,
    followUps: [
      decisionId ? {
        queue_name: "research",
        job_type: "blockwise-page-resolver",
        dedupe_key: `page-resolver:agency:${agencyId}`,
        priority: 20,
        payload: {
          subjectKind: "agency",
          subjectId: agencyId,
          build_run_id: job.payload?.build_run_id || null,
          censusDecisionId: decisionId,
          sourceDocumentIds: [sourceDocumentId],
          agencyName: agency.name,
          reiwaUrl: agency.reiwa_url || null,
          websiteUrl: agency.website_url || null,
          forceRevisit: false,
          location_search_allowed: false,
        },
        status: "pending",
        max_attempts: 3,
      } : null,
      agentId && agentDecisionId ? {
        queue_name: "research",
        job_type: "blockwise-page-resolver",
        dedupe_key: `page-resolver:agent:${agentId}`,
        priority: 18,
        payload: {
          subjectKind: "agent",
          subjectId: agentId,
          agencyId,
          build_run_id: job.payload?.build_run_id || null,
          censusDecisionId: agentDecisionId,
          sourceDocumentIds: [sourceDocumentId],
          agentName: agency.agent.full_name,
          agencyName: agency.name,
          profileUrl: agency.agent.website_url || null,
          websiteUrl: agency.website_url || null,
          reiwaUrl: agency.reiwa_url || null,
          forceRevisit: false,
          location_search_allowed: false,
        },
        status: "pending",
        max_attempts: 3,
      } : null,
    ].filter(Boolean),
  };
}

async function enqueueFollowUp(input, parentJob) {
  const existing = await rest("research", `work_queue?select=id,status&dedupe_key=eq.${encode(input.dedupe_key)}&status=in.(pending,claimed,failed,blocked)&limit=1`);
  const active = existing.find((job) => job.status === "pending" || job.status === "claimed");
  if (active) return false;
  const recyclable = existing.find((job) => job.status === "failed" || job.status === "blocked");
  if (recyclable) {
    await rest("research", `work_queue?id=eq.${recyclable.id}`, {
      method: "PATCH",
      body: json({
        queue_name: input.queue_name,
        job_type: input.job_type,
        advertiser_page_id: input.advertiser_page_id || null,
        priority: input.priority,
        payload: input.payload,
        status: "pending",
        available_at: input.available_at || now(),
        claimed_at: null,
        claimed_by: null,
        claim_token: null,
        claim_expires_at: null,
        attempts: 0,
        max_attempts: input.max_attempts || 3,
        last_error: null,
        blocked_reason: null,
        result: {},
        completed_at: null,
      }),
    });
    await recordEvent("requeue", "work_queue", recyclable.id, { parent_work_queue_id: parentJob.id, job_type: input.job_type }, { work_queue_id: recyclable.id });
    return true;
  }
  const created = await rest("research", "work_queue", { method: "POST", headers: { Prefer: "return=representation" }, body: json(input) });
  if (created?.[0]?.id) await recordEvent("insert", "work_queue", created[0].id, { parent_work_queue_id: parentJob.id, job_type: input.job_type }, { work_queue_id: created[0].id });
  return Boolean(created?.[0]?.id);
}

function extractLinks(html) {
  const out = new Set();
  const pattern = /href\s*=\s*["']([^"']+)["']/giu;
  for (const match of html.matchAll(pattern)) {
    const href = decodeHtml(match[1]).trim();
    if (!href || /^mailto:|^tel:|^#/iu.test(href)) continue;
    out.add(href);
  }
  return [...out];
}

function absoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function candidateWebsiteLinks(baseUrl, html) {
  return extractLinks(html)
    .map((href) => absoluteUrl(baseUrl, href))
    .filter(Boolean)
    .filter((url) =>
      /^https:\/\//iu.test(url) &&
      !/reiwa\.com\.au|google\.com|maps\.apple\.com|youtube\.com|linkedin\.com|instagram\.com|facebook\.com/iu.test(url),
    )
    .slice(0, 5);
}

function facebookLinks(baseUrl, html) {
  return extractLinks(html)
    .map((href) => absoluteUrl(baseUrl, href))
    .filter(Boolean)
    .map((url) => canonicalFacebookUrl(url))
    .filter(Boolean);
}

function canonicalFacebookUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)facebook\.com$/iu.test(parsed.hostname.replace(/^www\./iu, ""))) return null;
  const path = parsed.pathname.replace(/\/+$/u, "");
  if (!path || /^\/(?:sharer|share|plugins|dialog|login|help|ads|tr|events)(?:\/|$)/iu.test(path)) return null;
  parsed.search = "";
  parsed.hash = "";
  parsed.hostname = "www.facebook.com";
  parsed.pathname = path;
  return parsed.toString();
}

function facebookPageIdFromUrl(url) {
  const path = new URL(url).pathname.split("/").filter(Boolean);
  const numeric = [...path].reverse().find((part) => /^\d{8,}$/u.test(part));
  return numeric || null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function facebookPageIdFromHtml(html, slug) {
  const escapedSlug = slug ? escapeRegex(slug) : null;
  const slugMatch = escapedSlug
    ? new RegExp(`"userID"\\s*:\\s*"(?<id>\\d{8,})"\\s*,\\s*"userVanity"\\s*:\\s*"${escapedSlug}"`, "iu").exec(html)
    : null;
  if (slugMatch?.groups?.id) return slugMatch.groups.id;
  const userId = /"userID"\s*:\s*"(?<id>\d{8,})"/iu.exec(html)?.groups?.id;
  if (userId && userId !== "0") return userId;
  const profileId = /"profile_id"\s*:\s*"(?<id>\d{8,})"/iu.exec(html)?.groups?.id;
  if (profileId && profileId !== "0") return profileId;
  return null;
}

function facebookSlugFromUrl(url) {
  const path = new URL(url).pathname.split("/").filter(Boolean);
  const blocked = new Set(["pages", "pg", "profile.php"]);
  return path.find((part) => part && !blocked.has(part.toLowerCase()) && !/^\d+$/u.test(part)) || path.join(":");
}

function metaAdLibraryKnownFacebookQueries(urls) {
  const queries = [];
  for (const url of urls || []) {
    let slug = "";
    try {
      slug = decodeURIComponent(facebookSlugFromUrl(url));
    } catch {
      continue;
    }
    const raw = slug.replace(/[-_]+/gu, " ").trim();
    const spaced = slug
      .replace(/([a-z])([A-Z])/gu, "$1 $2")
      .replace(/[._:/-]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    for (const query of [spaced, raw]) {
      if (query.length >= 3) queries.push(query);
    }
  }
  return [...new Set(queries)].slice(0, 3);
}

function metaAdLibraryVerifiedNameUrl(name) {
  const params = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country: "AU",
    media_type: "all",
    search_type: "keyword_unordered",
    q: name,
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

async function resolveMetaAdLibraryVerifiedNameCandidate(subject, payload, fetched, facebookCandidates, job) {
  const queryInputs = subject.kind === "agent"
    ? [payload.agentName, subject.name, subject.agency?.name ? `${subject.name} ${subject.agency.name}` : null, ...metaAdLibraryKnownFacebookQueries(facebookCandidates)]
    : [payload.agencyName, subject.name, subject.agency?.trading_name, ...metaAdLibraryKnownFacebookQueries(facebookCandidates)];
  const queries = [...new Set(queryInputs.filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim()))]
    .slice(0, subject.kind === "agent" ? 6 : 4);
  const knownFacebookUrls = [...facebookCandidates];
  let best = null;

  for (const query of queries) {
    const url = metaAdLibraryVerifiedNameUrl(query);
    try {
      const html = await browserDumpDom(url, Math.max(metaCaptureTimeoutMs, 20_000)).then((body) => body.slice(0, 2_500_000));
      const sourceDocumentId = await sourceDocument("meta_ad_library_exact_name_search", url, html, {
        ...resolverSubjectMetadata(subject),
        work_queue_id: job.id,
        verified_subject_name: query,
        location_search_allowed: false,
      });
      fetched.push({ url, sourceDocumentId, meta_ad_library_exact_name: true });
      const candidates = extractMetaSearchPageCandidates(html);
      for (const candidate of candidates) {
        const score = scoreMetaSearchPageCandidate(candidate, subject, knownFacebookUrls);
        if (!best || score > best.score) best = { ...candidate, score, sourceDocumentId, evidenceUrl: url, matchedQuery: query };
      }
    } catch (error) {
      fetched.push({ url, error: error.message, meta_ad_library_exact_name: true });
    }
  }

  return best && best.score >= 85 ? best : null;
}

function extractMetaSearchPageCandidates(html) {
  const connections = extractJsonObjectsAfterKey(html, "search_results_connection");
  const rawAds = extractCandidateAds(connections.length ? connections : html);
  const byPage = new Map();
  for (const raw of rawAds) {
    const snapshot = asObject(pick(raw, "snapshot", "ad_snapshot", "creative", "ad_creative")) || {};
    const pageId = firstString(pick(raw, "pageID", "pageId", "page_id"), pick(snapshot, "pageID", "pageId", "page_id"));
    const pageName = firstString(pick(raw, "pageName", "page_name"), pick(snapshot, "pageName", "page_name"));
    const pageUrl = firstString(pick(raw, "pageUrl", "page_url"), pick(snapshot, "page_profile_uri", "pageProfileUri", "page_url"));
    const adArchiveId = firstString(pick(raw, "adArchiveID", "adArchiveId", "ad_archive_id", "archive_id", "library_id", "id"));
    if (!pageId || !pageName || !looksLikeAdId(adArchiveId)) continue;
    const key = pageId;
    const existing = byPage.get(key);
    const candidate = {
      pageId,
      pageName,
      pageUrl: pageUrl || `https://www.facebook.com/${pageId}`,
      adArchiveId,
      caption: firstString(pick(snapshot, "caption"), pick(raw, "caption")),
      linkUrl: firstString(pick(snapshot, "linkUrl", "link_url", "url"), pick(raw, "link_url", "url", "landing_url")),
      raw,
      adCount: (existing?.adCount || 0) + 1,
    };
    byPage.set(key, existing ? { ...existing, ...candidate, adCount: existing.adCount + 1 } : candidate);
  }
  return [...byPage.values()];
}

function scoreMetaSearchPageCandidate(candidate, subject, knownFacebookUrls) {
  const subjectNorm = normalizeName(subject.name || "");
  const agencyNorm = normalizeName(subject.agency?.name || "");
  const tradingNorm = normalizeName(subject.agency?.trading_name || "");
  const pageNorm = normalizeName(candidate.pageName || "");
  const subjectTokens = significantNameTokens(subject.name || "");
  const agencyTokens = significantNameTokens(subject.agency?.name || subject.agency?.trading_name || "");
  const pageTokens = new Set(significantNameTokens(candidate.pageName || ""));
  const subjectOverlap = subjectTokens.filter((token) => pageTokens.has(token)).length;
  const agencyOverlap = agencyTokens.filter((token) => pageTokens.has(token)).length;
  const websiteDomains = [subject.agent?.website_url, subject.agency?.website_url].map(domainFromUrl).filter(Boolean);
  const candidateText = normalizeName([candidate.pageName, candidate.pageUrl, candidate.caption, candidate.linkUrl].filter(Boolean).join(" "));
  const domainMatch = websiteDomains.some((domain) => candidateText.includes(normalizeName(domain.replace(/^www\./iu, ""))));
  const knownSlugMatch = knownFacebookUrls.some((url) => {
    try {
      const knownSlug = normalizeName(facebookSlugFromUrl(url));
      const pageSlug = candidate.pageUrl ? normalizeName(facebookSlugFromUrl(candidate.pageUrl)) : "";
      return knownSlug && pageSlug && knownSlug === pageSlug;
    } catch {
      return false;
    }
  });

  let score = 0;
  if (pageNorm && pageNorm === subjectNorm) score += 94;
  else if (subjectNorm && pageNorm && (pageNorm.includes(subjectNorm) || subjectNorm.includes(pageNorm))) score += subject.kind === "agent" ? 84 : 76;
  else if (subjectTokens.length && subjectOverlap >= Math.min(2, subjectTokens.length)) score += 50 + subjectOverlap * 12;
  if (subject.kind === "agency" && pageNorm && (pageNorm === agencyNorm || pageNorm === tradingNorm)) score += 92;
  else if (subject.kind === "agency" && agencyNorm && pageNorm && (pageNorm.includes(agencyNorm) || agencyNorm.includes(pageNorm))) score += 76;
  else if (subject.kind === "agent" && agencyTokens.length && agencyOverlap >= Math.min(2, agencyTokens.length)) score += 18 + agencyOverlap * 8;
  if (knownSlugMatch) score += 35;
  if (subject.kind === "agent" && knownSlugMatch && subjectOverlap >= 1) score += 45;
  if (domainMatch) score += 30;
  if (candidate.pageId && candidate.adArchiveId) score += 10;
  if (candidate.adCount > 1) score += Math.min(10, candidate.adCount);
  if (subjectTokens.length === 0 && agencyTokens.length === 0 && !knownSlugMatch && !domainMatch) return 0;
  if (!knownSlugMatch && !domainMatch && !hasRealEstatePageSignal(candidateText)) return Math.min(score, 84);
  return Math.min(score, 100);
}

function significantNameTokens(name) {
  const stop = new Set(["a", "an", "and", "the", "of", "for", "real", "estate", "realty", "property", "properties", "agency", "group", "team", "pty", "ltd", "limited", "wa", "western", "australia", "perth"]);
  return [...new Set(normalizeName(name).split(" ").filter((token) => token.length >= 3 && !stop.has(token)))];
}

function hasRealEstatePageSignal(text) {
  return /\b(real estate|realty|property|properties|ray white|realmark|belle property|acton|harcourts|lj hooker|professionals|reiwa|home open|for sale|leased|sold)\b/iu.test(text);
}

function facebookUrlMatchesResolverSubject(pageUrl, subject) {
  if (subject.kind !== "agent") return true;
  const urlText = normalizeName(pageUrl);
  const nameTokens = significantNameTokens(subject.name || "");
  return nameTokens.length > 0 && nameTokens.some((token) => urlText.includes(token));
}

function domainFromUrl(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function resolverSubjectMetadata(subject) {
  return {
    subject_kind: subject.kind,
    subject_id: subject.id,
    agency_id: subject.agency?.id || subject.agent?.agency_id || null,
    agent_id: subject.agent?.id || null,
  };
}

async function findAgency(id) {
  const rows = await rest("research", `agencies?select=id,name,trading_name,website_url,primary_suburb,primary_postcode,metadata&id=eq.${id}&limit=1`);
  return rows?.[0] || null;
}

async function findAgent(id) {
  const rows = await rest("research", `agents?select=id,full_name,normalized_name,website_url,primary_suburb,primary_postcode,agency_id,metadata&id=eq.${id}&limit=1`);
  return rows?.[0] || null;
}

async function findResolverSubject(payload) {
  if (payload.subjectKind === "agency") {
    const agency = await findAgency(payload.subjectId);
    if (!agency) return null;
    return { kind: "agency", id: agency.id, name: agency.name, agency, agent: null };
  }
  if (payload.subjectKind === "agent") {
    const agent = await findAgent(payload.subjectId);
    if (!agent) return null;
    const agency = agent.agency_id ? await findAgency(agent.agency_id) : null;
    return { kind: "agent", id: agent.id, name: agent.full_name, agency, agent };
  }
  return null;
}

function resolverEvidenceUrls(subject, payload) {
  return [
    payload.profileUrl,
    payload.reiwaUrl,
    payload.websiteUrl,
    subject.agent?.website_url,
    subject.agency?.website_url,
    subject.agency?.metadata?.reiwa_url,
  ].filter((url) => typeof url === "string" && /^https:\/\//iu.test(url));
}

async function createPageResolutionDecision(input) {
  const created = await rest("research", "agent_decisions", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: json({
      decision_type: "page_resolution",
      subject_type: input.subjectKind || "agency",
      subject_id: input.subjectId || input.agencyId,
      decision: input.decision,
      rationale: input.rationale,
      confidence: input.confidence,
      evidence: input.evidence,
      source_document_ids: input.sourceDocumentIds || [],
      hermes_session_id: workerId,
      hermes_skill: "blockwise-page-resolver",
      model: "deterministic",
    }),
  });
  return created?.[0]?.id || null;
}

async function upsertAdvertiserPage(input) {
  const row = {
    platform: "facebook",
    page_id: input.pageId,
    page_name: input.pageName,
    page_url: input.pageUrl,
    agent_id: input.agentId || null,
    agency_id: input.agencyId,
    status: input.status,
    confidence: input.confidence,
    resolution_decision_id: input.decisionId,
    resolved_at: input.status === "resolved_collectable" ? now() : null,
    metadata: {
      source: "hermes-page-resolver",
      page_slug: input.pageSlug,
      evidence_urls: input.evidenceUrls,
      ...(input.metadata || {}),
    },
    last_seen_at: now(),
  };
  let rows;
  try {
    rows = await rest("research", "advertiser_pages?on_conflict=platform,page_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: json(row),
    });
  } catch (error) {
    if (!/resolution_decision_id|resolved_at|schema cache|PGRST204|42703/i.test(error.message)) throw error;
    const { resolution_decision_id: _decisionId, resolved_at: _resolvedAt, ...compatibleRow } = row;
    rows = await rest("research", "advertiser_pages?on_conflict=platform,page_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: json(compatibleRow),
    });
  }
  return rows?.[0]?.id || null;
}

async function insertCoverageDefect(row) {
  try {
    await rest("research", "coverage_defects", {
      method: "POST",
      body: json(row),
    });
  } catch (error) {
    if (!/reporter_identity|resolution_decision_id|resolved_agent_id|resolved_agency_id|resolved_advertiser_page_id|resolved_at|schema cache|PGRST204|42703/i.test(error.message)) throw error;
    const {
      reporter_identity: _reporterIdentity,
      resolution_decision_id: _resolutionDecisionId,
      resolved_agent_id: _resolvedAgentId,
      resolved_agency_id: _resolvedAgencyId,
      resolved_advertiser_page_id: _resolvedAdvertiserPageId,
      resolved_at: _resolvedAt,
      ...compatibleRow
    } = row;
    await rest("research", "coverage_defects", {
      method: "POST",
      body: json(compatibleRow),
    });
  }
}

async function enqueueCollectorForPage(page, job) {
  return enqueueFollowUp({
    queue_name: "research",
    job_type: "blockwise-ad-collector",
    dedupe_key: `ad-collector:${page.advertiserPageId}`,
    advertiser_page_id: page.advertiserPageId,
    priority: 4,
    payload: {
      advertiserPageId: page.advertiserPageId,
      metaPageId: page.metaPageId,
      build_run_id: page.buildRunId || null,
      resolverDecisionId: page.decisionId,
      realEstateGate: {
        verified: true,
        verifiedBySkill: "blockwise-agent-census",
        decisionId: page.censusDecisionId,
        sourceDocumentIds: page.sourceDocumentIds,
        verifiedAt: now(),
      },
      country: "AU",
      activeStatus: "all",
      resultsLimit: 50,
    },
    status: "pending",
    max_attempts: 3,
  }, job);
}

async function handleAgentCensus(job) {
  const payload = job.payload || {};
  const found = [];
  const errors = [];
  for (const url of evidenceUrls(payload)) {
    try {
      const html = await fetchText(url);
      const sourceDocumentId = await sourceDocument("agency_roster", url, html, { postcode: payload.postcode, state: payload.state, work_queue_id: job.id });
      const rosterEntries = extractReiwaRosterEntries(url, html, payload);
      if (rosterEntries.length) {
        const seenRosterPeople = new Set();
        for (const entry of rosterEntries) {
          const key = `${normalizeName(entry.agent?.full_name || "")}:${normalizeName(entry.name)}:${entry.state}`;
          if (seenRosterPeople.has(key)) continue;
          seenRosterPeople.add(key);
          found.push(await upsertVerifiedAgency(entry, sourceDocumentId, job));
        }
        continue;
      }
      const agency = agencyFromPayload({ ...payload, evidence_url: url }) || agencyFromHtml(url, html, payload);
      if (agency) found.push(await upsertVerifiedAgency(agency, sourceDocumentId, job));
    } catch (error) {
      errors.push({ url, error: error.message });
    }
  }

  if (found.length) {
    let queuedResolvers = 0;
    for (const item of found) {
      for (const followUp of item.followUps || [item.followUp].filter(Boolean)) {
        if (await enqueueFollowUp(followUp, job)) queuedResolvers += 1;
      }
    }
    await rest("research", `refresh_policies?postcode=eq.${encode(payload.postcode)}&state=eq.${encode(payload.state || "WA")}`, {
      method: "PATCH",
      body: json({
        last_refreshed_at: now(),
        next_refresh_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      }),
    });
    return { status: "complete", result: { handler: "blockwise-agent-census", verified_agencies: found.length, queued_page_resolvers: queuedResolvers, errors } };
  }

  const reason = errors.length ? "census_evidence_fetch_failed" : "census_requires_verified_evidence";
  await insertCoverageDefect({ postcode: payload.postcode, state: payload.state || "WA", notes: `Hermes census could not verify an evidence-backed roster without allowed public evidence (${reason}).`, reported_by: "system", reporter_identity: workerId, status: "blocked", resolution: { reason, errors, location_search_allowed: false } });
  return { status: "blocked", blocked_reason: reason, result: { handler: "blockwise-agent-census", reason, errors, location_search_allowed: false } };
}

async function handlePageResolver(job) {
  const payload = job.payload || {};
  if (!payload.subjectId || !payload.censusDecisionId || !Array.isArray(payload.sourceDocumentIds) || payload.sourceDocumentIds.length === 0) {
    return { status: "blocked", blocked_reason: "page_resolver_missing_verified_census_handoff", result: { handler: "blockwise-page-resolver", reason: "missing censusDecisionId/sourceDocumentIds/subjectId" } };
  }

  const subject = await findResolverSubject(payload);
  if (!subject) {
    return { status: "blocked", blocked_reason: "page_resolver_subject_missing", result: { handler: "blockwise-page-resolver", subject_kind: payload.subjectKind, subject_id: payload.subjectId } };
  }

  const subjectMeta = resolverSubjectMetadata(subject);
  const evidenceUrlsToFetch = resolverEvidenceUrls(subject, payload);
  const fetched = [];
  const facebookCandidates = new Set();
  const websiteCandidates = new Set();

  for (const url of [...new Set(evidenceUrlsToFetch)].slice(0, 4)) {
    try {
      const html = await fetchText(url);
      const sourceDocumentId = await sourceDocument("page_resolution_evidence", url, html, { ...subjectMeta, work_queue_id: job.id });
      fetched.push({ url, sourceDocumentId });
      for (const link of facebookLinks(url, html)) facebookCandidates.add(link);
      for (const link of candidateWebsiteLinks(url, html)) websiteCandidates.add(link);
    } catch (error) {
      fetched.push({ url, error: error.message });
    }
  }

  for (const url of [...websiteCandidates].slice(0, 3)) {
    try {
      const html = await fetchText(url);
      const sourceDocumentId = await sourceDocument("subject_website", url, html, { ...subjectMeta, work_queue_id: job.id });
      fetched.push({ url, sourceDocumentId });
      for (const link of facebookLinks(url, html)) facebookCandidates.add(link);
    } catch (error) {
      fetched.push({ url, error: error.message });
    }
  }

  const resolved = [];
  for (const pageUrl of [...facebookCandidates]) {
    if (!facebookUrlMatchesResolverSubject(pageUrl, subject)) {
      fetched.push({ url: pageUrl, skipped: "facebook_url_does_not_match_verified_subject" });
      continue;
    }
    const pageSlug = facebookSlugFromUrl(pageUrl);
    let numericId = facebookPageIdFromUrl(pageUrl);
    let facebookSourceDocumentId = null;
    if (!numericId) {
      try {
        const html = await fetchFacebookPageDocument(pageUrl);
        facebookSourceDocumentId = await sourceDocument("meta_page", pageUrl, html, { ...subjectMeta, work_queue_id: job.id, page_slug: pageSlug });
        fetched.push({ url: pageUrl, sourceDocumentId: facebookSourceDocumentId });
        numericId = facebookPageIdFromHtml(html, pageSlug);
      } catch (error) {
        fetched.push({ url: pageUrl, error: error.message });
      }
    }
    const confidence = numericId ? 92 : 78;
    const decisionId = await createPageResolutionDecision({
      subjectKind: subject.kind,
      subjectId: subject.id,
      agentId: subject.agent?.id || null,
      agencyId: subject.agency?.id || null,
      confidence,
      sourceDocumentIds: fetched.map((item) => item.sourceDocumentId).filter(Boolean),
      evidence: { page_url: pageUrl, evidence_urls: fetched.map((item) => item.url), page_slug: pageSlug, numeric_page_id_found: Boolean(numericId), subject_name: subject.name },
      decision: {
        resolved: Boolean(numericId),
        collectable: Boolean(numericId),
        page_url: pageUrl,
        page_id: numericId || pageSlug,
        location_search_allowed: false,
      },
      rationale: numericId
        ? "Resolved a verified real-estate subject to a Facebook page from controlled evidence before collection."
        : "Found a Facebook page link from controlled evidence but could not confirm a numeric Meta page id for collection.",
    });
    const advertiserPageId = await upsertAdvertiserPage({
      agentId: subject.agent?.id || null,
      agencyId: subject.agency?.id || null,
      decisionId,
      pageId: numericId || `slug:${pageSlug}`,
      pageSlug,
      pageName: subject.name,
      pageUrl,
      status: numericId ? "resolved_collectable" : "verified_real_estate_unresolved",
      confidence,
      evidenceUrls: fetched.map((item) => item.url),
    });
    if (advertiserPageId) {
      await rest("research", "real_estate_verifications", {
        method: "POST",
        body: json({
          subject_type: "advertiser_page",
          subject_id: advertiserPageId,
          advertiser_page_id: advertiserPageId,
          agent_id: subject.agent?.id || null,
          agency_id: subject.agency?.id || null,
          verification_status: numericId ? "verified" : "needs_review",
          evidence_type: "meta_page",
          evidence_url: pageUrl,
          evidence: { subject_kind: subject.kind, subject_name: subject.name, agent_name: subject.agent?.full_name || null, agency_name: subject.agency?.name || null, page_slug: pageSlug, numeric_page_id_found: Boolean(numericId) },
          source_document_id: fetched.find((item) => item.sourceDocumentId)?.sourceDocumentId || null,
          verified_by: "blockwise-page-resolver",
          verified_at: numericId ? now() : null,
          confidence,
          notes: numericId ? "Hermes deterministic page verification." : "Facebook page link found; numeric page id still required before collection.",
        }),
      });
      resolved.push({ advertiserPageId, pageUrl, pageSlug, metaPageId: numericId, decisionId });
      if (numericId) {
        await enqueueCollectorForPage({
          advertiserPageId,
          metaPageId: numericId,
          buildRunId: payload.build_run_id || null,
          decisionId,
          censusDecisionId: payload.censusDecisionId,
          sourceDocumentIds: payload.sourceDocumentIds,
        }, job);
      }
    }
  }

  const exactNameCandidate = await resolveMetaAdLibraryVerifiedNameCandidate(subject, payload, fetched, facebookCandidates, job);
  if (exactNameCandidate && !resolved.some((item) => item.metaPageId === exactNameCandidate.pageId)) {
    const decisionId = await createPageResolutionDecision({
      subjectKind: subject.kind,
      subjectId: subject.id,
      agentId: subject.agent?.id || null,
      agencyId: subject.agency?.id || null,
      confidence: exactNameCandidate.score,
      sourceDocumentIds: [exactNameCandidate.sourceDocumentId, ...payload.sourceDocumentIds].filter(Boolean),
      evidence: {
        page_url: exactNameCandidate.pageUrl,
        evidence_urls: fetched.map((item) => item.url),
        page_name: exactNameCandidate.pageName,
        matched_query: exactNameCandidate.matchedQuery,
        ad_archive_id: exactNameCandidate.adArchiveId,
        subject_name: subject.name,
        resolver: "meta_ad_library_exact_verified_name_search",
      },
      decision: {
        resolved: true,
        collectable: true,
        page_url: exactNameCandidate.pageUrl,
        page_id: exactNameCandidate.pageId,
        location_search_allowed: false,
      },
      rationale: "Resolved a verified real-estate subject to an ad-bearing Meta page from exact verified-name Meta Ad Library search; collection remains page-id only.",
    });
    const advertiserPageId = await upsertAdvertiserPage({
      agentId: subject.agent?.id || null,
      agencyId: subject.agency?.id || null,
      decisionId,
      pageId: exactNameCandidate.pageId,
      pageSlug: exactNameCandidate.pageUrl ? facebookSlugFromUrl(exactNameCandidate.pageUrl) : null,
      pageName: exactNameCandidate.pageName,
      pageUrl: exactNameCandidate.pageUrl,
      status: "resolved_collectable",
      confidence: exactNameCandidate.score,
      evidenceUrls: fetched.map((item) => item.url),
      metadata: {
        resolver: "meta_ad_library_exact_verified_name_search",
        matched_query: exactNameCandidate.matchedQuery,
        ad_archive_id: exactNameCandidate.adArchiveId,
        ad_count_seen_in_search: exactNameCandidate.adCount,
      },
    });
    if (advertiserPageId) {
      await rest("research", "real_estate_verifications", {
        method: "POST",
        body: json({
          subject_type: "advertiser_page",
          subject_id: advertiserPageId,
          advertiser_page_id: advertiserPageId,
          agent_id: subject.agent?.id || null,
          agency_id: subject.agency?.id || null,
          verification_status: "verified",
          evidence_type: "meta_page",
          evidence_url: exactNameCandidate.evidenceUrl,
          evidence: { subject_kind: subject.kind, subject_name: subject.name, agent_name: subject.agent?.full_name || null, agency_name: subject.agency?.name || null, page_name: exactNameCandidate.pageName, matched_query: exactNameCandidate.matchedQuery, page_id: exactNameCandidate.pageId, ad_archive_id: exactNameCandidate.adArchiveId },
          source_document_id: exactNameCandidate.sourceDocumentId || null,
          verified_by: "blockwise-page-resolver",
          verified_at: now(),
          confidence: exactNameCandidate.score,
          notes: "Hermes exact-name Meta Ad Library page verification.",
        }),
      });
      resolved.push({ advertiserPageId, pageUrl: exactNameCandidate.pageUrl, pageSlug: exactNameCandidate.pageUrl ? facebookSlugFromUrl(exactNameCandidate.pageUrl) : null, metaPageId: exactNameCandidate.pageId, decisionId });
      await enqueueCollectorForPage({
        advertiserPageId,
        metaPageId: exactNameCandidate.pageId,
        buildRunId: payload.build_run_id || null,
        decisionId,
        censusDecisionId: payload.censusDecisionId,
        sourceDocumentIds: payload.sourceDocumentIds,
      }, job);
    }
  }

  if (resolved.length) {
    return {
      status: "complete",
      result: {
        handler: "blockwise-page-resolver",
        subject_kind: subject.kind,
        subject_id: subject.id,
        agent_id: subject.agent?.id || null,
        agency_id: subject.agency?.id || null,
        resolved_pages: resolved.length,
        collectable_pages: resolved.filter((item) => item.metaPageId).length,
        collection_started: resolved.some((item) => item.metaPageId),
      },
    };
  }

  await insertCoverageDefect({
    state: "WA",
    agent_name: subject.agent?.full_name || null,
    agency_name: subject.agency?.name || null,
    notes: "Hermes page resolver could not find a Facebook page from verified-subject evidence.",
    reported_by: "system",
    reporter_identity: workerId,
    status: "open",
    resolution: { fetched, location_search_allowed: false },
    resolved_agent_id: subject.agent?.id || null,
    resolved_agency_id: subject.agency?.id || null,
  });
  return { status: "blocked", blocked_reason: "page_resolver_no_verified_meta_page", result: { handler: "blockwise-page-resolver", subject_kind: subject.kind, subject_id: subject.id, agent_id: subject.agent?.id || null, agency_id: subject.agency?.id || null, fetched, location_search_allowed: false } };
}

function captureInput(payload) {
  return {
    advertiserPageId: payload.advertiserPageId,
    metaPageId: String(payload.metaPageId),
    country: String(payload.country || "AU").toUpperCase(),
    activeStatus: ["active", "inactive", "all"].includes(payload.activeStatus) ? payload.activeStatus : "all",
    resultsLimit: Math.max(1, Math.min(Number.parseInt(payload.resultsLimit || "50", 10) || 50, 250)),
    realEstateGate: payload.realEstateGate,
    resolverDecisionId: payload.resolverDecisionId || null,
  };
}

function normalizeCaptureOutcome(body, input, provider, startedAt) {
  const normalised = normaliseHostedMetaItems({ body, pageId: input.metaPageId, limit: input.resultsLimit });
  return {
    runId: extractString(body, "runId", "run_id", "id") || `${provider}-${input.metaPageId}-${Date.now()}`,
    provider,
    status: normalised.warnings.length ? "FAILED" : "SUCCEEDED",
    startedAt,
    finishedAt: now(),
    costUsd: Number(body?.costUsd || body?.cost_usd || 0) || 0,
    itemCount: normalised.items.length,
    items: normalised.items,
    rawDatasetId: extractString(body, "rawDatasetId", "raw_dataset_id", "datasetId", "dataset_id"),
    errorMessage: normalised.warnings.join("; ") || null,
    metadata: {
      responseKeys: body && typeof body === "object" ? Object.keys(body) : [],
      confirmed_absence: false,
      advertiserPageId: input.advertiserPageId,
      resolverDecisionId: input.resolverDecisionId,
    },
  };
}

async function runHermesBrowserCapture(input) {
  const startedAt = now();
  const url = metaAdLibraryPageUrl(input);
  try {
    const stdout = await browserDumpDom(url, metaCaptureTimeoutMs);
    const parsed = normaliseMetaAdLibraryHtml({ html: stdout, pageId: input.metaPageId, limit: input.resultsLimit });
    return {
      runId: `hermes-browser-${input.metaPageId}-${Date.now()}`,
      provider: "hermes_browser",
      status: parsed.warnings.length ? "FAILED" : "SUCCEEDED",
      startedAt,
      finishedAt: now(),
      costUsd: 0,
      itemCount: parsed.items.length,
      items: parsed.items,
      rawDatasetId: null,
      errorMessage: parsed.warnings.join("; ") || null,
      metadata: {
        url,
        html_bytes: Buffer.byteLength(stdout),
        confirmed_absence: parsed.confirmedAbsence,
        connection_count: parsed.connectionCount,
        advertiserPageId: input.advertiserPageId,
        resolverDecisionId: input.resolverDecisionId,
      },
    };
  } catch (error) {
    return {
      runId: `hermes-browser-failed-${input.metaPageId}-${Date.now()}`,
      provider: "hermes_browser",
      status: "FAILED",
      startedAt,
      finishedAt: now(),
      costUsd: 0,
      itemCount: 0,
      items: [],
      rawDatasetId: null,
      errorMessage: error.message,
      metadata: { executable: metaBrowserExecutable, advertiserPageId: input.advertiserPageId, resolverDecisionId: input.resolverDecisionId },
    };
  }
}

function metaAdLibraryPageUrl(input) {
  const params = new URLSearchParams({
    active_status: input.activeStatus,
    ad_type: "all",
    country: input.country,
    view_all_page_id: input.metaPageId,
    media_type: "all",
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

function normaliseMetaAdLibraryHtml({ html, pageId, limit }) {
  const connections = extractJsonObjectsAfterKey(html, "search_results_connection");
  const bodies = connections.length ? connections : [html];
  const normalised = normaliseHostedMetaItems({ body: bodies, pageId, limit });
  const counts = connections.map((connection) => Number(connection?.count)).filter(Number.isFinite);
  const confirmedAbsence = connections.some((connection) => Number(connection?.count) === 0 && objectArray(connection?.edges).length === 0);
  if (!normalised.items.length && !confirmedAbsence) {
    normalised.warnings.push("Meta Ad Library page loaded but no ad result payload could be parsed.");
  }
  return {
    ...normalised,
    confirmedAbsence,
    connectionCount: counts.length ? Math.max(...counts) : null,
  };
}

function extractJsonObjectsAfterKey(text, key) {
  const out = [];
  let cursor = 0;
  const marker = `"${key}"`;
  while (cursor < text.length) {
    const keyIndex = text.indexOf(marker, cursor);
    if (keyIndex === -1) break;
    const colonIndex = text.indexOf(":", keyIndex + marker.length);
    const braceIndex = colonIndex === -1 ? -1 : text.indexOf("{", colonIndex + 1);
    if (braceIndex === -1) {
      cursor = keyIndex + marker.length;
      continue;
    }
    const endIndex = findJsonObjectEnd(text, braceIndex);
    if (endIndex === -1) {
      cursor = braceIndex + 1;
      continue;
    }
    try {
      out.push(JSON.parse(text.slice(braceIndex, endIndex + 1)));
    } catch {
      // Meta can change embedded payloads without changing the page shell.
    }
    cursor = endIndex + 1;
  }
  return out;
}

function findJsonObjectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function normaliseHostedMetaItems(input) {
  const warnings = [];
  const candidates = extractCandidateAds(input.body).slice(0, input.limit);
  const items = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const item = normaliseHostedMetaAd(candidate, input.pageId);
    if (!looksLikeAdId(item.adArchiveID) || seen.has(item.adArchiveID)) continue;
    seen.add(item.adArchiveID);
    items.push(item);
  }
  return { items, warnings };
}

function extractCandidateAds(body) {
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (value) => {
    if (!isAdLikeObject(value)) return;
    const item = value.node && typeof value.node === "object" ? value.node : value;
    const key = firstString(pick(item, "adArchiveID", "adArchiveId", "ad_archive_id", "archive_id", "library_id", "id")) || hash(json(item)).slice(0, 16);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(item);
  };
  for (const object of walkObjects(body)) {
    for (const collated of objectArray(object.collated_results)) pushCandidate(collated);
    pushCandidate(object);
  }
  return candidates;
}

function collectArrays(value) {
  const out = [];
  if (Array.isArray(value)) {
    out.push(value);
    for (const child of value) out.push(...collectArrays(child));
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) out.push(...collectArrays(child));
  }
  return out;
}

function walkObjects(value) {
  const out = [];
  if (Array.isArray(value)) {
    for (const child of value) out.push(...walkObjects(child));
  } else if (value && typeof value === "object") {
    out.push(value);
    for (const child of Object.values(value)) out.push(...walkObjects(child));
  }
  return out;
}

function isAdLikeObject(value) {
  if (!value || typeof value !== "object") return false;
  const obj = value.node && typeof value.node === "object" ? value.node : value;
  return looksLikeAdId(pick(obj, "adArchiveID", "adArchiveId", "ad_archive_id", "archive_id", "library_id", "id"));
}

function normaliseHostedMetaAd(raw, pageId) {
  const snapshot = asObject(pick(raw, "snapshot", "ad_snapshot", "creative", "ad_creative")) || raw;
  const cards = objectArray(pick(snapshot, "cards", "asset_cards", "ad_cards"));
  const firstCard = cards[0] || null;
  const adId = String(pick(raw, "adArchiveID", "adArchiveId", "ad_archive_id", "archive_id", "library_id", "id"));
  const imageUrls = collectStrings(
    pick(firstCard, "imageUrl", "image_url", "originalImageUrl", "original_image_url", "resizedImageUrl", "resized_image_url"),
    pick(snapshot, "images", "image_urls", "ad_creative_images"),
    pick(raw, "images", "image_urls", "ad_creative_images", "adCreativeImages"),
  );
  const videoUrls = collectStrings(
    pick(firstCard, "videoHdUrl", "video_hd_url", "videoSdUrl", "video_sd_url"),
    pick(snapshot, "videos", "video_urls"),
    pick(raw, "videos", "video_urls", "ad_creative_videos", "adCreativeVideos"),
  );
  const thumbnailUrls = collectStrings(
    pick(firstCard, "videoPreviewImageUrl", "video_preview_image_url", "thumbnailUrl", "thumbnail_url"),
    pick(snapshot, "videoPreviewImageUrl", "video_preview_image_url", "thumbnailUrl", "thumbnail_url"),
    pick(raw, "video_preview_image_url", "thumbnail_url", "videoPreviewImageUrl", "thumbnailUrl"),
  );
  const pageName = firstString(pick(raw, "pageName", "page_name"), pick(snapshot, "pageName", "page_name"));
  const normalisedPageId = String(pick(raw, "pageID", "pageId", "page_id") || pageId);
  return {
    adArchiveID: adId,
    id: adId,
    pageID: normalisedPageId,
    pageName,
    isActive: deriveIsActive(raw),
    status: firstString(pick(raw, "status", "ad_active_status")),
    startDate: pick(raw, "startDate", "start_date", "ad_delivery_start_time", "adDeliveryStartTime"),
    endDate: pick(raw, "endDate", "end_date", "ad_delivery_stop_time", "adDeliveryStopTime"),
    publisherPlatform: normalisePlatforms(pick(raw, "publisherPlatform", "publisher_platforms", "publisher_platform", "platforms")),
    snapshot: {
      title: firstString(
        pick(firstCard, "title", "headline"),
        pick(snapshot, "title", "headline"),
        firstArrayString(pick(raw, "ad_creative_link_titles", "adCreativeLinkTitles", "titles")),
        pick(raw, "title", "headline"),
      ),
      body: firstString(
        pick(firstCard, "body", "text"),
        pick(snapshot, "body", "text"),
        firstArrayString(pick(raw, "ad_creative_bodies", "adCreativeBodies", "bodies")),
        pick(raw, "body", "text"),
      ),
      caption: firstString(pick(firstCard, "caption"), pick(snapshot, "caption"), firstArrayString(pick(raw, "ad_creative_link_captions"))),
      ctaText: firstString(pick(firstCard, "ctaText", "cta_text"), pick(snapshot, "ctaText", "cta_text"), pick(raw, "cta_text", "cta")),
      linkUrl: firstString(
        pick(firstCard, "linkUrl", "link_url", "url"),
        pick(snapshot, "linkUrl", "link_url", "url"),
        firstArrayString(pick(raw, "ad_creative_link_urls", "adCreativeLinkUrls", "link_urls")),
        pick(raw, "link_url", "url", "landing_url"),
      ),
      cards,
      images: imageUrls.map((url) => ({ originalImageUrl: url })),
      videos: videoUrls.map((url) => ({ videoHdUrl: url })),
      thumbnails: thumbnailUrls.map((url) => ({ thumbnailUrl: url })),
      displayFormat: firstString(pick(snapshot, "displayFormat", "display_format")),
      pageName,
      pageId: normalisedPageId,
    },
    inputUrl: firstString(pick(raw, "ad_snapshot_url", "snapshot_url", "url")) || `https://www.facebook.com/ads/library/?id=${adId}`,
    rawHostedProvider: raw,
  };
}

function pick(source, ...keys) {
  if (!source || typeof source !== "object") return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function objectArray(value) {
  return Array.isArray(value) ? value.filter((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = firstString(pick(value, "text", "value", "display_text", "label", "title", "name", "url"));
      if (nested) return nested;
    }
  }
  return null;
}

function firstArrayString(value) {
  return Array.isArray(value) ? firstString(...value) : null;
}

function collectStrings(...values) {
  const out = new Set();
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      out.add(decodeHtml(value));
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) out.add(decodeHtml(item));
        else if (item && typeof item === "object") {
          const url = firstString(pick(item, "url", "uri", "src", "imageUrl", "originalImageUrl", "videoHdUrl", "videoSdUrl", "thumbnailUrl"));
          const snakeUrl = firstString(pick(item, "image_url", "original_image_url", "resized_image_url", "video_hd_url", "video_sd_url", "thumbnail_url"));
          if (url) out.add(decodeHtml(url));
          if (snakeUrl) out.add(decodeHtml(snakeUrl));
        }
      }
    }
  }
  return [...out].filter((url) => /^https?:\/\//iu.test(url));
}

function deriveIsActive(raw) {
  const explicit = pick(raw, "isActive", "is_active");
  if (typeof explicit === "boolean") return explicit;
  const status = firstString(pick(raw, "status", "ad_active_status"))?.toLowerCase();
  if (status === "active") return true;
  if (status === "inactive" || status === "ended" || status === "stopped") return false;
  return null;
}

function normalisePlatforms(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).toLowerCase()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.toLowerCase()];
  return ["facebook"];
}

function looksLikeAdId(value) {
  return typeof value === "string" || typeof value === "number" ? /^\d{8,}$/u.test(String(value)) : false;
}

function extractString(body, ...keys) {
  if (!body || typeof body !== "object") return null;
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function metaTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d+$/u.test(String(value))) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return new Date(number > 10_000_000_000 ? number : number * 1000).toISOString();
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalisePlatformForDb(platforms) {
  const allowed = new Set(["facebook", "instagram", "audience_network", "messenger"]);
  return platforms.find((platform) => allowed.has(platform)) || "facebook";
}

function creativeFromMetaAd(ad) {
  const snapshot = ad.snapshot || {};
  const imageUrls = collectStrings(snapshot.images, snapshot.cards?.map?.((card) => [card.imageUrl, card.originalImageUrl, card.resizedImageUrl]) || []);
  const videoUrls = collectStrings(snapshot.videos, snapshot.cards?.map?.((card) => [card.videoHdUrl, card.videoSdUrl]) || []);
  const thumbnailUrls = collectStrings(snapshot.thumbnails, snapshot.cards?.map?.((card) => [card.videoPreviewImageUrl, card.thumbnailUrl]) || []);
  const format = objectArray(snapshot.cards).length > 1 ? "carousel" : videoUrls.length ? "video" : imageUrls.length ? "image" : "unknown";
  return {
    format,
    headline: firstString(snapshot.title),
    body: firstString(snapshot.body),
    description: firstString(snapshot.caption),
    cta: firstString(snapshot.ctaText),
    cta_url: firstString(snapshot.linkUrl),
    landing_url: firstString(snapshot.linkUrl),
    primary_image_url: imageUrls[0] || null,
    image_urls: imageUrls,
    video_url: videoUrls[0] || null,
    video_thumbnail_url: thumbnailUrls[0] || null,
    mediaSources: [
      ...imageUrls.map((url, index) => ({ kind: "image", source_url: url, external_asset_id: `image:${index}:${hash(url).slice(0, 12)}` })),
      ...videoUrls.map((url, index) => ({ kind: "video", source_url: url, external_asset_id: `video:${index}:${hash(url).slice(0, 12)}` })),
      ...thumbnailUrls.map((url, index) => ({ kind: "thumbnail", source_url: url, external_asset_id: `thumbnail:${index}:${hash(url).slice(0, 12)}` })),
    ],
  };
}

async function insertFetchRun(job, buildRunId, input, provider) {
  const row = {
    build_run_id: buildRunId,
    work_queue_id: job.id,
    source_provider: provider,
    role: "primary",
    trigger: "scheduled",
    target_kind: "advertiser_page",
    target_value: input.advertiserPageId,
    input_payload: input,
    input_hash: hash(json(input)),
    status: "running",
    result_summary: {},
  };
  const created = await writeFetchRunWithMissingColumnFallback("ad_fetch_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
  }, row);
  return created?.[0]?.id;
}

async function updateFetchRun(id, patch) {
  await writeFetchRunWithMissingColumnFallback(`ad_fetch_runs?id=eq.${id}`, {
    method: "PATCH",
  }, { completed_at: now(), ...patch });
}

async function writeFetchRunWithMissingColumnFallback(path, options, row) {
  const compatibleRow = { ...row };
  const removedColumns = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      return await rest("research", path, {
        ...options,
        body: json(compatibleRow),
      });
    } catch (error) {
      const column = missingSchemaColumn(error);
      if (!column || !Object.prototype.hasOwnProperty.call(compatibleRow, column)) {
        throw error;
      }
      delete compatibleRow[column];
      removedColumns.push(column);
    }
  }
  throw new Error(`ad_fetch_runs write still incompatible after removing ${removedColumns.join(", ")}`);
}

function missingSchemaColumn(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Could not find the '([^']+)' column/iu.exec(message)?.[1] || null;
}

function missingSchemaRelation(error, relation) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("PGRST205") && message.includes(`'research.${relation}'`);
}

async function ingestMetaAd({ ad, advertiserPageId, adFetchRunId, buildRunId, sourceProvider, parentJob }) {
  const rawPayload = ad.rawHostedProvider || ad;
  const payloadHash = hash(json(rawPayload));
  const platforms = normalisePlatforms(ad.publisherPlatform);
  const creative = creativeFromMetaAd(ad);
  const creativeHash = hash(json({
    headline: creative.headline,
    body: creative.body,
    description: creative.description,
    cta: creative.cta,
    cta_url: creative.cta_url,
    format: creative.format,
    image_urls: creative.image_urls,
    video_url: creative.video_url,
    video_thumbnail_url: creative.video_thumbnail_url,
  }));
  const observed = await rest("research", "observed_ads?on_conflict=advertiser_page_id,external_ad_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: json({
      external_ad_id: ad.adArchiveID,
      advertiser_page_id: advertiserPageId,
      first_seen_provider: sourceProvider,
      platform: normalisePlatformForDb(platforms),
      active_status: ad.isActive === false ? "inactive" : "active",
      last_seen_at: now(),
      last_checked_at: now(),
      missing_successive_checks: 0,
      meta_publisher_platforms: platforms,
      ad_delivery_started_at: metaTimestamp(ad.startDate),
      ad_delivery_stopped_at: metaTimestamp(ad.endDate),
      raw_payload: rawPayload,
      payload_hash: payloadHash,
      metadata: { ad_library_url: ad.inputUrl || `https://www.facebook.com/ads/library/?id=${ad.adArchiveID}`, page_id: ad.pageID },
    }),
  });
  const observedAd = observed?.[0];
  if (!observedAd?.id) throw new Error(`observed_ads upsert did not return an id for ${ad.adArchiveID}`);

  const snapshot = await insertSnapshot({ observedAdId: observedAd.id, adFetchRunId, sourceProvider, rawPayload, payloadHash });
  const adCreative = await upsertAdCreative({
    observed_ad_id: observedAd.id,
    ad_snapshot_id: snapshot?.id || null,
    format: creative.format,
    headline: creative.headline,
    body: creative.body,
    cta: creative.cta,
    cta_url: creative.cta_url,
    primary_image_url: creative.primary_image_url,
    image_urls: creative.image_urls,
    video_url: creative.video_url,
    video_thumbnail_url: creative.video_thumbnail_url,
    landing_url: creative.landing_url,
    creative_hash: creativeHash,
    media_assets: [],
    classification_status: "unclassified",
    display_state: "pending_review",
    metadata: { description: creative.description, page_name: ad.pageName, page_id: ad.pageID, source_provider: sourceProvider },
  });
  if (!adCreative?.id) throw new Error(`ad_creatives upsert did not return an id for ${ad.adArchiveID}`);
  await insertCreativeVersion({ adCreative, observedAdId: observedAd.id, snapshotId: snapshot?.id || null, creative, creativeHash });
  const mediaCount = await upsertMediaAssets({ creativeId: adCreative.id, observedAdId: observedAd.id, snapshotId: snapshot?.id || null, mediaSources: creative.mediaSources });
  await upsertAreaMatchesForObservedAd({ advertiserPageId, observedAdId: observedAd.id });
  return { observed_ad_id: observedAd.id, ad_creative_id: adCreative.id, creative_hash: creativeHash, external_ad_id: ad.adArchiveID, media_sources: mediaCount };
}

async function upsertAdCreative(row) {
  try {
    const rows = await rest("research", "ad_creatives?on_conflict=observed_ad_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: json(row),
    });
    return rows?.[0] || null;
  } catch (error) {
    if (!/ON CONFLICT|42P10|no unique|exclusion constraint/i.test(error.message)) {
      throw error;
    }
  }

  const existing = await rest("research", `ad_creatives?select=*&observed_ad_id=eq.${encode(row.observed_ad_id)}&limit=1`);
  if (existing?.[0]?.id) {
    const updated = await rest("research", `ad_creatives?id=eq.${encode(existing[0].id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: json(row),
    });
    return updated?.[0] || { ...existing[0], ...row };
  }

  const created = await rest("research", "ad_creatives", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: json(row),
  });
  return created?.[0] || null;
}

async function insertSnapshot({ observedAdId, adFetchRunId, sourceProvider, rawPayload, payloadHash }) {
  try {
    const created = await rest("research", "ad_snapshots", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: json({
        observed_ad_id: observedAdId,
        ad_fetch_run_id: adFetchRunId,
        source_provider: sourceProvider,
        payload: rawPayload,
        payload_hash: payloadHash,
        changes_from_prior: {},
      }),
    });
    return created?.[0] || null;
  } catch (error) {
    if (!/duplicate|23505|409/i.test(error.message)) throw error;
    const existing = await rest("research", `ad_snapshots?select=*&observed_ad_id=eq.${observedAdId}&payload_hash=eq.${payloadHash}&limit=1`);
    return existing?.[0] || null;
  }
}

async function insertCreativeVersion({ adCreative, observedAdId, snapshotId, creative, creativeHash }) {
  const existing = await rest("research", `ad_creative_versions?select=version,creative_hash&ad_creative_id=eq.${adCreative.id}&order=version.desc&limit=1`);
  if (existing?.[0]?.creative_hash === creativeHash) return false;
  const version = (existing?.[0]?.version || 0) + 1;
  await rest("research", "ad_creative_versions", {
    method: "POST",
    body: json({
      ad_creative_id: adCreative.id,
      observed_ad_id: observedAdId,
      ad_snapshot_id: snapshotId,
      version,
      creative_hash: creativeHash,
      format: creative.format,
      headline: creative.headline,
      body: creative.body,
      cta: creative.cta,
      cta_url: creative.cta_url,
      primary_image_url: creative.primary_image_url,
      image_urls: creative.image_urls,
      video_url: creative.video_url,
      video_thumbnail_url: creative.video_thumbnail_url,
      landing_url: creative.landing_url,
      classification_status: "unclassified",
      display_state: "pending_review",
      diff: version === 1 ? { initial: true } : { material_change: true },
    }),
  });
  return true;
}

async function upsertMediaAssets({ creativeId, observedAdId, snapshotId, mediaSources }) {
  let count = 0;
  for (const source of mediaSources) {
    if (!source.source_url || !/^https?:\/\//iu.test(source.source_url)) continue;
    const existing = await rest("research", `media_assets?select=id&ad_creative_id=eq.${creativeId}&source_url=eq.${encode(source.source_url)}&limit=1`);
    if (existing?.[0]?.id) {
      await patchMediaAsset(existing[0].id, { kind: source.kind, capture_status: "pending", last_error: null });
    } else {
      await rest("research", "media_assets", {
        method: "POST",
        body: json({
          ad_creative_id: creativeId,
          observed_ad_id: observedAdId,
          kind: source.kind,
          source_url: source.source_url,
          capture_status: "pending",
          metadata: { source_provider: "meta_ad_library", external_asset_id: source.external_asset_id, ad_snapshot_id: snapshotId },
        }),
      });
    }
    count += 1;
  }
  return count;
}

async function patchMediaAsset(id, patch) {
  try {
    return await rest("research", `media_assets?id=eq.${id}`, {
      method: "PATCH",
      body: json(patch),
    });
  } catch (error) {
    if (!/last_error|content_type|checksum|captured_at|42703|column .* does not exist/i.test(error.message)) throw error;
    const { last_error: _lastError, content_type: contentType, checksum, captured_at: _capturedAt, ...withoutUnsupportedColumns } = patch;
    const withoutLastError = {
      ...withoutUnsupportedColumns,
      ...(contentType ? { mime_type: contentType } : {}),
      ...(checksum ? { content_hash: checksum } : {}),
    };
    return rest("research", `media_assets?id=eq.${id}`, {
      method: "PATCH",
      body: json(withoutLastError),
    });
  }
}

async function upsertAreaMatchesForObservedAd({ advertiserPageId, observedAdId }) {
  const pages = await rest("research", `advertiser_pages?select=agency_id,agent_id&id=eq.${advertiserPageId}&limit=1`);
  const page = pages?.[0];
  if (!page) return 0;
  const rows = [];
  try {
    if (page.agency_id) rows.push(...await rest("research", `agent_service_areas?select=postcode,suburb,state,confidence&agency_id=eq.${page.agency_id}&limit=20`));
    if (page.agent_id) rows.push(...await rest("research", `agent_service_areas?select=postcode,suburb,state,confidence&agent_id=eq.${page.agent_id}&limit=20`));
  } catch (error) {
    if (missingSchemaRelation(error, "agent_service_areas")) return 0;
    throw error;
  }
  let count = 0;
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.postcode}:${row.suburb}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const matchType = page.agent_id ? "agent_service_area" : "agency_service_area";
    try {
      const existing = await rest("research", `ad_area_matches?select=id&observed_ad_id=eq.${observedAdId}&postcode=eq.${encode(row.postcode)}&suburb=eq.${encode(row.suburb)}&match_type=eq.${matchType}&limit=1`);
      if (existing?.[0]?.id) continue;
      await rest("research", "ad_area_matches", {
        method: "POST",
        body: json({
          observed_ad_id: observedAdId,
          postcode: row.postcode,
          suburb: row.suburb,
          state: row.state || "WA",
          match_type: matchType,
          confidence: Math.max(60, Math.min(100, Number(row.confidence || 85))),
          evidence: { source: "verified_roster_service_area", advertiser_page_id: advertiserPageId },
        }),
      });
    } catch (error) {
      if (missingSchemaRelation(error, "ad_area_matches")) return count;
      throw error;
    }
    count += 1;
  }
  return count;
}

async function handleAdCollector(job) {
  const payload = job.payload || {};
  if (!payload.advertiserPageId || !payload.metaPageId || payload.realEstateGate?.verified !== true) {
    return { status: "blocked", blocked_reason: "collector_missing_verified_page_gate", result: { handler: "blockwise-ad-collector", collection_started: false } };
  }
  const ingestTables = ["ad_fetch_runs", "observed_ads", "ad_snapshots", "ad_creatives", "media_assets"];
  const input = captureInput(payload);
  const buildRunId = payload.build_run_id || payload.buildRunId || await ensureBuildRun();
  const sourceProvider = metaCaptureProvider === "http_json" && metaCaptureEndpoint ? "http_json" : "hermes_browser";
  const capture_mode = sourceProvider === "http_json" ? "http_json" : "browser";
  const adFetchRunId = await insertFetchRun(job, buildRunId, input, sourceProvider);
  let outcome;
  if (sourceProvider === "http_json") {
    const startedAt = now();
    const response = await fetch(metaCaptureEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json(input),
    });
    const body = await response.json().catch(() => null);
    outcome = response.ok
      ? normalizeCaptureOutcome(body, input, "http_json", startedAt)
      : { status: "FAILED", errorMessage: `capture endpoint failed ${response.status}`, itemCount: 0, items: [], costUsd: 0, metadata: { http_status: response.status, body } };
  } else {
    outcome = await runHermesBrowserCapture(input);
  }
  if (outcome.status !== "SUCCEEDED") {
    await updateFetchRun(adFetchRunId, { status: "failed", result_summary: { provider: sourceProvider, metadata: outcome.metadata || {} }, error: outcome.errorMessage || "capture failed", cost_usd: outcome.costUsd || 0 });
    await insertCoverageDefect({
      platform: "facebook",
      notes: "Hermes ad collector could not fetch a verified Meta page.",
      reported_by: "system",
      reporter_identity: workerId,
      status: "open",
      resolution: { advertiser_page_id: payload.advertiserPageId, meta_page_id: payload.metaPageId, provider: sourceProvider, error: outcome.errorMessage },
      resolved_advertiser_page_id: payload.advertiserPageId,
    });
    throw new Error(outcome.errorMessage || "Meta capture failed");
  }
  if (outcome.itemCount === 0 && outcome.metadata?.confirmed_absence) {
    await updateFetchRun(adFetchRunId, { status: "success", result_summary: { provider: sourceProvider, item_count: 0, confirmed_absence: true, metadata: outcome.metadata || {} }, cost_usd: outcome.costUsd || 0 });
    await rest("research", `advertiser_pages?id=eq.${payload.advertiserPageId}`, {
      method: "PATCH",
      body: json({ status: "no_ads_confirmed", last_checked_at: now(), last_successful_check_at: now(), consecutive_failed_checks: 0 }),
    });
    return { status: "complete", result: { handler: "blockwise-ad-collector", advertiser_page_id: payload.advertiserPageId, meta_page_id: payload.metaPageId, provider: sourceProvider, ads_seen: 0, confirmed_absence: true, ingest_tables: ingestTables } };
  }
  const ingested = [];
  for (const ad of outcome.items) {
    const item = await ingestMetaAd({ ad, advertiserPageId: payload.advertiserPageId, adFetchRunId, buildRunId, sourceProvider, parentJob: job });
    ingested.push(item);
    if (item.media_sources > 0) {
      await enqueueFollowUp({
        queue_name: "research",
        job_type: "blockwise-media-collector",
        dedupe_key: `media:${item.ad_creative_id}:${item.creative_hash}`,
        advertiser_page_id: payload.advertiserPageId,
        priority: 5,
        payload: { adCreativeId: item.ad_creative_id, observedAdId: item.observed_ad_id, build_run_id: buildRunId },
        status: "pending",
        max_attempts: 3,
      }, job);
    }
    await enqueueFollowUp({
      queue_name: "research",
      job_type: "blockwise-ad-classifier",
      dedupe_key: `classifier:${item.ad_creative_id}:${item.creative_hash}`,
      advertiser_page_id: payload.advertiserPageId,
      priority: 5,
      payload: { adCreativeId: item.ad_creative_id, observedAdId: item.observed_ad_id, build_run_id: buildRunId },
      status: "pending",
      max_attempts: 3,
    }, job);
  }
  await updateFetchRun(adFetchRunId, { status: "success", result_summary: { provider: sourceProvider, item_count: outcome.itemCount, ingested_count: ingested.length, raw_dataset_id: outcome.rawDatasetId, metadata: outcome.metadata || {} }, cost_usd: outcome.costUsd || 0 });
  await rest("research", `advertiser_pages?id=eq.${payload.advertiserPageId}`, {
    method: "PATCH",
    body: json({ status: "resolved_collectable", last_checked_at: now(), last_successful_check_at: now(), consecutive_failed_checks: 0 }),
  });
  return { status: "complete", result: { handler: "blockwise-ad-collector", advertiser_page_id: payload.advertiserPageId, meta_page_id: payload.metaPageId, provider: sourceProvider, capture_mode, ads_seen: outcome.itemCount, ingested_count: ingested.length, ingest_tables: ingestTables } };
}

async function handleMediaCollector(job) {
  const payload = job.payload || {};
  if (!payload.adCreativeId || !payload.observedAdId) {
    return { status: "blocked", blocked_reason: "media_collector_missing_creative", result: { handler: "blockwise-media-collector" } };
  }
  let assets = await rest("research", `media_assets?select=*&ad_creative_id=eq.${payload.adCreativeId}&capture_status=in.(pending,failed)&order=created_at.asc&limit=20`);
  let seeded = 0;
  if (!assets.length) {
    const creative = await loadCreativeForMediaCapture(payload.adCreativeId);
    if (creative) {
      seeded = await upsertMediaAssets({
        creativeId: creative.id,
        observedAdId: creative.observed_ad_id || payload.observedAdId,
        snapshotId: creative.ad_snapshot_id || null,
        mediaSources: mediaSourcesFromCreative(creative),
      });
      assets = await rest("research", `media_assets?select=*&ad_creative_id=eq.${payload.adCreativeId}&capture_status=in.(pending,failed)&order=created_at.asc&limit=20`);
    }
  }
  let captured = 0;
  let failed = 0;
  for (const asset of assets) {
    try {
      const stored = await captureMediaAsset(asset, payload.build_run_id || "unassigned");
      await patchMediaAsset(asset.id, {
        storage_bucket: mediaBucket,
        storage_path: stored.storagePath,
        content_type: stored.contentType,
        byte_size: stored.byteSize,
        checksum: stored.checksum,
        capture_status: "captured",
        captured_at: now(),
        last_error: null,
      });
      captured += 1;
    } catch (error) {
      await patchMediaAsset(asset.id, { capture_status: "failed", last_error: error.message });
      failed += 1;
    }
  }
  await refreshCreativeStoredMedia(payload.adCreativeId);
  await enqueueFollowUp({
    queue_name: "research",
    job_type: "blockwise-ad-classifier",
    dedupe_key: `classifier:${payload.adCreativeId}:media:${Date.now()}`,
    advertiser_page_id: job.advertiser_page_id || null,
    priority: 5,
    payload: { adCreativeId: payload.adCreativeId, observedAdId: payload.observedAdId, build_run_id: payload.build_run_id || null },
    status: "pending",
    max_attempts: 3,
  }, job);
  return { status: "complete", result: { handler: "blockwise-media-collector", ad_creative_id: payload.adCreativeId, seeded, captured, failed } };
}

async function loadCreativeForMediaCapture(adCreativeId) {
  const rows = await rest("research", `ad_creatives?select=id,observed_ad_id,ad_snapshot_id,primary_image_url,image_urls,video_url,video_thumbnail_url&id=eq.${adCreativeId}&limit=1`);
  return rows?.[0] || null;
}

function mediaSourcesFromCreative(creative) {
  const sources = [];
  const imageUrls = uniqueMediaUrls([creative.primary_image_url, ...(Array.isArray(creative.image_urls) ? creative.image_urls : [])]);
  const videoUrls = uniqueMediaUrls([creative.video_url]);
  const thumbnailUrls = uniqueMediaUrls([creative.video_thumbnail_url]);
  for (const [index, sourceUrl] of imageUrls.entries()) {
    sources.push({ kind: "image", source_url: sourceUrl, external_asset_id: `image:${index}:${hash(sourceUrl).slice(0, 12)}` });
  }
  for (const [index, sourceUrl] of videoUrls.entries()) {
    sources.push({ kind: "video", source_url: sourceUrl, external_asset_id: `video:${index}:${hash(sourceUrl).slice(0, 12)}` });
  }
  for (const [index, sourceUrl] of thumbnailUrls.entries()) {
    sources.push({ kind: "thumbnail", source_url: sourceUrl, external_asset_id: `thumbnail:${index}:${hash(sourceUrl).slice(0, 12)}` });
  }
  return sources;
}

function uniqueMediaUrls(values) {
  const urls = new Set();
  for (const value of values) {
    if (typeof value === "string" && /^https?:\/\//iu.test(value.trim())) urls.add(value.trim());
  }
  return [...urls];
}

async function handleAdClassifier(job) {
  const payload = job.payload || {};
  if (!payload.adCreativeId) {
    return { status: "blocked", blocked_reason: "classifier_missing_creative", result: { handler: "blockwise-ad-classifier" } };
  }
  const creatives = await rest("research", `ad_creatives?select=*&id=eq.${payload.adCreativeId}&limit=1`);
  const creative = creatives?.[0];
  if (!creative) return { status: "blocked", blocked_reason: "classifier_creative_not_found", result: { handler: "blockwise-ad-classifier", ad_creative_id: payload.adCreativeId } };
  const capturedAssets = await rest("research", `media_assets?select=id,kind,storage_path,capture_status&ad_creative_id=eq.${creative.id}&capture_status=eq.captured&limit=20`);
  const classification = classifyCreative(creative);
  const requiresMedia = ["image", "video", "carousel"].includes(creative.format);
  const mediaReady = !requiresMedia || capturedAssets.length > 0;
  const displayState = classification.is_real_estate_ad && mediaReady ? "displayable" : "hidden";
  const decisionRows = await rest("research", "agent_decisions", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: json({
      decision_type: "ad_classification",
      subject_type: "ad_creative",
      subject_id: creative.id,
      decision: classification,
      rationale: classification.rejection_reason || "Deterministic Hermes classification for verified real-estate page creative.",
      confidence: Math.round((classification.confidence || 0) * 100),
      evidence: { headline: creative.headline, body: creative.body, cta: creative.cta, landing_url: creative.landing_url, media_ready: mediaReady },
      hermes_session_id: workerId,
      hermes_skill: "blockwise-ad-classifier",
      model: "deterministic",
    }),
  });
  await rest("research", `ad_creatives?id=eq.${creative.id}`, {
    method: "PATCH",
    body: json({
      classification,
      classification_status: "classified",
      classified_at: now(),
      classified_by_decision_id: decisionRows?.[0]?.id || null,
      ad_type: classification.ad_type,
      primary_intent: classification.primary_intent,
      display_state: displayState,
    }),
  });
  return { status: "complete", result: { handler: "blockwise-ad-classifier", ad_creative_id: creative.id, display_state: displayState, media_ready: mediaReady, is_real_estate_ad: classification.is_real_estate_ad } };
}

async function captureMediaAsset(asset, buildRunId) {
  if (!asset.source_url || !/^https?:\/\//iu.test(asset.source_url)) throw new Error("media asset has no downloadable source_url");
  await ensureMediaBucket();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), metaCaptureTimeoutMs);
  try {
    const response = await fetch(asset.source_url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; BlockwiseHermesResearch/1.0)",
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8",
      },
    });
    if (!response.ok) throw new Error(`media fetch failed ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error("media fetch returned an empty body");
    const checksum = hash(buffer);
    const storagePath = `build-runs/${buildRunId}/creatives/${asset.ad_creative_id}/${checksum}${extensionForContentType(contentType, asset.kind)}`;
    await uploadStorageObject(mediaBucket, storagePath, buffer, contentType);
    return { storagePath, contentType, byteSize: buffer.length, checksum };
  } finally {
    clearTimeout(timeout);
  }
}

let mediaBucketEnsured = false;

async function ensureMediaBucket() {
  if (mediaBucketEnsured) return;
  try {
    await storage(`bucket/${encode(mediaBucket)}`);
    try {
      await storage(`bucket/${encode(mediaBucket)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: json({ public: true, file_size_limit: 104_857_600 }),
      });
    } catch {
      // Existing bucket policy may be managed outside this worker.
    }
    mediaBucketEnsured = true;
    return;
  } catch {
    await storage("bucket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json({ id: mediaBucket, name: mediaBucket, public: true, file_size_limit: 104_857_600 }),
    });
    mediaBucketEnsured = true;
  }
}

async function uploadStorageObject(bucket, objectPath, buffer, contentType) {
  const encodedObjectPath = objectPath.split("/").map(encode).join("/");
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encode(bucket)}/${encodedObjectPath}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: buffer,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`storage upload failed ${response.status}: ${text.slice(0, 500)}`);
}

function extensionForContentType(contentType, kind) {
  if (/png$/iu.test(contentType)) return ".png";
  if (/webp$/iu.test(contentType)) return ".webp";
  if (/gif$/iu.test(contentType)) return ".gif";
  if (/svg\+xml$/iu.test(contentType)) return ".svg";
  if (/mp4$/iu.test(contentType)) return ".mp4";
  if (/webm$/iu.test(contentType)) return ".webm";
  if (/quicktime$/iu.test(contentType)) return ".mov";
  return kind === "video" ? ".mp4" : ".jpg";
}

async function refreshCreativeStoredMedia(adCreativeId) {
  const assets = await rest("research", `media_assets?select=*&ad_creative_id=eq.${adCreativeId}&capture_status=eq.captured&order=created_at.asc&limit=50`);
  const firstImage = assets.find((asset) => asset.kind === "image")?.storage_path || null;
  const firstVideo = assets.find((asset) => asset.kind === "video")?.storage_path || null;
  const firstThumbnail = assets.find((asset) => asset.kind === "thumbnail")?.storage_path || null;
  await rest("research", `ad_creatives?id=eq.${adCreativeId}`, {
    method: "PATCH",
    body: json({
      image_storage_path: firstImage,
      video_storage_path: firstVideo,
      video_thumbnail_url: firstThumbnail,
      media_assets: assets.map((asset) => ({
        kind: asset.kind,
        storagePath: asset.storage_path,
        contentType: asset.content_type || asset.mime_type || null,
        byteSize: asset.byte_size,
        capturedAt: asset.captured_at,
      })),
    }),
  });
}

function classifyCreative(creative) {
  const text = [creative.headline, creative.body, creative.cta, creative.cta_url, creative.landing_url, creative.metadata?.description, creative.metadata?.page_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const hooks = [];
  let adType = "agency_brand";
  let primaryIntent = "agency_brand";
  let relevance = "agent_brand";
  if (/\b(appraisal|home value|market appraisal|property value|what.*worth|price update)\b/iu.test(text)) {
    adType = "appraisal";
    primaryIntent = "appraisal";
    relevance = "appraisal";
    hooks.push("appraisal");
  } else if (/\b(sold|just sold|under offer)\b/iu.test(text)) {
    adType = "just_sold";
    primaryIntent = "just_sold";
    relevance = "sold";
    hooks.push("sold result");
  } else if (/\b(for sale|just listed|new listing|open home|home open|auction|bedroom|bathroom|sqm)\b/iu.test(text)) {
    adType = /\b(open home|home open)\b/iu.test(text) ? "open_home" : "listing";
    primaryIntent = adType;
    relevance = "listing";
    hooks.push("listing");
  } else if (/\b(rent|rental|leased|lease|tenant|property management)\b/iu.test(text)) {
    adType = "property_management";
    primaryIntent = "property_management";
    relevance = "rental";
    hooks.push("property management");
  } else if (/\b(market update|suburb report|median price|clearance rate)\b/iu.test(text)) {
    adType = "market_update";
    primaryIntent = "market_update";
    relevance = "agent_brand";
    hooks.push("market update");
  } else if (/\b(property|real estate|homes?|selling|buyers?|sellers?|agency|agent|reiwa|realty|ray white|realmark|belle property|acton|harcourts|lj hooker|professionals)\b/iu.test(text)) {
    adType = "agency_brand";
    primaryIntent = "agency_brand";
    hooks.push("agency brand");
  }
  const hasRealEstateSignal = hooks.length > 0;
  return {
    is_real_estate_ad: hasRealEstateSignal,
    industry: hasRealEstateSignal ? "real_estate" : "unknown",
    real_estate_relevance: hasRealEstateSignal ? relevance : "irrelevant",
    ad_type: hasRealEstateSignal ? adType : "other",
    primary_intent: hasRealEstateSignal ? primaryIntent : "other",
    property_or_agent_focus: /\b(bedroom|bathroom|sqm|for sale|leased|sold|open home)\b/iu.test(text) ? "property" : "agency",
    hooks,
    tone: "",
    style: "",
    audience: "",
    suburb_signals: [],
    confidence: hasRealEstateSignal ? 0.86 : 0.45,
    rejection_reason: hasRealEstateSignal ? null : "No real-estate signal in the captured creative text or media metadata.",
  };
}

async function handleJob(job) {
  if (job.job_type === "blockwise-agent-census") return handleAgentCensus(job);
  if (job.job_type === "blockwise-page-resolver") return handlePageResolver(job);
  if (job.job_type === "blockwise-ad-collector") return handleAdCollector(job);
  if (job.job_type === "blockwise-media-collector") return handleMediaCollector(job);
  if (job.job_type === "blockwise-ad-classifier") return handleAdClassifier(job);
  return { status: "blocked", blocked_reason: `unsupported_job_type:${job.job_type}`, result: { handler: "none", reason: "Hermes runtime only handles census and page resolver handoff." } };
}

async function processClaimedJobs() {
  let handled = 0;
  while (handled < maxJobsPerTick) {
    const jobs = await claimJobs();
    if (!jobs.length) break;
    const batch = jobs.slice(0, maxJobsPerTick - handled);
    await Promise.all(batch.map(processOneJob));
    handled += batch.length;
  }
  return handled;
}

async function processOneJob(job) {
  const started = Date.now();
  try {
    const outcome = await handleJob(job);
    const result = { ...outcome.result, duration_ms: Date.now() - started, worker_id: workerId };
    if (outcome.status === "complete") await finishJob(job, "complete", { result, last_error: null, blocked_reason: null });
    else await finishJob(job, "blocked", { result, blocked_reason: outcome.blocked_reason || "blocked", last_error: null });
    log("job handled", { jobId: job.id, jobType: job.job_type, outcome: outcome.status, durationMs: Date.now() - started });
  } catch (error) {
    const retry = job.attempts < job.max_attempts;
    await finishJob(job, retry ? "pending" : "blocked", {
      available_at: retry ? new Date(Date.now() + Math.min(60_000 * 2 ** Math.max(0, job.attempts - 1), 900_000)).toISOString() : job.available_at,
      last_error: error.message,
      blocked_reason: retry ? null : "handler_failed_max_attempts",
      result: { handler_error: error.message, duration_ms: Date.now() - started, worker_id: workerId },
    }, retry ? "fail" : "block");
    log("job failed", { jobId: job.id, jobType: job.job_type, retry, error: error.message, durationMs: Date.now() - started }, "error");
  }
}

async function tick() {
  let buildRunId = null;
  let supervisor = { duePolicies: 0, enqueued: 0 };
  let watchdogs = {};
  try {
    buildRunId = await ensureBuildRun();
    supervisor = await enqueueDueCensusJobs(buildRunId);
  } catch (error) {
    log("supervisor phase failed; continuing to queue worker", { error: error.message }, "error");
  }
  const handled = await processClaimedJobs();
  try {
    watchdogs = await runWatchdogs();
  } catch (error) {
    log("watchdog phase failed after worker pass", { error: error.message }, "error");
  }
  log("tick complete", { mode, workerId, buildRunId, ...supervisor, handled, watchdogs });
}

async function main() {
  log("starting", { mode, workerId, intervalMs, targetPostcodes, claimLimit, maxJobsPerTick, censusSourceTemplates: sourceTemplates.length });
  for (;;) {
    try {
      await tick();
    } catch (error) {
      log(error.message, {}, "error");
    }
    if (env.HERMES_RESEARCH_RUN_ONCE === "true") break;
    await sleep(intervalMs);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
