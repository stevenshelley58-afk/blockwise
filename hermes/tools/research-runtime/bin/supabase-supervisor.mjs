#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CLASSIFIER_VERSION,
  assessCapturedImageQuality,
  classifyCreativeWithModels,
  hasUnresolvedDynamicPlaceholder,
  hasUsableCapturedMedia,
  readImageDimensions,
  shouldDisplayClassifiedCreative,
  shouldReclassifyCreative,
  shouldWaitForMediaClassification,
} from "./ad-classifier.mjs";
import { CONTENT_RUN_JOB_TYPE, handleHermesContentRun } from "./content-engine.mjs";
import { runAdRadarAccuracyAudit } from "./ad-radar-accuracy-audit.mjs";
import { publishCustomerReadModels } from "./customer-read-model-publisher.mjs";
import { runInactiveAdPurge } from "./inactive-ad-purge.mjs";
import {
  hermesSupabaseHeaders,
  resolveHermesCustomerSupabaseCredential,
  resolveHermesSupabaseCredential,
} from "./supabase-credentials.mjs";

const DEFAULT_POSTCODES = ["ALL"];
const COVERAGE_AUDITOR_JOB_TYPE = "blockwise-coverage-auditor";
const DEFECT_INVESTIGATOR_JOB_TYPE = "blockwise-defect-investigator";
const HANDLED_JOB_TYPES = [
  "blockwise-agent-census",
  "blockwise-page-resolver",
  "blockwise-ad-collector",
  "blockwise-media-collector",
  "blockwise-ad-classifier",
  COVERAGE_AUDITOR_JOB_TYPE,
  DEFECT_INVESTIGATOR_JOB_TYPE,
  CONTENT_RUN_JOB_TYPE,
];
const env = process.env;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();
const json = (value) => JSON.stringify(value);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
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
const supabaseCredential = resolveHermesSupabaseCredential(env);
if (!supabaseCredential) {
  throw new Error(
    "Missing HERMES_SUPABASE_SECRET_KEY/SUPABASE_SECRET_KEY or legacy Supabase service-role key",
  );
}
const customerSupabaseUrl = required("HERMES_CUSTOMER_SUPABASE_URL", env.SUPABASE_URL).replace(/\/+$/u, "");
const customerSupabaseCredential = resolveHermesCustomerSupabaseCredential(env);
if (!customerSupabaseCredential) {
  throw new Error(
    "Missing HERMES_CUSTOMER_SUPABASE_SECRET_KEY or HERMES_CUSTOMER_SUPABASE_SERVICE_ROLE_KEY",
  );
}
const customerReadModelPublishIntervalMs = positiveInt(
  "HERMES_CUSTOMER_READ_MODEL_PUBLISH_INTERVAL_SECONDS",
  300,
) * 1000;
const accuracyAuditCheckIntervalMs = positiveInt(
  "HERMES_ACCURACY_AUDIT_CHECK_INTERVAL_SECONDS",
  3600,
) * 1000;
const accuracyAuditIntervalHours = positiveInt("HERMES_ACCURACY_AUDIT_INTERVAL_HOURS", 168);
const inactiveAdPurgeCheckIntervalMs = positiveInt(
  "HERMES_INACTIVE_AD_PURGE_CHECK_INTERVAL_SECONDS",
  3600,
) * 1000;
const inactiveAdPurgeIntervalHours = positiveInt("HERMES_INACTIVE_AD_PURGE_INTERVAL_HOURS", 24);
const rawEvidenceDir = env.HERMES_RAW_EVIDENCE_DIR || "/opt/research-raw-evidence";
const mode = env.HERMES_RESEARCH_MODE === "build" ? "build" : "maintain";
const workerId = env.HERMES_QUEUE_WORKER_ID || `hermes-research-${randomUUID()}`;
const intervalMs = positiveInt("HERMES_QUEUE_LOOP_INTERVAL_MS", 60_000);
const supervisorLimit = positiveInt("HERMES_RESEARCH_SUPERVISOR_POLICY_LIMIT", mode === "build" ? 50 : 10);
const claimLimit = positiveInt("HERMES_QUEUE_CLAIM_LIMIT", mode === "build" ? 4 : 1);
const claimTtlSeconds = positiveInt("HERMES_QUEUE_CLAIM_TTL_SECONDS", 900);
const maxJobsPerTick = positiveInt("HERMES_QUEUE_MAX_JOBS_PER_TICK", mode === "build" ? 4 : 1);
const fetchTimeoutMs = positiveInt("HERMES_RESEARCH_FETCH_TIMEOUT_MS", 8_000);
const metaCaptureTimeoutMs = positiveInt("HERMES_META_CAPTURE_TIMEOUT_MS", 30_000);
const metaCaptureResultsLimit = Math.min(positiveInt("HERMES_META_CAPTURE_RESULTS_LIMIT", 250), 250);
const requestedTargetPostcodes = uniqueCsv(env.HERMES_RESEARCH_TARGET_POSTCODES, DEFAULT_POSTCODES);
const sourceTemplates = uniqueCsv(env.HERMES_CENSUS_SOURCE_URL_TEMPLATES, []);
const adPageRefreshEnabled = env.HERMES_AD_PAGE_REFRESH_ENABLED !== "false";
const adPageRefreshIntervalMinutes = positiveInt("HERMES_AD_PAGE_REFRESH_INTERVAL_MINUTES", mode === "build" ? 720 : 360);
const adPageRefreshBatchSize = positiveInt("HERMES_AD_PAGE_REFRESH_BATCH_SIZE", mode === "build" ? 40 : 16);
const adPageRefreshMaxActive = positiveInt("HERMES_AD_PAGE_REFRESH_MAX_ACTIVE", mode === "build" ? 200 : 80);
const adPageRefreshScanLimit = Math.max(adPageRefreshBatchSize * 16, adPageRefreshMaxActive + adPageRefreshBatchSize * 4);
const adPageRefreshMaxConsecutiveFailures = 3;
// Location ad search (Path 2) has been removed. The census → page-resolver →
// ad-collector pipeline (Path 1) is the sole discovery mechanism.
const locationAdSearchEnabled = false;
// Provider for the suburb/keyword discovery search. "hermes_browser" (default) enumerates
// via the Meta Ad Library capture CLI driven through the Steel browser.
const locationAdSearchProvider = String(env.HERMES_LOCATION_AD_SEARCH_PROVIDER || "hermes_browser").toLowerCase();
const classificationBackfillBatchSize = positiveInt("HERMES_CLASSIFICATION_BACKFILL_BATCH_SIZE", mode === "build" ? 200 : 80);
const classificationBackfillWeakBatchSize = positiveInt(
  "HERMES_CLASSIFICATION_WEAK_BACKFILL_BATCH_SIZE",
  Math.max(10, Math.floor(classificationBackfillBatchSize / 4)),
);
const maxRosterUrlsPerPostcode = positiveInt("HERMES_CENSUS_MAX_ROSTER_URLS_PER_POSTCODE", 5);
const censusQueuePriority = positiveInt("HERMES_CENSUS_QUEUE_PRIORITY", 30);
const censusPolicyAutoSeedEnabled = env.HERMES_CENSUS_AUTO_SEED_POLICIES_ENABLED !== "false";
const censusPolicySeedBatchSize = positiveInt("HERMES_CENSUS_POLICY_SEED_BATCH_SIZE", mode === "build" ? 500 : 100);
const censusRecycleBlockedEnabled = env.HERMES_CENSUS_RECYCLE_BLOCKED_ENABLED !== "false";
const metaCaptureProvider = env.HERMES_META_CAPTURE_PROVIDER || (env.HERMES_META_CAPTURE_ENDPOINT ? "http_json" : "hermes_browser");
const metaCaptureEndpoint = env.HERMES_META_CAPTURE_ENDPOINT || "";
const metaOfficialAccessToken = env.HERMES_META_AD_LIBRARY_ACCESS_TOKEN || env.META_AD_LIBRARY_ACCESS_TOKEN || env.META_AD_LIBRARY_TOKEN || "";
const metaOfficialApiEnabled = env.HERMES_META_OFFICIAL_API_ENABLED !== "false" && Boolean(metaOfficialAccessToken.trim());
const metaOfficialApiVersion = env.HERMES_META_OFFICIAL_API_VERSION || env.META_AD_LIBRARY_API_VERSION || "v20.0";
const metaOfficialAdType = env.HERMES_META_OFFICIAL_AD_TYPE || "HOUSING_ADS";
const metaOfficialPageLimit = Math.min(positiveInt("HERMES_META_OFFICIAL_PAGE_LIMIT", 100), 100);
const metaOfficialMaxPagesPerCapture = Math.min(positiveInt("HERMES_META_OFFICIAL_MAX_PAGES_PER_CAPTURE", 25), 100);
const metaBrowserExecutable = env.HERMES_META_BROWSER_EXECUTABLE || env.CHROMIUM_BIN || "chromium";
const remoteBrowserCdpUrl = env.HERMES_REMOTE_BROWSER_CDP_URL || "";
const remoteBrowserFailureCooldownMs = positiveInt("HERMES_REMOTE_BROWSER_FAILURE_COOLDOWN_MS", 30 * 60 * 1000);
const metaBrowserChallengeCooldownMs = positiveInt("HERMES_META_BROWSER_CHALLENGE_COOLDOWN_MS", 15 * 60 * 1000);
const mediaBucket = env.HERMES_RESEARCH_AD_CREATIVES_BUCKET || "research-ad-creatives";
const META_OFFICIAL_SOURCE_PROVIDER = "official_meta_archive";
const META_BROWSER_SOURCE_PROVIDER = "hermes_meta_page_capture";
const META_STRUCTURED_SOURCE_PROVIDER = "structured_meta_page_provider";
const META_LOCATION_SEARCH_SOURCE_PROVIDER = "hermes_meta_location_search";
const RAW_EVIDENCE_BUCKET = env.HERMES_RESEARCH_RAW_EVIDENCE_BUCKET || "research-raw-evidence";
const META_BROWSER_CHALLENGE_DISABLED_UNTIL_SETTING = "meta_browser_challenge_disabled_until";
const META_BROWSER_CHALLENGE_RESUME_SPREAD_MS = 15 * 60 * 1000;
const META_OFFICIAL_ADS_ARCHIVE_FIELDS = [
  "id",
  "ad_archive_id",
  "page_id",
  "page_name",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_creative_link_descriptions",
  "ad_snapshot_url",
  "publisher_platforms",
].join(",");
const targetAllPostcodes = requestedTargetPostcodes.some((value) => /^(?:all|\*)$/iu.test(value));
const targetPostcodes = targetAllPostcodes ? [] : requestedTargetPostcodes;

function adRefreshPriorityForPage(page) {
  return page.status === "resolved_collectable" ? 4 : 8;
}

function locationAdSearchPriorityForPolicy(policy) {
  return Math.max(4, Math.min(5, Number(policy.priority || 4) + 1));
}

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
  "6163": [
    { suburb: "Spearwood", slug: "spearwood" },
    { suburb: "Hamilton Hill", slug: "hamilton-hill" },
    { suburb: "Coolbellup", slug: "coolbellup" },
    { suburb: "Bibra Lake", slug: "bibra-lake" },
    { suburb: "Kardinya", slug: "kardinya" },
    { suburb: "North Lake", slug: "north-lake" },
  ],
  "6166": [
    { suburb: "Coogee", slug: "coogee" },
    { suburb: "Henderson", slug: "henderson" },
    { suburb: "Lake Coogee", slug: "lake-coogee" },
    { suburb: "Munster", slug: "munster" },
    { suburb: "Wattleup", slug: "wattleup" },
  ],
};

function readAuPostcodes() {
  const paths = [
    env.HERMES_AU_POSTCODES_PATH,
    "/app/data/au-postcodes.json",
    new URL("../../../data/au-postcodes.json", import.meta.url),
  ].filter(Boolean);
  for (const path of paths) {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // Keep trying the next known runtime path.
    }
  }
  return [];
}

function readAgentSources() {
  const paths = [
    env.HERMES_AGENT_SOURCES_PATH,
    "/app/data/agent-sources.json",
    new URL("../../../data/agent-sources.json", import.meta.url),
  ].filter(Boolean);
  for (const path of paths) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      return Array.isArray(parsed?.sources) ? parsed.sources : [];
    } catch {
      // Keep trying the next known runtime path.
    }
  }
  return [{
    id: "reiwa_agent_finder",
    state: "WA",
    enabled: true,
    type: "agent_roster",
    parser: "reiwa_jsonld_person",
  }];
}

function suburbSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function normaliseRosterSuburb(value) {
  const suburb = String(value || "").trim();
  const embedded = /^[A-Z]{2,3}\s+\d{4}\s+(?<suburb>.+)$/u.exec(suburb)?.groups?.suburb?.trim();
  const cleaned = embedded || suburb;
  if (!cleaned || /^\d{4}$/u.test(cleaned) || /^[A-Z]{2,3}\s+\d{4}\b/u.test(cleaned)) return null;
  return /[A-Za-z]/u.test(cleaned) ? cleaned : null;
}

function validRosterSuburb(value) {
  return Boolean(normaliseRosterSuburb(value));
}

function buildPostcodeSuburbIndex() {
  const index = new Map();
  for (const row of readAuPostcodes()) {
    if (!row?.postcode || !row?.state || !Array.isArray(row.suburbs)) continue;
    const suburbs = [...new Set(row.suburbs.map(normaliseRosterSuburb).filter(Boolean).map((suburb) => titleCase(suburb)))];
    index.set(`${row.state}:${row.postcode}`, suburbs);
  }
  return index;
}

const postcodeSuburbIndex = buildPostcodeSuburbIndex();
const agentSourceDefinitions = readAgentSources();
const configuredTargetStates = uniqueCsv(env.HERMES_RESEARCH_TARGET_STATES, []).map((state) => state.toUpperCase());
const enabledAgentRosterStates = new Set(agentSourceDefinitions
  .filter((source) => source.enabled !== false && source.type === "agent_roster" && source.state)
  .map((source) => String(source.state).toUpperCase()));
const customTemplateCensusStates = new Set(sourceTemplates.length ? configuredTargetStates : []);
const enabledCensusSourceStates = [...new Set([...enabledAgentRosterStates, ...customTemplateCensusStates])].sort();
const targetStates = configuredTargetStates.length
  ? configuredTargetStates
  : targetAllPostcodes
    ? enabledCensusSourceStates
    : [];
const targetPostcodeLog = targetAllPostcodes ? ["ALL"] : targetPostcodes;

function hasCensusSourceForState(state) {
  const code = String(state || "WA").toUpperCase();
  return enabledAgentRosterStates.has(code) || customTemplateCensusStates.has(code);
}

function hasCensusSourceForPolicy(policy) {
  return hasCensusSourceForState(policy.state || "WA");
}

function postgrestIn(values) {
  return values.map((value) => `"${String(value).replace(/"/gu, "")}"`).join(",");
}

let remoteBrowserDisabledUntil = 0;
let metaBrowserChallengeDisabledUntil = 0;

function log(message, metadata = {}, level = "info") {
  console.log(json({ ts: now(), component: "blockwise-research-runtime", level, message, ...metadata }));
}

async function rest(schema, path, init = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: hermesSupabaseHeaders(supabaseCredential, {
      "Accept-Profile": schema,
      "Content-Profile": schema,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method || "GET"} ${schema}.${path} failed ${response.status}: ${text.slice(0, 700)}`);
  return text ? JSON.parse(text) : null;
}

async function storage(path, init = {}) {
  const response = await fetch(`${customerSupabaseUrl}/storage/v1/${path}`, {
    ...init,
    headers: hermesSupabaseHeaders(customerSupabaseCredential, {
      ...(init.headers || {}),
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method || "GET"} storage.${path} failed ${response.status}: ${text.slice(0, 700)}`);
  return text ? JSON.parse(text) : null;
}

const rpc = (functionName, payload) => rest("research", `rpc/${functionName}`, { method: "POST", body: json(payload) });
const encode = (value) => encodeURIComponent(value);
const uuidOrNull = (value) => (typeof value === "string" && uuidPattern.test(value.trim()) ? value.trim() : null);
const resolveBuildRunId = async (...candidates) => candidates.map(uuidOrNull).find(Boolean) || await ensureBuildRun();

function runtimeSettingAuditRowId(settingKey) {
  const hex = hash(`runtime_settings:${settingKey}`).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
}

async function readRuntimeSettings(settingKeys = []) {
  try {
    const rows = await rest(
      "research",
      `runtime_settings?select=setting_key,setting_value&setting_key=in.(${postgrestIn(settingKeys)})`,
    );
    return Object.fromEntries((rows || []).map((row) => [row.setting_key, row.setting_value]));
  } catch (error) {
    if (missingSchemaRelation(error, "runtime_settings")) return {};
    throw error;
  }
}

async function setRuntimeSetting(settingKey, settingValue, metadata = {}) {
  try {
    await rest("research", "runtime_settings?on_conflict=setting_key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: json({
        setting_key: settingKey,
        setting_value: settingValue,
        updated_by: "hermes-supervisor",
      }),
    });
    await recordEvent("update", "runtime_settings", runtimeSettingAuditRowId(settingKey), { setting_key: settingKey, setting_value: settingValue, metadata });
  } catch (error) {
    if (!missingSchemaRelation(error, "runtime_settings")) throw error;
  }
}

async function refreshMetaBrowserChallengeCooldownFromSettings() {
  const settings = await readRuntimeSettings([META_BROWSER_CHALLENGE_DISABLED_UNTIL_SETTING]);
  const value = settings[META_BROWSER_CHALLENGE_DISABLED_UNTIL_SETTING];
  const parsed = Date.parse(typeof value === "string" ? value : "");
  if (Number.isFinite(parsed) && parsed > Date.now()) {
    metaBrowserChallengeDisabledUntil = Math.max(metaBrowserChallengeDisabledUntil, parsed);
  }
}

function runtimeSettingValue(settings, key, fallback = null) {
  return Object.prototype.hasOwnProperty.call(settings || {}, key) ? settings[key] : fallback;
}

function runtimeSettingString(settings, key, fallback = null) {
  const value = runtimeSettingValue(settings, key, fallback);
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text && text !== "null" ? text : fallback;
}

function runtimeSettingPositiveInt(settings, key, fallback) {
  const value = Number(runtimeSettingValue(settings, key, fallback));
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function runtimeSettingPositiveNumber(settings, key, fallback) {
  const value = Number(runtimeSettingValue(settings, key, fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function recordEvent(eventType, tableName, rowId, payload = {}, extra = {}) {
  const row = { event_type: eventType, table_name: tableName, row_id: rowId, source_provider: "hermes", payload, ...extra };
  await rest("research", "ingest_events", {
    method: "POST",
    body: json(row),
  });
}

async function ensureBuildRun() {
  const existing = await rest("research", `build_runs?select=id,started_at&mode=eq.${mode}&status=eq.running&order=started_at.desc&limit=1`);
  if (existing?.[0]?.id) return existing[0].id;
  const created = await rest("research", "build_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: json({
      mode,
      market: targetStates.length > 1 ? "AU" : targetStates[0] || "AU",
      target_postcodes: targetPostcodeLog,
      source_provider: "hermes",
      trigger: "scheduled",
      status: "running",
      notes: "Hermes research run started by deterministic queue runtime.",
      metadata: { owner: "hermes", runner: "supabase-supervisor", location_search_allowed: false, legacy_workers_allowed: false, target_states: targetStates, source_backed_states: enabledCensusSourceStates },
    }),
  });
  const id = created?.[0]?.id;
  if (!id) throw new Error("Supabase did not return a build_run id");
  await recordEvent("insert", "build_runs", id, { mode, targetPostcodes: targetPostcodeLog, targetStates });
  return id;
}

function sourceBackedPolicyCandidates() {
  const out = [];
  for (const key of postcodeSuburbIndex.keys()) {
    const [state, postcode] = key.split(":");
    if (!postcode || !hasCensusSourceForState(state)) continue;
    if (targetStates.length && !targetStates.includes(state)) continue;
    if (!targetAllPostcodes && targetPostcodes.length && !targetPostcodes.includes(postcode)) continue;
    out.push({ state, postcode });
  }
  return out.sort((left, right) => left.state.localeCompare(right.state) || left.postcode.localeCompare(right.postcode));
}

async function ensureSourceBackedRefreshPolicies() {
  if (!censusPolicyAutoSeedEnabled) return { policySeedCandidates: 0, policySeeded: 0 };
  const candidates = sourceBackedPolicyCandidates();
  if (!candidates.length) return { policySeedCandidates: 0, policySeeded: 0 };
  const states = [...new Set(candidates.map((candidate) => candidate.state))];
  const existingRows = await rest("research", `refresh_policies?select=postcode,state&state=in.(${postgrestIn(states)})&limit=10000`);
  const existing = new Set(existingRows.map((row) => `${row.state}:${row.postcode}`));
  const missing = candidates
    .filter((candidate) => !existing.has(`${candidate.state}:${candidate.postcode}`))
    .slice(0, censusPolicySeedBatchSize);
  if (!missing.length) return { policySeedCandidates: candidates.length, policySeeded: 0 };
  const seededAt = Date.now();
  await rest("research", "refresh_policies?on_conflict=postcode,state", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: json(missing.map((candidate, index) => ({
      postcode: candidate.postcode,
      state: candidate.state,
      priority: candidate.state === "WA" ? 3 : 4,
      refresh_cadence_minutes: 1440,
      next_refresh_at: new Date(seededAt + index * 1_000).toISOString(),
      active: true,
      notes: "Auto-seeded by Hermes from source-backed Australian postcode data.",
    }))),
  });
  return { policySeedCandidates: candidates.length, policySeeded: missing.length };
}

async function recycleBlockedCensusJob(job, policy, buildRunId) {
  if (!censusRecycleBlockedEnabled) return false;
  if (!job || !["blocked", "failed"].includes(job.status)) return false;
  if (!hasCensusSourceForPolicy(policy)) return false;
  const priorFailure = `${job.blocked_reason || ""} ${job.last_error || ""} ${json(job.result || {})}`;
  if (!/(generated column|non-default value|schema cache|column .*does not exist|PGRST204|42703|428C9)/iu.test(priorFailure)) return false;
  await rest("research", `work_queue?id=eq.${job.id}`, {
      method: "PATCH",
      body: json({
        payload: { postcode: policy.postcode, state: policy.state, build_run_id: buildRunId, verified_roster_first: true, location_search_allowed: false, legacy_discovery_allowed: false },
        priority: censusQueuePriority,
        status: "pending",
        available_at: now(),
      claimed_at: null,
      claimed_by: null,
      claim_token: null,
      claim_expires_at: null,
      attempts: 0,
      max_attempts: 3,
      last_error: null,
      blocked_reason: null,
      result: {},
      completed_at: null,
    }),
  });
  await recordEvent("requeue", "work_queue", job.id, { job_type: "blockwise-agent-census", reason: "source_backed_census_recycle", postcode: policy.postcode, state: policy.state }, { work_queue_id: job.id });
  return true;
}

async function deferCensusPolicy(postcode, state, reason, hours = 12, markRefreshed = false) {
  if (!postcode) return;
  await rest("research", `refresh_policies?postcode=eq.${encode(postcode)}&state=eq.${encode(state || "WA")}`, {
    method: "PATCH",
    body: json({
      ...(markRefreshed ? { last_refreshed_at: now() } : {}),
      next_refresh_at: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
      notes: `Hermes deferred census target: ${reason}`,
    }),
  });
}

async function enqueueDueCensusJobs(buildRunId) {
  const filters = [
    "active=eq.true",
    `next_refresh_at=lte.${encode(now())}`,
    !targetAllPostcodes && targetPostcodes.length ? `postcode=in.(${postgrestIn(targetPostcodes)})` : null,
    targetStates.length ? `state=in.(${postgrestIn(targetStates)})` : null,
  ].filter(Boolean).join("&");
  const policies = await rest(
    "research",
    `refresh_policies?select=id,postcode,state,priority,refresh_cadence_minutes,next_refresh_at&${filters}&order=priority.asc,next_refresh_at.asc&limit=${supervisorLimit}`,
  );
  let enqueued = 0;
  let recycled = 0;
  let deferredCensus = 0;
  let skippedNoCensusSource = 0;
  for (const policy of policies.filter((item) => {
    const ok = hasCensusSourceForPolicy(item);
    if (!ok) skippedNoCensusSource += 1;
    return ok;
  })) {
    const dedupeKey = `census:${policy.state}:${policy.postcode}`;
    const existing = await rest("research", `work_queue?select=id,status,blocked_reason,updated_at&dedupe_key=eq.${encode(dedupeKey)}&status=in.(pending,claimed,failed,blocked)&limit=1`);
    const active = existing.find((job) => job.status === "pending" || job.status === "claimed");
    if (active) continue;
    const recyclable = existing.find((job) => job.status === "failed" || job.status === "blocked");
    if (recyclable) {
      if (await recycleBlockedCensusJob(recyclable, policy, buildRunId)) recycled += 1;
      else {
        await deferCensusPolicy(policy.postcode, policy.state, recyclable.blocked_reason || "blocked_census_job_waiting_for_new_source", 12);
        deferredCensus += 1;
      }
      continue;
    }
    const created = await rest("research", "work_queue", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: json({
        queue_name: "research",
        job_type: "blockwise-agent-census",
        dedupe_key: dedupeKey,
        priority: censusQueuePriority,
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
  return { duePolicies: policies.length, enqueued, recycledCensus: recycled, deferredCensus, skippedNoCensusSource };
}

async function enqueueDueAdPageRefreshJobs(buildRunId) {
  if (!adPageRefreshEnabled) return { adRefreshCandidates: 0, adRefreshEnqueued: 0 };
  const challengeCooldownMs = metaBrowserChallengeCooldownRemaining();
  if (challengeCooldownMs > 0) {
    return { adRefreshCandidates: 0, adRefreshEnqueued: 0, adRefreshSkippedChallengeCooldown: true, adRefreshChallengeCooldownMs: challengeCooldownMs };
  }
  const activeCollectors = await rest("research", `work_queue?select=id,advertiser_page_id,priority&job_type=eq.blockwise-ad-collector&status=in.(pending,claimed)&limit=${Math.max(adPageRefreshMaxActive * 2, adPageRefreshBatchSize)}`);
  const blockingCollectors = activeCollectors.filter((job) => Number(job.priority || 99) <= adRefreshPriorityForPage({ status: "resolved_collectable" }));
  if (blockingCollectors.length >= adPageRefreshMaxActive) {
    return { adRefreshCandidates: 0, adRefreshEnqueued: 0, adRefreshSkippedActive: blockingCollectors.length, adRefreshBacklog: activeCollectors.length };
  }
  const activePageIds = new Set(activeCollectors.map((job) => job.advertiser_page_id).filter(Boolean));
  const pages = await rest(
    "research",
    `advertiser_pages?select=id,page_id,page_name,status,resolution_decision_id,last_checked_at,consecutive_failed_checks&status=in.(resolved_collectable,no_ads_confirmed)&page_id=not.is.null&order=last_checked_at.asc.nullsfirst&limit=${adPageRefreshScanLimit}`,
  );
  const cutoff = Date.now() - adPageRefreshIntervalMinutes * 60_000;
  const capacity = Math.max(0, Math.min(adPageRefreshMaxActive - blockingCollectors.length, adPageRefreshBatchSize));
  const candidates = pages.filter((page) => {
    if (!page.page_id || String(page.page_id).startsWith("slug:")) return false;
    if (activePageIds.has(page.id)) return false;
    if ((page.consecutive_failed_checks || 0) >= adPageRefreshMaxConsecutiveFailures) return false;
    if (!page.last_checked_at) return true;
    return Date.parse(page.last_checked_at) < cutoff;
  }).sort((left, right) =>
    adRefreshPriorityForPage(left) - adRefreshPriorityForPage(right)
    || Date.parse(left.last_checked_at || "1970-01-01T00:00:00.000Z") - Date.parse(right.last_checked_at || "1970-01-01T00:00:00.000Z")
  ).slice(0, capacity);
  let enqueued = 0;
  const bucket = Math.floor(Date.now() / Math.max(60_000, adPageRefreshIntervalMinutes * 60_000));
  for (const [index, page] of candidates.entries()) {
    const queued = await enqueueFollowUp({
      queue_name: "research",
      job_type: "blockwise-ad-collector",
      dedupe_key: `ad-refresh:${page.id}:${bucket}`,
      advertiser_page_id: page.id,
      priority: adRefreshPriorityForPage(page),
      payload: {
        advertiserPageId: page.id,
        metaPageId: String(page.page_id),
        build_run_id: buildRunId,
        resolverDecisionId: page.resolution_decision_id || null,
        realEstateGate: {
          verified: true,
          verifiedBySkill: "blockwise-auto-page-refresh",
          decisionId: page.resolution_decision_id || null,
          sourceDocumentIds: [],
          verifiedAt: now(),
        },
        country: "AU",
        activeStatus: "all",
        resultsLimit: metaCaptureResultsLimit,
      },
      status: "pending",
      available_at: new Date(Date.now() + index * 2_000).toISOString(),
      max_attempts: 3,
    }, null);
    if (queued) {
      enqueued += 1;
    }
  }
  return { adRefreshCandidates: candidates.length, adRefreshEnqueued: enqueued, adRefreshActive: blockingCollectors.length, adRefreshBacklog: activeCollectors.length, adRefreshScanned: pages.length };
}

function locationSuburbsForPolicy(policy) {
  const configured = (POSTCODE_ROSTER_SOURCES[policy.postcode] || []).map((source) => source.suburb);
  const indexed = postcodeSuburbIndex.get(`${policy.state || "WA"}:${policy.postcode}`) || [];
  const seen = new Set();
  const suburbs = [];
  for (const suburb of [...configured, ...indexed]) {
    const clean = normaliseRosterSuburb(suburb);
    const key = clean ? normalizeName(clean) : "";
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    suburbs.push(titleCase(clean));
  }
  return suburbs;
}

function locationSearchQueriesForPolicy(policy) {
  const suburbs = locationSuburbsForPolicy(policy).slice(0, locationAdSearchMaxSuburbsPerPostcode);
  return [
    ...suburbs.map((suburb) => ({ query: suburb, suburb })),
    { query: policy.postcode, suburb: null },
  ].filter((item) => item.query);
}

function canRecycleBlockedLocationSearch(job) {
  const payload = job.payload || {};
  if (payload.recycled_after_parser_fix_at) return false;
  if (payload.location_search_allowed !== true || payload.realEstateGate?.verified !== true) return false;
  if (!payload.postcode || !payload.query) return false;
  const priorFailure = `${job.blocked_reason || ""} ${job.last_error || ""} ${json(job.result || {})}`;
  return /Meta Ad Library page loaded but no ad result payload could be parsed|claim_expired_max_attempts/iu.test(priorFailure);
}

async function recycleBlockedLocationSearchJobs(limit) {
  const capacity = Math.max(0, Number(limit) || 0);
  if (capacity <= 0) return 0;
  const rows = await rest(
    "research",
    `work_queue?select=id,payload,blocked_reason,last_error,result&job_type=eq.${LOCATION_AD_SEARCH_JOB_TYPE}&status=eq.blocked&blocked_reason=in.(handler_failed_max_attempts,claim_expired_max_attempts)&order=updated_at.asc&limit=${Math.max(capacity * 4, capacity)}`,
  );
  let recycled = 0;
  for (const job of rows) {
    if (recycled >= capacity) break;
    if (!canRecycleBlockedLocationSearch(job)) continue;
    await rest("research", `work_queue?id=eq.${job.id}`, {
      method: "PATCH",
      body: json({
        payload: { ...(job.payload || {}), recycled_after_parser_fix_at: now() },
        status: "pending",
        attempts: 0,
        available_at: new Date(Date.now() + recycled * 3_000).toISOString(),
        claimed_at: null,
        claimed_by: null,
        claim_token: null,
        claim_expires_at: null,
        blocked_reason: null,
        last_error: null,
        result: {},
        completed_at: null,
      }),
    });
    await recordEvent("requeue", "work_queue", job.id, { job_type: LOCATION_AD_SEARCH_JOB_TYPE, reason: "location_search_parser_fix_recycle" }, { work_queue_id: job.id });
    recycled += 1;
  }
  return recycled;
}

// Location ad search (Path 2) has been removed — no-op stub kept for call site.
async function enqueueDueLocationAdSearchJobs() {
  return { locationSearchCandidates: 0, locationSearchEnqueued: 0 };
}

async function runWatchdogs() {
  const runHourlyWatchdogs = Date.now() % (60 * 60 * 1000) < intervalMs;
  const [stale, providerFailures, zeroAds, missingMedia, unclassified, classificationBackfill, staleBlockedArchive, staleAgencyRecheck, unresolvedPageRetry] = await Promise.all([
    rpc("watchdog_requeue_stale_jobs", { p_limit: 100 }),
    rpc("watchdog_record_provider_failures", { p_since: "24 hours", p_failure_threshold: 3 }),
    rpc("watchdog_record_zero_ad_anomalies", { p_since: "48 hours", p_limit: 100 }),
    rpc("watchdog_record_missing_media", { p_since: "24 hours", p_limit: 100 }),
    rpc("watchdog_record_unclassified_creatives", { p_since: "24 hours", p_limit: 100 }),
    enqueueClassificationBackfillJobs(),
    watchdogArchiveStaleBlockedJobs(),
    runHourlyWatchdogs
      ? watchdogRecheckStaleAgencies()
      : Promise.resolve({ staleAgencies: 0, staleAgencyRechecks: 0, staleAgencySkippedNoCensusSource: 0 }),
    runHourlyWatchdogs
      ? watchdogRequeueUnresolvedPages()
      : Promise.resolve({ unresolvedPages: 0, unresolvedPageRequeues: 0, unresolvedPagesMissingEvidence: 0 }),
  ]);
  return {
    stale: stale.length,
    providerFailures: providerFailures.length,
    zeroAds: zeroAds.length,
    missingMedia: missingMedia.length,
    unclassified: unclassified.length,
    classificationBackfill,
    ...staleBlockedArchive,
    ...staleAgencyRecheck,
    ...unresolvedPageRetry,
  };
}

async function watchdogArchiveStaleBlockedJobs() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await rest(
    "research",
    `work_queue?select=id,job_type,blocked_reason,last_error,result,updated_at&status=eq.blocked&updated_at=lt.${encode(cutoff)}&order=updated_at.asc&limit=100`,
  );
  let archived = 0;

  for (const job of rows) {
    const archivedAt = now();
    const priorResult = job.result && typeof job.result === "object" && !Array.isArray(job.result) ? job.result : {};
    const updated = await rest("research", `work_queue?id=eq.${encode(job.id)}&status=eq.blocked`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: json({
        status: "archived",
        blocked_reason: job.blocked_reason || "archived_stale_blocked_job",
        result: {
          ...priorResult,
          archived: {
            at: archivedAt,
            reason: "blocked_older_than_7_days",
            prior_blocked_reason: job.blocked_reason || null,
            prior_last_error: job.last_error || null,
          },
        },
      }),
    });
    if (updated?.[0]?.id) {
      archived += 1;
      await recordEvent("archive", "work_queue", job.id, {
        job_type: job.job_type,
        reason: "blocked_older_than_7_days",
        blocked_reason: job.blocked_reason || null,
        updated_at: job.updated_at || null,
      }, { work_queue_id: job.id });
    }
  }

  return {
    staleBlockedJobs: rows.length,
    staleBlockedArchived: archived,
  };
}

async function watchdogRecheckStaleAgencies() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await rest(
    "research",
    `agencies?select=id,primary_postcode,state,last_seen_at&is_real_estate=eq.true&primary_postcode=not.is.null&last_seen_at=lt.${encode(cutoff)}&order=last_seen_at.asc&limit=50`,
  );
  const seen = new Set();
  let requeued = 0;
  let skippedNoCensusSource = 0;

  for (const agency of rows) {
    const postcode = String(agency.primary_postcode || "").trim();
    const state = String(agency.state || "WA").toUpperCase();
    if (!/^\d{4}$/u.test(postcode)) continue;
    const key = `${state}:${postcode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!hasCensusSourceForPolicy({ postcode, state })) {
      skippedNoCensusSource += 1;
      continue;
    }

    const inserted = await enqueueFollowUp({
      queue_name: "research",
      job_type: "blockwise-agent-census",
      dedupe_key: `census:${state}:${postcode}`,
      priority: Math.min(12, censusQueuePriority),
      payload: {
        postcode,
        state,
        verified_roster_first: true,
        location_search_allowed: false,
        legacy_discovery_allowed: false,
        trigger: "stale_agency_recheck",
      },
      status: "pending",
      max_attempts: 3,
    }, null);
    if (inserted) requeued += 1;
  }

  return {
    staleAgencies: rows.length,
    staleAgencyRechecks: requeued,
    staleAgencySkippedNoCensusSource: skippedNoCensusSource,
  };
}

async function watchdogRequeueUnresolvedPages() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await rest(
    "research",
    `advertiser_pages?select=id,agent_id,agency_id,page_url,resolution_decision_id,last_seen_at&status=eq.verified_real_estate_unresolved&last_seen_at=lt.${encode(cutoff)}&order=last_seen_at.asc&limit=20`,
  );
  let requeued = 0;
  let missingEvidence = 0;

  for (const page of rows) {
    const subjectKind = page.agent_id ? "agent" : "agency";
    const subjectId = page.agent_id || page.agency_id;
    const decisionId = uuidOrNull(page.resolution_decision_id);
    if (!subjectId || !decisionId) {
      missingEvidence += 1;
      continue;
    }

    const decisionRows = await rest("research", `agent_decisions?select=id,source_document_ids,decision,evidence&id=eq.${encode(decisionId)}&limit=1`);
    const decision = decisionRows?.[0];
    const sourceDocumentIds = Array.isArray(decision?.source_document_ids)
      ? decision.source_document_ids.filter(Boolean)
      : [];
    const facebookUrl = typeof page.page_url === "string"
      ? page.page_url
      : typeof decision?.decision?.page_url === "string"
        ? decision.decision.page_url
        : typeof decision?.evidence?.page_url === "string"
          ? decision.evidence.page_url
          : null;
    if (!sourceDocumentIds.length) {
      missingEvidence += 1;
      continue;
    }

    const inserted = await enqueueFollowUp({
      queue_name: "research",
      job_type: "blockwise-page-resolver",
      dedupe_key: `page-resolver:${subjectKind}:${subjectId}`,
      priority: 12,
      payload: {
        subjectKind,
        subjectId,
        censusDecisionId: decisionId,
        sourceDocumentIds,
        facebookUrl,
        forceRevisit: true,
        location_search_allowed: false,
      },
      status: "pending",
      max_attempts: 3,
    }, null);
    if (inserted) requeued += 1;
  }

  return {
    unresolvedPages: rows.length,
    unresolvedPageRequeues: requeued,
    unresolvedPagesMissingEvidence: missingEvidence,
  };
}

async function enqueueClassificationBackfillJobs() {
  let enqueued = 0;
  for (const creative of await loadClassificationBackfillCandidates()) {
    const inserted = await enqueueClassificationJob(creative, null);
    if (inserted) enqueued += 1;
  }
  return enqueued;
}

async function loadClassificationBackfillCandidates() {
  const select = "id,observed_ad_id,creative_hash,classification_status,classification,ad_type,primary_intent,updated_at";
  const sources = [
    `ad_creatives?select=${select}&or=(classified_at.is.null,classification_status.in.(unclassified,failed),classification.eq.%7B%7D)&order=updated_at.asc.nullsfirst&limit=${classificationBackfillBatchSize}`,
    `ad_creatives?select=${select}&classification_status=eq.classified&order=updated_at.asc.nullsfirst&limit=${classificationBackfillBatchSize}`,
    `ad_creatives?select=${select}&or=(ad_type.eq.other,primary_intent.eq.other)&order=updated_at.asc.nullsfirst&limit=${classificationBackfillWeakBatchSize}`,
  ];
  const seen = new Set();
  const candidates = [];
  for (const path of sources) {
    const rows = await rest("research", path);
    for (const row of rows) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      if (!shouldReclassifyCreative(row)) continue;
      candidates.push(row);
      if (candidates.length >= classificationBackfillBatchSize) return candidates;
    }
  }
  return candidates;
}

async function claimJobs() {
  try {
    const claimed = await rpc("claim_work_queue_jobs", {
      p_worker_id: workerId,
      p_queue_name: "research",
      p_job_types: HANDLED_JOB_TYPES,
      p_limit: claimLimit,
      p_claim_ttl_seconds: claimTtlSeconds,
    });
    for (const job of claimed) await recordEvent("claim", "work_queue", job.id, { job_type: job.job_type, workerId }, { work_queue_id: job.id });
    return claimed;
  } catch (error) {
    if (!/claim_work_queue_jobs|PGRST202|404/i.test(error.message)) throw error;
    log("claim RPC unavailable, using direct REST fallback", { error: error.message }, "warning");
  }

  const pending = await rest("research", `work_queue?select=*&queue_name=eq.research&status=eq.pending&available_at=lte.${encode(now())}&job_type=in.(${HANDLED_JOB_TYPES.map(encode).join(",")})&order=priority.asc,available_at.asc,created_at.asc&limit=${claimLimit}`);
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
  if ((payload.state || "WA") !== "WA") return [];
  const configured = POSTCODE_ROSTER_SOURCES[payload.postcode] || [];
  const fromPostcodeData = (postcodeSuburbIndex.get(`WA:${payload.postcode}`) || [])
    .slice(0, maxRosterUrlsPerPostcode)
    .map((suburb) => ({ suburb, slug: suburbSlug(suburb) }))
    .filter((source) => source.slug);
  const seen = new Set();
  return [...configured, ...fromPostcodeData].filter((source) => {
    const key = source.slug;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((source) => ({
    source: "reiwa_agent_finder",
    suburb: source.suburb,
    url: `https://reiwa.com.au/real-estate-agents/${source.slug}/`,
  }));
}

function evidenceUrls(payload) {
  const direct = [payload.source_url, payload.website_url, payload.agency_url, payload.evidence_url, ...(Array.isArray(payload.source_urls) ? payload.source_urls : []), ...(Array.isArray(payload.evidence_urls) ? payload.evidence_urls : [])];
  const suburb = payload.suburb || postcodeSuburbIndex.get(`${payload.state || "WA"}:${payload.postcode}`)?.[0] || "";
  const templated = sourceTemplates.map((template) => template
    .replaceAll("{postcode}", payload.postcode)
    .replaceAll("{state}", payload.state || "WA")
    .replaceAll("{state_lower}", String(payload.state || "WA").toLowerCase())
    .replaceAll("{suburb}", suburb)
    .replaceAll("{suburb_slug}", suburbSlug(suburb)));
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
  if (remoteBrowserCdpUrl && Date.now() >= remoteBrowserDisabledUntil) {
    try {
      const webSocketUrl = await resolveRemoteBrowserWebSocket(remoteBrowserCdpUrl, Math.min(10_000, budgetMs));
      return await captureDomOverCdp(webSocketUrl, url, Math.min(budgetMs, 45_000));
    } catch (error) {
      remoteBrowserDisabledUntil = Date.now() + remoteBrowserFailureCooldownMs;
      log("Remote browser CDP capture failed; falling back to local Chromium", { error: error.message, cooldownMs: Math.max(0, remoteBrowserDisabledUntil - Date.now()) }, "warning");
    }
  }
  const profileDir = await mkdtemp(join(tmpdir(), "blockwise-meta-"));
  const browser = spawn(metaBrowserExecutable, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  try {
    const webSocketUrl = await waitForBrowserWebSocket(browser, Math.min(10_000, budgetMs));
    return await captureDomOverCdp(webSocketUrl, url, Math.min(budgetMs, 45_000));
  } finally {
    browser.kill("SIGKILL");
    await waitForBrowserExit(browser, 2_000).catch(() => {});
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function resolveRemoteBrowserWebSocket(cdpUrl, timeoutMs) {
  const configured = String(cdpUrl || "").trim();
  if (!configured) throw new Error("remote browser CDP URL is empty");
  if (/^wss?:\/\//iu.test(configured)) return configured;
  if (!/^https?:\/\//iu.test(configured)) throw new Error(`unsupported remote browser CDP URL: ${configured}`);

  const probeCdpUrl = await remoteBrowserProbeCdpUrl(configured);
  const versionUrl = remoteBrowserVersionUrl(probeCdpUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(versionUrl, { signal: controller.signal });
    const body = await response.text();
    if (!response.ok) throw new Error(`remote browser version endpoint failed ${response.status}: ${body.slice(0, 500)}`);
    const version = JSON.parse(body);
    if (!version.webSocketDebuggerUrl) throw new Error("remote browser version endpoint did not return webSocketDebuggerUrl");
    return rewriteRemoteBrowserWebSocketHost(version.webSocketDebuggerUrl, probeCdpUrl);
  } finally {
    clearTimeout(timeout);
  }
}

async function remoteBrowserProbeCdpUrl(cdpUrl) {
  const parsed = new URL(cdpUrl);
  if (remoteBrowserHostIsAllowed(parsed.hostname)) return parsed.toString();
  const { address } = await lookup(parsed.hostname);
  parsed.hostname = address;
  return parsed.toString();
}

function remoteBrowserHostIsAllowed(hostname) {
  return /^(localhost|127\.0\.0\.1|\[::1\]|::1|\d{1,3}(?:\.\d{1,3}){3})$/iu.test(hostname);
}

function remoteBrowserVersionUrl(cdpUrl) {
  const parsed = new URL(cdpUrl);
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/json/version`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function rewriteRemoteBrowserWebSocketHost(webSocketUrl, cdpUrl) {
  const reported = new URL(webSocketUrl);
  const configured = new URL(cdpUrl);
  reported.protocol = configured.protocol === "https:" ? "wss:" : "ws:";
  reported.username = configured.username;
  reported.password = configured.password;
  reported.hostname = configured.hostname;
  reported.port = configured.port;
  return reported.toString();
}

async function waitForBrowserWebSocket(browser, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Chromium did not expose DevTools within ${timeoutMs}ms: ${stderr.slice(-500)}`));
    }, timeoutMs);
    const onData = (chunk) => {
      stderr += String(chunk);
      const match = /DevTools listening on (ws:\/\/[^\s]+)/u.exec(stderr);
      if (match) {
        cleanup();
        resolve(match[1]);
      }
    };
    const onExit = () => {
      cleanup();
      reject(new Error(`Chromium exited before DevTools was ready: ${stderr.slice(-500)}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      browser.stderr.off("data", onData);
      browser.off("exit", onExit);
    };
    browser.stderr.on("data", onData);
    browser.once("exit", onExit);
  });
}

async function captureDomOverCdp(webSocketUrl, url, budgetMs) {
  const cdp = await openCdp(webSocketUrl);
  try {
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const sessionId = attached.sessionId;
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Page.navigate", { url }, sessionId);
    const deadline = Date.now() + budgetMs;
    let html = "";
    let bestHtml = "";
    let bestResultCount = 0;
    let bestAdPayloadCount = 0;
    let stableAdPayloadPolls = 0;
    let challengePolls = 0;
    while (Date.now() < deadline) {
      await sleep(2_000);
      html = await evaluateOuterHtml(cdp, sessionId);
      if (metaAdLibraryChallengeDetected(html)) {
        challengePolls += 1;
        if (!bestHtml) bestHtml = html;
        if (challengePolls <= 2 && Date.now() + 3_000 < deadline) {
          await sleep(3_000);
          await cdp.send("Page.reload", { ignoreCache: true }, sessionId).catch(() => {});
          continue;
        }
      } else {
        challengePolls = 0;
      }
      const resultCount = metaSearchResultCount(html);
      const adPayloadCount = metaSearchAdPayloadCount(html);
      if (!metaAdLibraryChallengeDetected(html) && (html.length > bestHtml.length || adPayloadCount > bestAdPayloadCount)) bestHtml = html;
      if (metaSearchHasConfirmedNoAds(html)) return html;
      if (resultCount > bestResultCount) {
        bestResultCount = resultCount;
      }
      if (adPayloadCount > bestAdPayloadCount) {
        bestAdPayloadCount = adPayloadCount;
        stableAdPayloadPolls = 0;
      } else if (adPayloadCount > 0) {
        stableAdPayloadPolls += 1;
      }
      if (adPayloadCount > 0 && stableAdPayloadPolls >= 3) return bestHtml || html;
      await scrollMetaAdLibraryResults(cdp, sessionId).catch(() => {});
    }
    await cdp.send("Page.stopLoading", {}, sessionId).catch(() => {});
    return bestHtml || html || await evaluateOuterHtml(cdp, sessionId);
  } finally {
    cdp.close();
  }
}

async function scrollMetaAdLibraryResults(cdp, sessionId) {
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const root = document.scrollingElement || document.documentElement || document.body;
      const scrollables = [root, document.documentElement, document.body, ...document.querySelectorAll("div")]
        .filter((element, index, all) => element && all.indexOf(element) === index)
        .filter((element) => element.scrollHeight > element.clientHeight);
      for (const element of scrollables) element.scrollTo(0, element.scrollHeight);
      window.scrollTo(0, document.body ? document.body.scrollHeight : 0);
      window.dispatchEvent(new Event("scroll"));
      return scrollables.length;
    })()`,
    awaitPromise: true,
  }, sessionId);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: 800,
    y: 800,
    deltaY: 2400,
    deltaX: 0,
  }, sessionId);
}

function metaSearchResultCount(html) {
  const counts = [...String(html || "").matchAll(/search_results_connection"\s*:\s*\{"count"\s*:\s*(\d+)/gu)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  return counts.length ? Math.max(...counts) : 0;
}

function metaSearchAdPayloadCount(html) {
  try {
    const bodies = [
      ...extractJsonObjectsAfterKey(html, "__bbox"),
      ...extractJsonObjectsAfterKey(html, "__bbox_result"),
      ...extractJsonObjectsAfterKey(html, "result"),
    ];
    return normaliseHostedMetaItems({ body: bodies, pageId: null, limit: 50 }).items.length;
  } catch {
    return 0;
  }
}

function metaSearchHasConfirmedNoAds(html) {
  return /search_results_connection"\s*:\s*\{"count"\s*:\s*0\b/iu.test(String(html || "")) && /\bNo ads\b/iu.test(String(html || ""));
}

function metaAdLibraryChallengeDetected(html) {
  const text = String(html || "");
  return /\/__rd_verify_[^"'\s<]+/iu.test(text) || /\bexecuteChallenge\s*\(/iu.test(text) || /\bchallenge=3\b/iu.test(text);
}

function metaBrowserChallengeCooldownRemaining() {
  return Math.max(0, metaBrowserChallengeDisabledUntil - Date.now());
}

async function recordMetaBrowserChallenge(kind, input) {
  metaBrowserChallengeDisabledUntil = Math.max(metaBrowserChallengeDisabledUntil, Date.now() + metaBrowserChallengeCooldownMs);
  const disabledUntil = new Date(metaBrowserChallengeDisabledUntil).toISOString();
  await setRuntimeSetting(META_BROWSER_CHALLENGE_DISABLED_UNTIL_SETTING, disabledUntil, {
    kind,
    postcode: input?.postcode || null,
    query: input?.query || null,
    metaPageId: input?.metaPageId || null,
  });
  log("Meta Ad Library browser challenge detected; cooling down free browser capture", {
    kind,
    cooldownMs: metaBrowserChallengeCooldownRemaining(),
    disabledUntil,
    postcode: input?.postcode || null,
    query: input?.query || null,
    metaPageId: input?.metaPageId || null,
  }, "warning");
}

function shouldDeferMetaBrowserChallengeJob(job) {
  return metaBrowserChallengeCooldownRemaining() > 0
    && (
      job.job_type === "blockwise-ad-collector" && metaCaptureProvider === "hermes_browser"
    );
}

async function openCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
    if (message.error) reject(new Error(`${message.error.message}: ${message.error.data || ""}`.trim()));
    else resolve(message.result || {});
  });
  return {
    send(method, params = {}, sessionId = null) {
      const id = nextId;
      nextId += 1;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP ${method} timed out`));
        }, 10_000);
        pending.set(id, { resolve, reject, timer });
        socket.send(json(payload));
      });
    },
    close() {
      for (const [id, entry] of pending.entries()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("CDP socket closed"));
        pending.delete(id);
      }
      socket.close();
    },
  };
}

async function evaluateOuterHtml(cdp, sessionId) {
  const evaluated = await cdp.send("Runtime.evaluate", {
    expression: "document.documentElement ? document.documentElement.outerHTML : ''",
    returnByValue: true,
  }, sessionId);
  return evaluated.result?.value || "";
}

async function waitForBrowserExit(browser, timeoutMs) {
  if (browser.exitCode !== null || browser.signalCode !== null) return;
  await Promise.race([
    new Promise((resolve) => browser.once("exit", resolve)),
    sleep(timeoutMs),
  ]);
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
    if (missingSchemaRelation(error, "agent_service_areas")) {
      throw new Error(`research.agent_service_areas is unavailable through REST; verified service areas cannot be written: ${error.message}`);
    }
    throw error;
  }
}

async function upsertVerifiedAgency(agency, sourceDocumentId, job) {
  const row = {
    name: agency.name,
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
  const verifiedAgencyRow = agencies?.[0] || null;
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
      const reusableAgent = await findReusableAgentForVerifiedAgency(agentNorm, agency.state, verifiedAgencyRow);
      if (reusableAgent?.id) {
        agentId = reusableAgent.id;
        await rest("research", `agents?id=eq.${agentId}`, {
          method: "PATCH",
          body: json({
            agency_id: agencyId,
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

async function findReusableAgentForVerifiedAgency(agentNorm, state, verifiedAgencyRow) {
  const rows = await rest(
    "research",
    `agents?select=id,agency_id,agencies(id,name,normalized_name,trading_name,metadata)&normalized_name=eq.${encode(agentNorm)}&state=eq.${encode(state || "WA")}&limit=10`,
  );
  return rows.find((row) => !row.agency_id || isLegalEntityAliasAgency(row.agencies, verifiedAgencyRow)) || null;
}

function isLegalEntityAliasAgency(existingAgency, verifiedAgency) {
  if (!existingAgency || !verifiedAgency) return false;
  if (existingAgency.id === verifiedAgency.id) return true;
  const existingName = normalizeName(existingAgency.normalized_name || existingAgency.trading_name || existingAgency.name);
  const demirs = verifiedAgency.metadata?.demirs_wa_licence_register || {};
  const verifiedLegalName = normalizeName(demirs.legal_entity_name || "");
  if (existingName && verifiedLegalName && existingName === verifiedLegalName) return true;
  const tradingNames = Array.isArray(demirs.trading_names) ? demirs.trading_names : [];
  return tradingNames.map((name) => normalizeName(name)).filter(Boolean).includes(existingName);
}

async function enqueueClassificationJob(creative, parentJob) {
  return enqueueFollowUp({
    queue_name: "research",
    job_type: "blockwise-ad-classifier",
    dedupe_key: `classifier:${creative.id}:${creative.creative_hash || "unknown"}:${CLASSIFIER_VERSION}`,
    advertiser_page_id: null,
    priority: 5,
    payload: {
      adCreativeId: creative.id,
      observedAdId: creative.observed_ad_id || null,
      classifier_version: CLASSIFIER_VERSION,
      force: true,
    },
    status: "pending",
    max_attempts: 3,
  }, parentJob);
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
    await recordEvent("requeue", "work_queue", recyclable.id, { parent_work_queue_id: parentJob?.id || null, job_type: input.job_type }, { work_queue_id: recyclable.id });
    return true;
  }
  const created = await rest("research", "work_queue", { method: "POST", headers: { Prefer: "return=representation" }, body: json(input) });
  if (created?.[0]?.id) await recordEvent("insert", "work_queue", created[0].id, { parent_work_queue_id: parentJob?.id || null, job_type: input.job_type }, { work_queue_id: created[0].id });
  return Boolean(created?.[0]?.id);
}

async function enqueuePostIngestJobs(item, advertiserPageId, buildRunId, parentJob) {
  if (item.media_sources > 0) {
    await enqueueFollowUp({
      queue_name: "research",
      job_type: "blockwise-media-collector",
      dedupe_key: `media:${item.ad_creative_id}:${item.creative_hash}`,
      advertiser_page_id: advertiserPageId,
      priority: 5,
      payload: { adCreativeId: item.ad_creative_id, observedAdId: item.observed_ad_id, build_run_id: buildRunId },
      status: "pending",
      max_attempts: 3,
    }, parentJob);
  }
  await enqueueFollowUp({
    queue_name: "research",
    job_type: "blockwise-ad-classifier",
    dedupe_key: `classifier:${item.ad_creative_id}:${item.creative_hash}:${CLASSIFIER_VERSION}`,
    advertiser_page_id: advertiserPageId,
    priority: 5,
    payload: { adCreativeId: item.ad_creative_id, observedAdId: item.observed_ad_id, build_run_id: buildRunId, classifier_version: CLASSIFIER_VERSION },
    status: "pending",
    max_attempts: 3,
  }, parentJob);
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
    active_status: "all",
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

function facebookUrlMatchesResolverAgency(pageUrl, subject) {
  if (subject.kind !== "agent" || !subject.agency?.id) return false;
  const urlText = normalizeName(pageUrl);
  const agencyTokens = significantNameTokens(subject.agency.name || subject.agency.trading_name || "");
  if (!agencyTokens.length) return false;
  const overlap = agencyTokens.filter((token) => urlText.includes(token)).length;
  return overlap >= Math.min(2, agencyTokens.length);
}

function resolverSubjectForFacebookPage(pageUrl, subject) {
  if (facebookUrlMatchesResolverSubject(pageUrl, subject)) {
    return { pageSubject: subject, agencyPageFallback: false };
  }
  if (!facebookUrlMatchesResolverAgency(pageUrl, subject)) return null;
  return {
    pageSubject: {
      kind: "agency",
      id: subject.agency.id,
      name: subject.agency.name || subject.agency.trading_name || subject.name,
      agency: subject.agency,
      agent: null,
    },
    agencyPageFallback: true,
  };
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

function coverageDefectReason(row) {
  const note = String(row.notes || "").toLowerCase();
  const resolution = row.resolution || {};
  if (row.reason) return String(row.reason);
  if (resolution.reason) return String(resolution.reason);
  if (note.includes("census could not verify")) return "census_requires_verified_evidence";
  if (note.includes("page resolver could not find")) return "page_resolver_no_verified_meta_page";
  if (note.includes("location ad search could not fetch")) return "location_ad_search_capture_failed";
  if (note.includes("ad collector could not fetch")) return "ad_collector_capture_failed";
  if (note.includes("still had more pages") || note.includes("hit resultslimit")) return "ad_collector_truncated";
  if (note.includes("coverage audit found")) return "coverage_audit_gap";
  return `unknown:${hash(`${row.reported_by || "system"}:${row.notes || ""}`).slice(0, 16)}`;
}

function coverageDefectSubject(row) {
  const resolution = row.resolution || {};
  if (row.subject_type && row.subject_key) return { subject_type: String(row.subject_type), subject_key: String(row.subject_key) };
  if (row.resolved_advertiser_page_id) return { subject_type: "advertiser_page", subject_key: String(row.resolved_advertiser_page_id) };
  if (resolution.advertiser_page_id) return { subject_type: "advertiser_page", subject_key: String(resolution.advertiser_page_id) };
  if (row.resolved_agent_id) return { subject_type: "agent", subject_key: String(row.resolved_agent_id) };
  if (row.resolved_agency_id) return { subject_type: "agency", subject_key: String(row.resolved_agency_id) };
  if (row.postcode) return { subject_type: "coverage_area", subject_key: `${String(row.state || "WA").toUpperCase()}:${row.postcode}` };
  if (resolution.meta_page_id) return { subject_type: "meta_page", subject_key: `${row.platform || "facebook"}:${resolution.meta_page_id}` };
  if (resolution.actor_id) return { subject_type: "capture_actor", subject_key: `${row.platform || "facebook"}:${resolution.actor_id}` };
  if (row.platform) return { subject_type: "platform", subject_key: String(row.platform) };
  return { subject_type: "system", subject_key: hash(`${coverageDefectReason(row)}:${row.notes || ""}`).slice(0, 32) };
}

async function resolveCoverageDefects({ subject_type, subject_key, reason = null, resolution = {} }) {
  const resolvedAt = now();
  const reasonFilter = reason ? `&reason=eq.${encode(reason)}` : "";
  try {
    await rest("research", `coverage_defects?subject_type=eq.${encode(subject_type)}&subject_key=eq.${encode(subject_key)}&status=in.(open,investigating,blocked)${reasonFilter}`, {
      method: "PATCH",
      body: json({
        status: "resolved",
        resolved_at: resolvedAt,
        resolution: {
          ...resolution,
          auto_resolved_by: "hermes-success",
          auto_resolved_at: resolvedAt,
        },
      }),
    });
  } catch (error) {
    if (!/subject_type|subject_key|reason|resolved_at|schema cache|PGRST204|42703/i.test(error.message)) throw error;
  }
}

async function insertCoverageDefect(row) {
  const subject = coverageDefectSubject(row);
  const reason = coverageDefectReason(row);
  const defect = {
    ...row,
    ...subject,
    reason,
    occurrences: Math.max(1, Number.parseInt(row.occurrences || "1", 10) || 1),
  };
  try {
    await rpc("upsert_coverage_defect", { p_defect: defect });
    return;
  } catch (error) {
    if (!/upsert_coverage_defect|subject_type|subject_key|reason|occurrences|schema cache|PGRST202|PGRST204|42703|42883/i.test(error.message)) throw error;
  }
  try {
    await rest("research", "coverage_defects", {
      method: "POST",
      body: json(defect),
    });
  } catch (error) {
    if (!/reporter_identity|resolution_decision_id|resolved_agent_id|resolved_agency_id|resolved_advertiser_page_id|resolved_at|subject_type|subject_key|reason|occurrences|schema cache|PGRST204|42703/i.test(error.message)) throw error;
    const {
      reporter_identity: _reporterIdentity,
      resolution_decision_id: _resolutionDecisionId,
      resolved_agent_id: _resolvedAgentId,
      resolved_agency_id: _resolvedAgencyId,
      resolved_advertiser_page_id: _resolvedAdvertiserPageId,
      resolved_at: _resolvedAt,
      subject_type: _subjectType,
      subject_key: _subjectKey,
      reason: _reason,
      occurrences: _occurrences,
      ...compatibleRow
    } = defect;
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
      resultsLimit: metaCaptureResultsLimit,
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
    await resolveCoverageDefects({
      subject_type: "coverage_area",
      subject_key: `${String(payload.state || "WA").toUpperCase()}:${payload.postcode}`,
      reason: "census_requires_verified_evidence",
      resolution: { handler: "blockwise-agent-census", verified_agencies: found.length },
    });
    return { status: "complete", result: { handler: "blockwise-agent-census", verified_agencies: found.length, queued_page_resolvers: queuedResolvers, errors } };
  }

  const reason = errors.length ? "census_evidence_fetch_failed" : "census_requires_verified_evidence";
  await deferCensusPolicy(payload.postcode, payload.state || "WA", reason, errors.length ? 6 : 24, true);
  await insertCoverageDefect({ postcode: payload.postcode, state: payload.state || "WA", reason: "census_requires_verified_evidence", notes: `Hermes census could not verify an evidence-backed roster without allowed public evidence (${reason}).`, reported_by: "system", reporter_identity: workerId, status: "blocked", resolution: { reason, errors, location_search_allowed: false } });
  return { status: "complete", result: { handler: "blockwise-agent-census", reason, verified_agencies: 0, queued_page_resolvers: 0, census_deferred: true, defect_recorded: true, errors, location_search_allowed: false } };
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
  const suppliedFacebookUrl = typeof payload.facebookUrl === "string"
    ? payload.facebookUrl
    : typeof payload.pageUrl === "string"
      ? payload.pageUrl
      : null;
  if (suppliedFacebookUrl && /^https:\/\/(?:www\.)?facebook\.com\//iu.test(suppliedFacebookUrl)) {
    facebookCandidates.add(suppliedFacebookUrl);
    fetched.push({ url: suppliedFacebookUrl, supplied: "payload_facebook_url" });
  }

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
    const subjectMatch = resolverSubjectForFacebookPage(pageUrl, subject);
    if (!subjectMatch) {
      fetched.push({ url: pageUrl, skipped: "facebook_url_does_not_match_verified_subject" });
      continue;
    }
    const { pageSubject, agencyPageFallback } = subjectMatch;
    const pageSubjectMeta = resolverSubjectMetadata(pageSubject);
    const pageSlug = facebookSlugFromUrl(pageUrl);
    let numericId = facebookPageIdFromUrl(pageUrl);
    let facebookSourceDocumentId = null;
    if (!numericId) {
      try {
        const html = await fetchFacebookPageDocument(pageUrl);
        facebookSourceDocumentId = await sourceDocument("meta_page", pageUrl, html, { ...pageSubjectMeta, work_queue_id: job.id, page_slug: pageSlug, source_subject_kind: subject.kind, source_subject_id: subject.id });
        fetched.push({ url: pageUrl, sourceDocumentId: facebookSourceDocumentId });
        numericId = facebookPageIdFromHtml(html, pageSlug);
      } catch (error) {
        fetched.push({ url: pageUrl, error: error.message });
      }
    }
    const confidence = numericId ? (agencyPageFallback ? 88 : 92) : (agencyPageFallback ? 74 : 78);
    const decisionId = await createPageResolutionDecision({
      subjectKind: pageSubject.kind,
      subjectId: pageSubject.id,
      agentId: pageSubject.agent?.id || null,
      agencyId: pageSubject.agency?.id || null,
      confidence,
      sourceDocumentIds: fetched.map((item) => item.sourceDocumentId).filter(Boolean),
      evidence: {
        page_url: pageUrl,
        evidence_urls: fetched.map((item) => item.url),
        page_slug: pageSlug,
        numeric_page_id_found: Boolean(numericId),
        subject_name: pageSubject.name,
        source_subject_name: subject.name,
        agency_page_fallback: agencyPageFallback,
      },
      decision: {
        resolved: Boolean(numericId),
        collectable: Boolean(numericId),
        page_url: pageUrl,
        page_id: numericId || pageSlug,
        location_search_allowed: false,
      },
      rationale: agencyPageFallback
        ? "Resolved an agency Facebook page from verified agent evidence; collection is agency-owned so ads are not misattributed to the agent."
        : numericId
          ? "Resolved a verified real-estate subject to a Facebook page from controlled evidence before collection."
          : "Found a Facebook page link from controlled evidence but could not confirm a numeric Meta page id for collection.",
    });
    const advertiserPageId = await upsertAdvertiserPage({
      agentId: pageSubject.agent?.id || null,
      agencyId: pageSubject.agency?.id || null,
      decisionId,
      pageId: numericId || `slug:${pageSlug}`,
      pageSlug,
      pageName: pageSubject.name,
      pageUrl,
      status: numericId ? "resolved_collectable" : "verified_real_estate_unresolved",
      confidence,
      evidenceUrls: fetched.map((item) => item.url),
      metadata: agencyPageFallback ? { resolver: "verified_agent_agency_page_fallback", source_subject_kind: subject.kind, source_subject_id: subject.id } : {},
    });
    if (advertiserPageId) {
      await rest("research", "real_estate_verifications", {
        method: "POST",
        body: json({
          subject_type: "advertiser_page",
          subject_id: advertiserPageId,
          advertiser_page_id: advertiserPageId,
          agent_id: pageSubject.agent?.id || null,
          agency_id: pageSubject.agency?.id || null,
          verification_status: numericId ? "verified" : "needs_review",
          evidence_type: "meta_page",
          evidence_url: pageUrl,
          evidence: {
            subject_kind: pageSubject.kind,
            subject_name: pageSubject.name,
            source_subject_kind: subject.kind,
            source_subject_name: subject.name,
            agent_name: pageSubject.agent?.full_name || null,
            agency_name: pageSubject.agency?.name || null,
            page_slug: pageSlug,
            numeric_page_id_found: Boolean(numericId),
            agency_page_fallback: agencyPageFallback,
          },
          source_document_id: fetched.find((item) => item.sourceDocumentId)?.sourceDocumentId || null,
          verified_by: "blockwise-page-resolver",
          verified_at: numericId ? now() : null,
          confidence,
          notes: agencyPageFallback
            ? "Hermes deterministic agency page fallback from verified agent evidence."
            : numericId
              ? "Hermes deterministic page verification."
              : "Facebook page link found; numeric page id still required before collection.",
        }),
      });
      resolved.push({ advertiserPageId, pageUrl, pageSlug, metaPageId: numericId, decisionId, subjectKind: pageSubject.kind });
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
    await resolveCoverageDefects({
      subject_type: subject.kind,
      subject_key: subject.id,
      reason: "page_resolver_no_verified_meta_page",
      resolution: { handler: "blockwise-page-resolver", resolved_pages: resolved.length },
    });
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
    subject_type: subject.kind,
    subject_key: subject.id,
    reason: "page_resolver_no_verified_meta_page",
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
  return { status: "complete", result: { handler: "blockwise-page-resolver", subject_kind: subject.kind, subject_id: subject.id, agent_id: subject.agent?.id || null, agency_id: subject.agency?.id || null, resolved_pages: 0, collectable_pages: 0, collection_started: false, unresolved_recorded: true, defect_recorded: true, fetched, location_search_allowed: false } };
}

function captureInput(payload) {
  return {
    advertiserPageId: payload.advertiserPageId,
    metaPageId: String(payload.metaPageId),
    country: String(payload.country || "AU").toUpperCase(),
    activeStatus: ["active", "inactive", "all"].includes(payload.activeStatus) ? payload.activeStatus : "all",
    resultsLimit: Math.max(1, Math.min(Number.parseInt(payload.resultsLimit || `${metaCaptureResultsLimit}`, 10) || metaCaptureResultsLimit, 250)),
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

const META_CAPTURE_CLI_PATH = env.HERMES_META_CAPTURE_CLI_PATH || "/app/meta-library-capture/bin/capture.mjs";
const META_CAPTURE_CLI_TIMEOUT_MS = positiveInt("HERMES_META_CAPTURE_CLI_TIMEOUT_MS", 180_000);
const META_CAPTURE_CLI_MAX_STDOUT_BYTES = 10_000_000;

async function runMetaLibraryCaptureCli({ url, kind, metaPageId, country, activeStatus, resultsLimit, timeoutMs, proxyUrl }) {
  const startedAt = now();
  const cliTimeout = timeoutMs || META_CAPTURE_CLI_TIMEOUT_MS;
  const input = JSON.stringify({ url, kind, metaPageId, country, activeStatus, resultsLimit, timeoutMs: cliTimeout, ...(proxyUrl ? { proxyUrl } : {}) });
  try {
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [META_CAPTURE_CLI_PATH, "--input", input], { stdio: ["ignore", "pipe", "pipe"] });
      let out = ""; let err = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`capture CLI timed out after ${cliTimeout}ms`)); }, cliTimeout);
      child.stdout.on("data", (c) => { if (Buffer.byteLength(out) < META_CAPTURE_CLI_MAX_STDOUT_BYTES) out += c; });
      child.stderr.on("data", (c) => { err += String(c).slice(0, 4096); });
      child.on("close", (code) => { clearTimeout(timer); code !== 0 ? reject(new Error(`capture CLI exited ${code}: ${err.slice(0, 500)}`)) : resolve(out); });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
    });
    const parsed = JSON.parse(stdout);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
      return { runId: `cli-${Date.now()}`, provider: META_BROWSER_SOURCE_PROVIDER, status: "FAILED", startedAt, finishedAt: now(), costUsd: 0, itemCount: 0, items: [], rawDatasetId: null, errorMessage: "capture CLI returned invalid outcome shape", metadata: {} };
    }
    return { ...parsed, provider: META_BROWSER_SOURCE_PROVIDER, costUsd: 0, rawDatasetId: parsed.rawDatasetId ?? null };
  } catch (error) {
    return { runId: `cli-failed-${Date.now()}`, provider: META_BROWSER_SOURCE_PROVIDER, status: "FAILED", startedAt, finishedAt: now(), costUsd: 0, itemCount: 0, items: [], rawDatasetId: null, errorMessage: error.message, metadata: {} };
  }
}

async function runHermesBrowserCapture(input) {
  const url = metaAdLibraryPageUrl(input);
  return runMetaLibraryCaptureCli({
    url,
    kind: "page",
    metaPageId: input.metaPageId,
    country: input.country || "AU",
    activeStatus: input.activeStatus || "all",
    resultsLimit: input.resultsLimit,
    timeoutMs: metaCaptureTimeoutMs,
    proxyUrl: env.RESIDENTIAL_PROXY_URL || env.HERMES_META_CAPTURE_PROXY_URL || "",
  });
}

function configuredMetaFallbackSourceProvider() {
  return metaCaptureProvider === "http_json" && metaCaptureEndpoint
    ? META_STRUCTURED_SOURCE_PROVIDER
    : META_BROWSER_SOURCE_PROVIDER;
}

async function runFallbackMetaPageCapture(input, sourceProvider = configuredMetaFallbackSourceProvider()) {
  if (sourceProvider === META_STRUCTURED_SOURCE_PROVIDER) {
    const startedAt = now();
    const response = await fetch(metaCaptureEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json(input),
    });
    const body = await response.json().catch(() => null);
    return response.ok
      ? normalizeCaptureOutcome(body, input, META_STRUCTURED_SOURCE_PROVIDER, startedAt)
      : { status: "FAILED", errorMessage: `capture endpoint failed ${response.status}`, itemCount: 0, items: [], costUsd: 0, metadata: { http_status: response.status, body } };
  }

  return runHermesBrowserCapture(input);
}

async function runMetaPageCapture(input) {
  const fallbackSourceProvider = configuredMetaFallbackSourceProvider();
  if (metaOfficialApiEnabled) {
    const official = await runOfficialMetaPageApiCapture(input);
    if (official.status === "SUCCEEDED") {
      return { outcome: official, sourceProvider: META_OFFICIAL_SOURCE_PROVIDER, captureMode: "official_api" };
    }

    log("Official Meta Ads Archive capture failed; falling back to configured page capture", {
      advertiser_page_id: input.advertiserPageId,
      meta_page_id: input.metaPageId,
      error: official.errorMessage,
    }, "warn");
    const fallback = await runFallbackMetaPageCapture(input, fallbackSourceProvider);
    const sourceProvider = fallback.provider || fallbackSourceProvider;
    return {
      outcome: {
        ...fallback,
        metadata: {
          ...(fallback.metadata || {}),
          official_api_failed: true,
          official_api_error: official.errorMessage,
        },
      },
      sourceProvider,
      captureMode: captureModeForSourceProvider(sourceProvider, "after_official_api_failure"),
    };
  }

  const fallback = await runFallbackMetaPageCapture(input, fallbackSourceProvider);
  const sourceProvider = fallback.provider || fallbackSourceProvider;
  return {
    outcome: fallback,
    sourceProvider,
    captureMode: captureModeForSourceProvider(sourceProvider),
  };
}

function captureModeForSourceProvider(sourceProvider, suffix = "") {
  const modeName = sourceProvider === META_OFFICIAL_SOURCE_PROVIDER
    ? "official_api"
    : sourceProvider === META_STRUCTURED_SOURCE_PROVIDER
      ? "http_json"
      : "browser";
  return suffix ? `${modeName}_${suffix}` : modeName;
}

function failedCaptureOutcome(provider, input, startedAt, errorMessage, metadata = {}, costUsd = 0) {
  return {
    runId: `${provider}-failed-${input.metaPageId}-${Date.now()}`,
    provider,
    status: "FAILED",
    startedAt,
    finishedAt: now(),
    costUsd,
    itemCount: 0,
    items: [],
    rawDatasetId: null,
    errorMessage,
    metadata: {
      advertiserPageId: input.advertiserPageId,
      resolverDecisionId: input.resolverDecisionId,
      ...metadata,
    },
  };
}

function skippedCaptureOutcome(provider, input, startedAt, message, metadata = {}) {
  return {
    runId: `${provider}-skipped-${input.metaPageId}-${Date.now()}`,
    provider,
    status: "SKIPPED",
    startedAt,
    finishedAt: now(),
    costUsd: 0,
    itemCount: 0,
    items: [],
    rawDatasetId: null,
    errorMessage: message,
    metadata: {
      advertiserPageId: input.advertiserPageId,
      resolverDecisionId: input.resolverDecisionId,
      ...metadata,
    },
  };
}

function previousCaptureFailureMetadata(outcome) {
  return outcome && outcome.status !== "SUCCEEDED"
    ? {
        provider: outcome.provider,
        error: outcome.errorMessage || null,
        item_count: outcome.itemCount || 0,
      }
    : null;
}

async function runOfficialMetaPageApiCapture(input) {
  const startedAt = now();
  const warnings = [];
  const items = [];
  const seen = new Set();
  const requestedStatuses = officialMetaStatusPasses(input.activeStatus);
  let pagesFetched = 0;
  let truncated = false;

  try {
    for (const activeStatus of requestedStatuses) {
      let url = officialMetaAdsArchiveUrl(input, activeStatus);
      let statusPagesFetched = 0;
      while (url && statusPagesFetched < metaOfficialMaxPagesPerCapture) {
        statusPagesFetched += 1;
        pagesFetched += 1;
        const { response, body } = await fetchOfficialMetaArchivePage(url);
        if (!response.ok || body?.error) {
          return {
            runId: `official-meta-api-failed-${input.metaPageId}-${Date.now()}`,
            provider: META_OFFICIAL_SOURCE_PROVIDER,
            status: "FAILED",
            startedAt,
            finishedAt: now(),
            costUsd: 0,
            itemCount: items.length,
            items,
            rawDatasetId: null,
            errorMessage: `official Meta Ads Archive ${activeStatus} failed ${response.status}: ${redactOfficialApiError(body?.error?.message || body?.error || "unknown error")}`,
            metadata: officialMetaCaptureMetadata(input, pagesFetched, truncated, warnings, false),
          };
        }

        for (const raw of objectArray(body?.data)) {
          const item = normaliseHostedMetaAd({ ...raw, ad_active_status: activeStatus.toLowerCase() }, input.metaPageId);
          if (!looksLikeAdId(item.adArchiveID) || seen.has(item.adArchiveID)) continue;
          seen.add(item.adArchiveID);
          items.push(item);
        }

        const next = safeOfficialAdsArchiveNextUrl(body?.paging?.next);
        if (body?.paging?.next && !next) {
          warnings.push(`Official API returned an unsafe ${activeStatus} pagination URL; pagination stopped.`);
        }
        url = next;
        if (url && statusPagesFetched >= metaOfficialMaxPagesPerCapture) {
          truncated = true;
          warnings.push(`Official API still had more ${activeStatus} pages after ${metaOfficialMaxPagesPerCapture} page(s); capture is truncated.`);
        }
      }
    }

    return {
      runId: `official-meta-api-${input.metaPageId}-${Date.now()}`,
      provider: META_OFFICIAL_SOURCE_PROVIDER,
      status: "SUCCEEDED",
      startedAt,
      finishedAt: now(),
      costUsd: 0,
      itemCount: items.length,
      items,
      rawDatasetId: null,
      errorMessage: warnings.join("; ") || null,
      metadata: officialMetaCaptureMetadata(input, pagesFetched, truncated, warnings, items.length === 0),
    };
  } catch (error) {
    return {
      runId: `official-meta-api-failed-${input.metaPageId}-${Date.now()}`,
      provider: META_OFFICIAL_SOURCE_PROVIDER,
      status: "FAILED",
      startedAt,
      finishedAt: now(),
      costUsd: 0,
      itemCount: 0,
      items: [],
      rawDatasetId: null,
      errorMessage: redactOfficialApiError(error.message),
      metadata: officialMetaCaptureMetadata(input, pagesFetched, truncated, warnings, false),
    };
  }
}

function officialMetaCaptureMetadata(input, pagesFetched, truncated, warnings, confirmedAbsence) {
  return {
    api_version: metaOfficialApiVersion,
    ad_type: metaOfficialAdType,
    requested_active_status: input.activeStatus,
    official_active_statuses: officialMetaStatusPasses(input.activeStatus),
    country: input.country,
    page_limit: metaOfficialPageLimit,
    pages_fetched: pagesFetched,
    max_pages_per_capture: metaOfficialMaxPagesPerCapture,
    truncated,
    confirmed_absence: confirmedAbsence,
    warnings,
    advertiserPageId: input.advertiserPageId,
    resolverDecisionId: input.resolverDecisionId,
  };
}

async function fetchOfficialMetaArchivePage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), metaCaptureTimeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => null);
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

function officialMetaAdsArchiveUrl(input, activeStatus) {
  const params = new URLSearchParams({
    access_token: metaOfficialAccessToken,
    ad_active_status: activeStatus,
    ad_reached_countries: json([input.country]),
    ad_type: metaOfficialAdType,
    fields: META_OFFICIAL_ADS_ARCHIVE_FIELDS,
    limit: String(metaOfficialPageLimit),
    search_page_ids: json([input.metaPageId]),
  });

  return `https://graph.facebook.com/${metaOfficialApiVersion}/ads_archive?${params.toString()}`;
}

function officialMetaStatusPasses(value) {
  if (value === "active") return ["ACTIVE"];
  if (value === "inactive") return ["INACTIVE"];
  return ["ACTIVE", "INACTIVE"];
}

function safeOfficialAdsArchiveNextUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "graph.facebook.com") return null;
    if (!/\/ads_archive$/u.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function redactOfficialApiError(value) {
  const text = typeof value === "string" ? value : json(value);
  const token = metaOfficialAccessToken.trim();
  return (token ? text.replaceAll(token, "[redacted]") : text).slice(0, 500);
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

function metaAdLibraryLocationSearchUrl(input) {
  const params = new URLSearchParams({
    active_status: input.activeStatus || "all",
    ad_type: "all",
    country: input.country || "AU",
    media_type: "all",
    search_type: "keyword_unordered",
    q: input.query,
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

function locationSearchInput(payload) {
  return {
    query: String(payload.query || payload.suburb || payload.postcode || "").trim(),
    postcode: String(payload.postcode || "").trim(),
    suburb: payload.suburb ? titleCase(payload.suburb) : null,
    state: String(payload.state || "WA").toUpperCase(),
    country: String(payload.country || "AU").toUpperCase(),
    activeStatus: ["active", "inactive", "all"].includes(payload.activeStatus) ? payload.activeStatus : "all",
    resultsLimit: Math.max(1, Math.min(Number.parseInt(payload.resultsLimit || `${metaCaptureResultsLimit}`, 10) || metaCaptureResultsLimit, 250)),
    realEstateGate: payload.realEstateGate,
  };
}

async function runHermesLocationSearchCapture(input, job) {
  const url = metaAdLibraryLocationSearchUrl(input);
  const cliResult = await runMetaLibraryCaptureCli({
    url,
    kind: "location_search",
    metaPageId: input.metaPageId,
    country: input.country || "AU",
    activeStatus: input.activeStatus || "all",
    resultsLimit: input.resultsLimit || 25,
    timeoutMs: metaCaptureTimeoutMs,
    proxyUrl: env.RESIDENTIAL_PROXY_URL || env.HERMES_META_CAPTURE_PROXY_URL || "",
  });

  // Map CLI output (snake_case metadata) to the supervisor's camelCase contract.
  return {
    runId: cliResult.runId,
    provider: META_LOCATION_SEARCH_SOURCE_PROVIDER,
    status: cliResult.status,
    startedAt: cliResult.startedAt,
    finishedAt: cliResult.finishedAt,
    costUsd: cliResult.costUsd || 0,
    itemCount: (cliResult.items || []).length,
    items: cliResult.items || [],
    rawDatasetId: cliResult.rawDatasetId || null,
    errorMessage: cliResult.errorMessage || null,
    metadata: {
      ...(cliResult.metadata || {}),
      sourceDocumentId: (cliResult.metadata && cliResult.metadata.source_document_id) || null,
      confirmed_absence: Boolean(cliResult.metadata && cliResult.metadata.confirmed_absence),
      blocked_reason: (cliResult.metadata && cliResult.metadata.blocked_reason) || null,
      postcode: input.postcode,
      suburb: input.suburb,
      state: input.state,
      query: input.query,
    },
  };
}

function normaliseMetaAdLibraryHtml({ html, pageId, limit }) {
  const connections = extractJsonObjectsAfterKey(html, "search_results_connection");
  const bodies = connections.length ? connections : [html];
  const normalised = normaliseHostedMetaItems({ body: bodies, pageId, limit });
  const counts = connections.map((connection) => Number(connection?.count)).filter(Number.isFinite);
  const challengeDetected = metaAdLibraryChallengeDetected(html);
  const confirmedAbsence = connections.some((connection) => Number(connection?.count) === 0 && objectArray(connection?.edges).length === 0)
    || metaSearchHasConfirmedNoAds(html);
  if (!normalised.items.length && !confirmedAbsence) {
    normalised.warnings.push(challengeDetected
      ? "Meta Ad Library returned a browser verification challenge."
      : "Meta Ad Library page loaded but no ad result payload could be parsed.");
  }
  return {
    ...normalised,
    confirmedAbsence,
    challengeDetected,
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
      caption: firstString(
        pick(firstCard, "caption"),
        pick(snapshot, "caption"),
        firstArrayString(pick(raw, "ad_creative_link_captions", "ad_creative_link_descriptions", "adCreativeLinkDescriptions")),
      ),
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

async function insertLocationSearchFetchRun(job, buildRunId, input) {
  const row = {
    build_run_id: buildRunId,
    work_queue_id: job.id,
    source_provider: META_LOCATION_SEARCH_SOURCE_PROVIDER,
    role: "primary",
    trigger: "scheduled",
    target_kind: "advertiser_page",
    target_value: `location-search:${input.state}:${input.postcode}:${hash(input.query).slice(0, 12)}`,
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

async function markAdvertiserPageCheckFailed(advertiserPageId) {
  if (!advertiserPageId) return;
  const page = await rest("research", `advertiser_pages?select=consecutive_failed_checks&id=eq.${advertiserPageId}&limit=1`);
  const consecutiveFailedChecks = Math.min(99, Number(page?.[0]?.consecutive_failed_checks || 0) + 1);
  await rest("research", `advertiser_pages?id=eq.${advertiserPageId}`, {
    method: "PATCH",
    body: json({ last_checked_at: now(), consecutive_failed_checks: consecutiveFailedChecks }),
  });
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

async function ingestMetaAd({ ad, advertiserPageId, adFetchRunId, buildRunId, sourceProvider, parentJob, explicitAreaMatch = null }) {
  const rawPayload = ad.rawHostedProvider || ad;
  const payloadHash = hash(json(rawPayload));
  const platforms = normalisePlatforms(ad.publisherPlatform);
  const creative = creativeFromMetaAd(ad);
  const activeStatus = activeStatusForMetaAd(ad);
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
      active_status: activeStatus,
      last_seen_at: now(),
      last_checked_at: now(),
      missing_successive_checks: 0,
      meta_publisher_platforms: platforms,
      ad_delivery_started_at: metaTimestamp(ad.startDate),
      ad_delivery_stopped_at: deliveryStoppedAtForMetaAd(ad, activeStatus),
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
  if (explicitAreaMatch) {
    await upsertExplicitAreaMatchForObservedAd({ observedAdId: observedAd.id, ...explicitAreaMatch });
  }
  await upsertAreaMatchesForObservedAd({ advertiserPageId, observedAdId: observedAd.id });
  return { observed_ad_id: observedAd.id, ad_creative_id: adCreative.id, creative_hash: creativeHash, external_ad_id: ad.adArchiveID, media_sources: mediaCount };
}

function activeStatusForMetaAd(ad) {
  if (ad?.isActive === true) return "active";
  if (ad?.isActive === false) return "inactive";
  const status = firstString(ad?.status)?.toLowerCase();
  if (status === "active") return "active";
  if (status === "inactive" || status === "ended" || status === "stopped") return "inactive";
  return "unknown";
}

function deliveryStoppedAtForMetaAd(ad, activeStatus = activeStatusForMetaAd(ad)) {
  const stoppedAt = metaTimestamp(ad?.endDate);
  if (activeStatus === "active") return null;
  return stoppedAt;
}

async function isTrustedConfirmedZeroAdCapture({ advertiserPageId, sourceProvider }) {
  if (sourceProvider === META_OFFICIAL_SOURCE_PROVIDER) return true;
  const rows = await rest(
    "research",
    `observed_ads?select=id&advertiser_page_id=eq.${encode(advertiserPageId)}&limit=1`,
  );
  return rows.length === 0;
}

async function reconcileMissingObservedAds({ advertiserPageId, seenExternalAdIds, checkedAt = now() }) {
  if (!advertiserPageId) return { activeAdsChecked: 0, missingAdsUpdated: 0, adsMarkedInactive: 0 };
  const seen = new Set(seenExternalAdIds.map((id) => String(id || "")).filter(Boolean));
  const activeRows = await rest(
    "research",
    `observed_ads?select=id,external_ad_id,missing_successive_checks,ad_delivery_stopped_at&advertiser_page_id=eq.${encode(advertiserPageId)}&active_status=eq.active&limit=5000`,
  );
  let missingAdsUpdated = 0;
  let adsMarkedInactive = 0;

  for (const row of activeRows) {
    if (seen.has(String(row.external_ad_id || ""))) continue;
    const missingSuccessiveChecks = Math.min(99, Number(row.missing_successive_checks || 0) + 1);
    const patch = {
      missing_successive_checks: missingSuccessiveChecks,
      last_checked_at: checkedAt,
      ...(missingSuccessiveChecks >= 2
        ? {
            active_status: "inactive",
            ad_delivery_stopped_at: row.ad_delivery_stopped_at || checkedAt,
          }
        : {}),
    };
    await rest("research", `observed_ads?id=eq.${row.id}`, {
      method: "PATCH",
      body: json(patch),
    });
    missingAdsUpdated += 1;
    if (missingSuccessiveChecks >= 2) adsMarkedInactive += 1;
  }

  return {
    activeAdsChecked: activeRows.length,
    missingAdsUpdated,
    adsMarkedInactive,
  };
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
      try {
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
      } catch (error) {
        if (!isMediaAssetUniqueConflict(error)) throw error;
        const raced = await rest("research", `media_assets?select=id&ad_creative_id=eq.${creativeId}&source_url=eq.${encode(source.source_url)}&limit=1`);
        if (!raced?.[0]?.id) throw error;
        await patchMediaAsset(raced[0].id, { kind: source.kind, capture_status: "pending", last_error: null });
      }
    }
    count += 1;
  }
  return count;
}

function isMediaAssetUniqueConflict(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /23505|409|duplicate key value|media_assets_creative_(?:source|storage)_idx/iu.test(message);
}

async function patchMediaAsset(id, patch) {
  try {
    return await rest("research", `media_assets?id=eq.${id}`, {
      method: "PATCH",
      body: json(patch),
    });
  } catch (error) {
    if (!/last_error|content_type|checksum|captured_at|42703|column .* does not exist/i.test(error.message)) throw error;
    const {
      last_error: _lastError,
      content_type: contentType,
      checksum,
      content_hash: _contentHash,
      captured_at: _capturedAt,
      ...withoutUnsupportedColumns
    } = patch;
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

async function upsertExplicitAreaMatchForObservedAd({ observedAdId, postcode, suburb, state, matchType, confidence, evidence }) {
  if (!observedAdId || !postcode || !suburb) return 0;
  const safeMatchType = matchType === "landing_url" ? "landing_url" : "copy_mention";
  try {
    const existing = await rest("research", `ad_area_matches?select=id&observed_ad_id=eq.${observedAdId}&postcode=eq.${encode(postcode)}&suburb=eq.${encode(suburb)}&match_type=eq.${safeMatchType}&limit=1`);
    if (existing?.[0]?.id) return 0;
    await rest("research", "ad_area_matches", {
      method: "POST",
      body: json({
        observed_ad_id: observedAdId,
        postcode,
        suburb,
        state: state || "WA",
        match_type: safeMatchType,
        confidence: Math.max(60, Math.min(100, Number(confidence || 92))),
        evidence: evidence || {},
      }),
    });
    return 1;
  } catch (error) {
    if (missingSchemaRelation(error, "ad_area_matches")) {
      throw new Error(`research.ad_area_matches is unavailable through REST; explicit area attribution cannot be written: ${error.message}`);
    }
    throw error;
  }
}

async function upsertAreaMatchesForObservedAd({ advertiserPageId, observedAdId }) {
  const pages = await rest("research", `advertiser_pages?select=agency_id,agent_id&id=eq.${advertiserPageId}&limit=1`);
  const page = pages?.[0];
  if (!page) return 0;
  const rows = [];
  try {
    if (page.agency_id) {
      const agencyRows = await rest("research", `agent_service_areas?select=postcode,suburb,state,confidence&agency_id=eq.${page.agency_id}&agent_id=is.null&limit=1000`);
      rows.push(...agencyRows.map((row) => ({ ...row, matchType: "agency_service_area" })));
    }
    if (page.agent_id) {
      const agentRows = await rest("research", `agent_service_areas?select=postcode,suburb,state,confidence&agent_id=eq.${page.agent_id}&limit=1000`);
      rows.push(...agentRows.map((row) => ({ ...row, matchType: "agent_service_area" })));
    }
  } catch (error) {
    if (missingSchemaRelation(error, "agent_service_areas")) {
      throw new Error(`research.agent_service_areas is unavailable through REST; page area attribution cannot be written: ${error.message}`);
    }
    throw error;
  }
  let count = 0;
  const seen = new Set();
  for (const row of rows) {
    const matchType = row.matchType;
    const key = `${row.postcode}:${row.suburb}:${matchType}`;
    if (seen.has(key)) continue;
    seen.add(key);
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
      if (missingSchemaRelation(error, "ad_area_matches")) {
        throw new Error(`research.ad_area_matches is unavailable through REST; page area attribution cannot be written: ${error.message}`);
      }
      throw error;
    }
    count += 1;
  }
  return count;
}

function includesNormalisedPhrase(text, phrase) {
  return Boolean(text && phrase && ` ${text} `.includes(` ${phrase} `));
}

function locationAdSearchText(ad) {
  const snapshot = ad.snapshot || {};
  const cardText = objectArray(snapshot.cards).flatMap((card) => [
    firstString(pick(card, "title", "headline")),
    firstString(pick(card, "body", "text")),
    firstString(pick(card, "caption")),
    firstString(pick(card, "linkUrl", "link_url", "url")),
  ]);
  return [
    ad.pageName,
    snapshot.title,
    snapshot.body,
    snapshot.caption,
    snapshot.ctaText,
    snapshot.linkUrl,
    ...cardText,
  ].filter(Boolean).join(" ");
}

function locationAdMatchForInput(ad, input) {
  const text = normalizeName(locationAdSearchText(ad));
  const landing = normalizeName(firstString(ad.snapshot?.linkUrl) || "");
  const suburb = input.suburb ? normalizeName(input.suburb) : "";
  const query = normalizeName(input.query);
  const postcode = input.postcode && /^\d{4}$/u.test(input.postcode) ? input.postcode : "";

  if (suburb && includesNormalisedPhrase(text, suburb)) {
    return { postcode: input.postcode, suburb: input.suburb, matchType: includesNormalisedPhrase(landing, suburb) ? "landing_url" : "copy_mention", reason: "suburb_copy_mention", confidence: 96 };
  }
  if (postcode && includesNormalisedPhrase(text, postcode)) {
    return { postcode, suburb: input.suburb || `Postcode ${postcode}`, matchType: includesNormalisedPhrase(landing, postcode) ? "landing_url" : "copy_mention", reason: "postcode_copy_mention", confidence: 90 };
  }
  if (query && !/^\d{4}$/u.test(query) && includesNormalisedPhrase(text, query)) {
    return { postcode: input.postcode, suburb: input.suburb || titleCase(input.query), matchType: includesNormalisedPhrase(landing, query) ? "landing_url" : "copy_mention", reason: "query_copy_mention", confidence: 88 };
  }
  return null;
}

function hasRealEstateAdSignalForLocation(ad) {
  const text = normalizeName(locationAdSearchText(ad));
  const pageName = normalizeName(firstString(ad.pageName, pick(ad.rawHostedProvider || {}, "pageName", "page_name")));
  return hasStrongRealEstateAdSignal(text) || hasConservativeRealEstatePageNameSignal(pageName);
}

function hasStrongRealEstateAdSignal(text) {
  if (/\b(real estate|realty|property management|property manager|rental appraisal|property appraisal|market appraisal|home appraisal|home open|open home|just listed|just sold|recently sold|leased|for lease|buyers agent|buyer agent|house and land)\b/iu.test(text)) {
    return true;
  }
  if (/\b(homesite|home site|land release|new land release|display village|residential estate)\b/iu.test(text)) {
    return true;
  }
  if (/\bestate\b(?:\s+\w+){0,10}\s+\b(now selling|stage|land release|new land|build your new home|homesite|home site)\b|\b(now selling|stage|land release|new land|build your new home|homesite|home site)\b(?:\s+\w+){0,10}\s+\bestate\b/iu.test(text)) {
    return true;
  }

  const propertyType = "(?:home|house|apartment|unit|villa|townhouse|land|block|property)";
  const marketAction = "(?:for sale|sold|leased|auction|appraisal|price guide)";
  const near = "(?:\\s+\\w+){0,8}\\s+";
  return new RegExp(`\\b${propertyType}\\b${near}\\b${marketAction}\\b|\\b${marketAction}\\b${near}\\b${propertyType}\\b`, "iu").test(text);
}

function hasConservativeRealEstatePageNameSignal(pageName) {
  if (!pageName) return false;
  if (/\b(ray white|harcourts|lj hooker|belle property|acton belle|realmark|reiwa|re\/max|remax|first national|century 21|elders real estate|professionals)\b/iu.test(pageName)) {
    return true;
  }
  if (/\b(real estate|realty|property|properties|buyers agency|buyers agent|property group|home group|homes|land estate|lifestyle resorts)\b/iu.test(pageName)) {
    return true;
  }
  return /\brealestate\.com\.au\b/iu.test(pageName);
}

function pageUrlFromMetaAd(ad) {
  const raw = ad.rawHostedProvider || {};
  const snapshot = ad.snapshot || {};
  return firstString(
    pick(raw, "pageUrl", "page_url"),
    pick(snapshot, "page_profile_uri", "pageProfileUri", "page_url"),
    ad.pageID ? `https://www.facebook.com/${ad.pageID}` : null,
  );
}

async function upsertLocationSearchAdvertiserPage(ad, input, match, sourceDocumentId) {
  const pageId = String(ad.pageID || "").trim();
  if (!pageId || pageId === "null") return null;
  const pageName = firstString(ad.pageName, `${input.query} advertiser`);
  const pageUrl = pageUrlFromMetaAd(ad);
  const advertiserPageId = await upsertAdvertiserPage({
    agentId: null,
    agencyId: null,
    decisionId: null,
    pageId,
    pageSlug: null,
    pageName,
    pageUrl,
    status: "resolved_collectable",
    confidence: match.confidence,
    evidenceUrls: [pageUrl, metaAdLibraryLocationSearchUrl(input)].filter(Boolean),
    metadata: {
      source: LOCATION_AD_SEARCH_JOB_TYPE,
      postcode: input.postcode,
      suburb: input.suburb,
      state: input.state,
      query: input.query,
      location_match: match.reason,
      ad_archive_id: ad.adArchiveID,
    },
  });
  if (!advertiserPageId) return null;

  await rest("research", "real_estate_verifications", {
    method: "POST",
    body: json({
      subject_type: "advertiser_page",
      subject_id: advertiserPageId,
      advertiser_page_id: advertiserPageId,
      agent_id: null,
      agency_id: null,
      verification_status: "verified",
      evidence_type: "meta_page",
      evidence_url: metaAdLibraryLocationSearchUrl(input),
      evidence: {
        page_id: pageId,
        page_name: pageName,
        page_url: pageUrl,
        postcode: input.postcode,
        suburb: input.suburb,
        query: input.query,
        location_match: match.reason,
        ad_archive_id: ad.adArchiveID,
      },
      source_document_id: sourceDocumentId || null,
      verified_by: LOCATION_AD_SEARCH_JOB_TYPE,
      verified_at: now(),
      confidence: match.confidence,
      notes: "Verified from a public Meta Ad Library suburb/postcode search with exact visible location and real-estate signals.",
    }),
  });
  return advertiserPageId;
}

async function handleLocationAdSearch(job) {
  const payload = job.payload || {};
  const input = locationSearchInput(payload);
  if (!payload.location_search_allowed || !input.query || !input.postcode || input.realEstateGate?.verified !== true) {
    return { status: "blocked", blocked_reason: "location_ad_search_missing_verified_location_gate", result: { handler: LOCATION_AD_SEARCH_JOB_TYPE, collection_started: false } };
  }

  const buildRunId = await resolveBuildRunId(payload.build_run_id, payload.buildRunId);
  const adFetchRunId = await insertLocationSearchFetchRun(job, buildRunId, input);
  const outcome = await runHermesLocationSearchCapture(input, job);
  if (outcome.status !== "SUCCEEDED") {
    await updateFetchRun(adFetchRunId, { status: "failed", result_summary: { provider: META_LOCATION_SEARCH_SOURCE_PROVIDER, metadata: outcome.metadata || {} }, error: outcome.errorMessage || "location search capture failed", cost_usd: outcome.costUsd || 0 });
    await insertCoverageDefect({
      platform: "facebook",
      postcode: input.postcode,
      suburb: input.suburb,
      state: input.state,
      reason: "location_ad_search_capture_failed",
      notes: "Hermes location ad search could not fetch Meta Ad Library results for a public suburb/postcode scan.",
      reported_by: "system",
      reporter_identity: workerId,
      status: "open",
      resolution: { provider: META_LOCATION_SEARCH_SOURCE_PROVIDER, query: input.query, error: outcome.errorMessage },
    });
    throw new Error(outcome.errorMessage || "Meta location search failed");
  }

  const ingested = [];
  let filteredNonLocation = 0;
  let filteredNonRealEstate = 0;
  for (const ad of outcome.items) {
    const match = locationAdMatchForInput(ad, input);
    if (!match) {
      filteredNonLocation += 1;
      continue;
    }
    if (!hasRealEstateAdSignalForLocation(ad)) {
      filteredNonRealEstate += 1;
      continue;
    }
    const advertiserPageId = await upsertLocationSearchAdvertiserPage(ad, input, match, outcome.metadata?.sourceDocumentId || null);
    if (!advertiserPageId) continue;
    const item = await ingestMetaAd({
      ad,
      advertiserPageId,
      adFetchRunId,
      buildRunId,
      sourceProvider: META_LOCATION_SEARCH_SOURCE_PROVIDER,
      parentJob: job,
      explicitAreaMatch: {
        postcode: match.postcode,
        suburb: match.suburb,
        state: input.state,
        matchType: match.matchType,
        confidence: match.confidence,
        evidence: {
          source: LOCATION_AD_SEARCH_JOB_TYPE,
          query: input.query,
          reason: match.reason,
          ad_archive_id: ad.adArchiveID,
        },
      },
    });
    ingested.push(item);
    await enqueuePostIngestJobs(item, advertiserPageId, buildRunId, job);
  }

  await updateFetchRun(adFetchRunId, {
    status: "success",
    result_summary: {
      provider: META_LOCATION_SEARCH_SOURCE_PROVIDER,
      item_count: outcome.itemCount,
      ingested_count: ingested.length,
      filtered_non_location: filteredNonLocation,
      filtered_non_real_estate: filteredNonRealEstate,
      confirmed_absence: outcome.metadata?.confirmed_absence === true,
      count_only: outcome.metadata?.count_only === true,
      metadata: outcome.metadata || {},
    },
    cost_usd: outcome.costUsd || 0,
  });
  await resolveCoverageDefects({
    subject_type: "coverage_area",
    subject_key: `${input.state}:${input.postcode}`,
    reason: "location_ad_search_capture_failed",
    resolution: { handler: LOCATION_AD_SEARCH_JOB_TYPE, provider: META_LOCATION_SEARCH_SOURCE_PROVIDER, ingested_count: ingested.length },
  });

  return {
    status: "complete",
    result: {
      handler: LOCATION_AD_SEARCH_JOB_TYPE,
      provider: META_LOCATION_SEARCH_SOURCE_PROVIDER,
      query: input.query,
      postcode: input.postcode,
      suburb: input.suburb,
      ads_seen: outcome.itemCount,
      ingested_count: ingested.length,
      filtered_non_location: filteredNonLocation,
      filtered_non_real_estate: filteredNonRealEstate,
    },
  };
}

// Paid-spend circuit guard. With the Apify capture path dropped
// (supabase/migrations/20260721110000_drop_apify_capture.sql) every live
// provider reports costUsd = 0, so this is a no-op in practice; it records a
// defect only if a paid provider ever reports spend that produced no ingest.
async function openCircuitIfPaidSpendWithoutIngest({ sourceProvider, input, costUsd = 0, ingestedCount = 0, reason = "unknown", scope = "capture" }) {
  const spend = Number(costUsd) || 0;
  if (spend <= 0 || ingestedCount > 0) return { opened: false };
  log("paid capture spend without ingest", { source_provider: sourceProvider, cost_usd: spend, reason, scope, meta_page_id: input?.metaPageId || null }, "warn");
  await insertCoverageDefect({
    platform: "facebook",
    reason: "paid_spend_without_ingest",
    notes: `Paid capture provider ${sourceProvider} reported $${spend.toFixed(4)} spend with zero ads ingested (${scope}: ${reason}).`,
    reported_by: "system",
    reporter_identity: workerId,
    status: "open",
    resolution: {
      advertiser_page_id: input?.advertiserPageId || null,
      meta_page_id: input?.metaPageId || null,
      source_provider: sourceProvider,
      cost_usd: spend,
      reason,
      scope,
    },
    resolved_advertiser_page_id: input?.advertiserPageId || null,
  });
  return { opened: true };
}

async function handleAdCollector(job) {
  const payload = job.payload || {};
  if (!payload.advertiserPageId || !payload.metaPageId || payload.realEstateGate?.verified !== true) {
    return { status: "blocked", blocked_reason: "collector_missing_verified_page_gate", result: { handler: "blockwise-ad-collector", collection_started: false } };
  }
  const ingestTables = ["ad_fetch_runs", "observed_ads", "ad_snapshots", "ad_creatives", "media_assets"];
  const input = captureInput(payload);
  const buildRunId = await resolveBuildRunId(payload.build_run_id, payload.buildRunId);
  const initialSourceProvider = metaOfficialApiEnabled ? META_OFFICIAL_SOURCE_PROVIDER : configuredMetaFallbackSourceProvider();
  const adFetchRunId = await insertFetchRun(job, buildRunId, input, initialSourceProvider);
  const capture = await runMetaPageCapture(input);
  const { outcome, sourceProvider, captureMode: capture_mode } = capture;
  if (outcome.status === "SKIPPED") {
    await updateFetchRun(adFetchRunId, {
      source_provider: sourceProvider,
      status: "failed",
      result_summary: {
        provider: sourceProvider,
        skipped: true,
        skip_reason: outcome.metadata?.skip_reason || "capture_skipped",
        metadata: outcome.metadata || {},
      },
      error: outcome.errorMessage || "capture skipped",
      cost_usd: 0,
    });
    await markAdvertiserPageCheckFailed(payload.advertiserPageId);
    return {
      status: "complete",
      result: {
        handler: "blockwise-ad-collector",
        advertiser_page_id: payload.advertiserPageId,
        meta_page_id: payload.metaPageId,
        provider: sourceProvider,
        capture_mode,
        collection_skipped: true,
        skip_reason: outcome.metadata?.skip_reason || "capture_skipped",
        ingest_tables: ingestTables,
      },
    };
  }
  if (outcome.status !== "SUCCEEDED") {
    await updateFetchRun(adFetchRunId, { source_provider: sourceProvider, status: "failed", result_summary: { provider: sourceProvider, metadata: outcome.metadata || {} }, error: outcome.errorMessage || "capture failed", cost_usd: outcome.costUsd || 0 });
    await markAdvertiserPageCheckFailed(payload.advertiserPageId);
    await insertCoverageDefect({
      platform: "facebook",
      reason: "ad_collector_capture_failed",
      notes: "Hermes ad collector could not fetch a verified Meta page.",
      reported_by: "system",
      reporter_identity: workerId,
      status: "open",
      resolution: { advertiser_page_id: payload.advertiserPageId, meta_page_id: payload.metaPageId, provider: sourceProvider, error: outcome.errorMessage },
      resolved_advertiser_page_id: payload.advertiserPageId,
    });
    throw new Error(outcome.errorMessage || "Meta capture failed");
  }
  const checkedAt = now();
  if (outcome.itemCount === 0 && outcome.metadata?.confirmed_absence) {
    const zeroCaptureTrusted = await isTrustedConfirmedZeroAdCapture({
      advertiserPageId: payload.advertiserPageId,
      sourceProvider,
    });
    if (!zeroCaptureTrusted) {
      await updateFetchRun(adFetchRunId, {
        source_provider: sourceProvider,
        status: "failed",
        result_summary: {
          provider: sourceProvider,
          item_count: 0,
          confirmed_absence: true,
          confirmed_absence_ignored: true,
          metadata: outcome.metadata || {},
          reason: "untrusted_zero_after_prior_observations",
        },
        error: "confirmed zero-ad capture ignored after prior observed ads",
        cost_usd: outcome.costUsd || 0,
      });
      await markAdvertiserPageCheckFailed(payload.advertiserPageId);
      await insertCoverageDefect({
        platform: "facebook",
        reason: "ad_collector_untrusted_zero_after_positive",
        notes: "Collector received a confirmed zero-ad result from a fallback provider for a page that already has observed ads. Ads and page status were left unchanged pending a reliable recapture.",
        reported_by: "system",
        reporter_identity: workerId,
        status: "open",
        resolution: {
          advertiser_page_id: payload.advertiserPageId,
          meta_page_id: payload.metaPageId,
          provider: sourceProvider,
          metadata: outcome.metadata || {},
        },
        resolved_advertiser_page_id: payload.advertiserPageId,
      });
      await openCircuitIfPaidSpendWithoutIngest({ sourceProvider, input, costUsd: outcome.costUsd || 0, ingestedCount: 0, reason: "untrusted_zero_after_prior_observations", scope: "page_capture_untrusted_zero" });
      return {
        status: "complete",
        result: {
          handler: "blockwise-ad-collector",
          advertiser_page_id: payload.advertiserPageId,
          meta_page_id: payload.metaPageId,
          provider: sourceProvider,
          ads_seen: 0,
          confirmed_absence: true,
          confirmed_absence_ignored: true,
          ingest_tables: ingestTables,
        },
      };
    }
    const reconciliation = await reconcileMissingObservedAds({
      advertiserPageId: payload.advertiserPageId,
      seenExternalAdIds: [],
      checkedAt,
    });
    await updateFetchRun(adFetchRunId, { source_provider: sourceProvider, status: "success", result_summary: { provider: sourceProvider, item_count: 0, confirmed_absence: true, metadata: outcome.metadata || {}, reconciliation }, cost_usd: outcome.costUsd || 0 });
    await openCircuitIfPaidSpendWithoutIngest({ sourceProvider, input, costUsd: outcome.costUsd || 0, ingestedCount: 0, reason: "confirmed_absence", scope: "page_capture_confirmed_absence" });
    await rest("research", `advertiser_pages?id=eq.${payload.advertiserPageId}`, {
      method: "PATCH",
      body: json({ status: "no_ads_confirmed", last_checked_at: checkedAt, last_successful_check_at: checkedAt, consecutive_failed_checks: 0 }),
    });
    await resolveCoverageDefects({
      subject_type: "advertiser_page",
      subject_key: payload.advertiserPageId,
      reason: "ad_collector_capture_failed",
      resolution: { handler: "blockwise-ad-collector", provider: sourceProvider, confirmed_absence: true },
    });
    return { status: "complete", result: { handler: "blockwise-ad-collector", advertiser_page_id: payload.advertiserPageId, meta_page_id: payload.metaPageId, provider: sourceProvider, ads_seen: 0, confirmed_absence: true, reconciliation, ingest_tables: ingestTables } };
  }
  const ingested = [];
  try {
    for (const ad of outcome.items) {
      const item = await ingestMetaAd({ ad, advertiserPageId: payload.advertiserPageId, adFetchRunId, buildRunId, sourceProvider, parentJob: job });
      ingested.push(item);
      await enqueuePostIngestJobs(item, payload.advertiserPageId, buildRunId, job);
    }
  } catch (error) {
    await updateFetchRun(adFetchRunId, {
      source_provider: sourceProvider,
      status: "partial",
      result_summary: {
        provider: sourceProvider,
        item_count: outcome.itemCount,
        ingested_count: ingested.length,
        raw_dataset_id: outcome.rawDatasetId,
        metadata: outcome.metadata || {},
        ingest_error: error.message,
      },
      error: `ingest failed after capture: ${error.message}`,
      cost_usd: outcome.costUsd || 0,
    });
    await openCircuitIfPaidSpendWithoutIngest({ sourceProvider, input, costUsd: outcome.costUsd || 0, ingestedCount: ingested.length, reason: error.message, scope: "page_ingest_failure" });
    throw error;
  }
  const reconciliation = await reconcileMissingObservedAds({
    advertiserPageId: payload.advertiserPageId,
    seenExternalAdIds: ingested.map((item) => item.external_ad_id),
    checkedAt,
  });
  await updateFetchRun(adFetchRunId, { source_provider: sourceProvider, status: "success", result_summary: { provider: sourceProvider, item_count: outcome.itemCount, ingested_count: ingested.length, raw_dataset_id: outcome.rawDatasetId, metadata: outcome.metadata || {}, reconciliation }, cost_usd: outcome.costUsd || 0 });
  await openCircuitIfPaidSpendWithoutIngest({ sourceProvider, input, costUsd: outcome.costUsd || 0, ingestedCount: ingested.length, reason: "zero_ingested_after_successful_capture", scope: "page_capture_success" });
  const captureTruncated = outcome.metadata?.truncated || (sourceProvider !== META_OFFICIAL_SOURCE_PROVIDER && outcome.itemCount >= input.resultsLimit);
  await resolveCoverageDefects({
    subject_type: "advertiser_page",
    subject_key: payload.advertiserPageId,
    reason: "ad_collector_capture_failed",
    resolution: { handler: "blockwise-ad-collector", provider: sourceProvider, ingested_count: ingested.length },
  });
  if (!captureTruncated) {
    await resolveCoverageDefects({
      subject_type: "advertiser_page",
      subject_key: payload.advertiserPageId,
      reason: "ad_collector_truncated",
      resolution: { handler: "blockwise-ad-collector", provider: sourceProvider, ingested_count: ingested.length },
    });
  }
  if (captureTruncated) {
    log("Meta capture may be truncated", {
      advertiser_page_id: payload.advertiserPageId,
      meta_page_id: payload.metaPageId,
      item_count: outcome.itemCount,
      results_limit: input.resultsLimit,
      provider: sourceProvider,
      max_pages_per_capture: outcome.metadata?.max_pages_per_capture || null,
    }, "warn");
    await insertCoverageDefect({
      platform: "facebook",
      reason: "ad_collector_truncated",
      notes: sourceProvider === META_OFFICIAL_SOURCE_PROVIDER
        ? `Official Meta Ads Archive capture for page ${payload.metaPageId} still had more pages after ${outcome.metadata?.max_pages_per_capture || "the configured"} page limit.`
        : `Ad collector hit resultsLimit (${input.resultsLimit}) for page ${payload.metaPageId}; there may be more ads. Consider paginated collection.`,
      reported_by: "system",
      reporter_identity: workerId,
      status: "open",
      resolution: {
        advertiser_page_id: payload.advertiserPageId,
        meta_page_id: payload.metaPageId,
        item_count: outcome.itemCount,
        results_limit: input.resultsLimit,
        provider: sourceProvider,
        max_pages_per_capture: outcome.metadata?.max_pages_per_capture || null,
      },
      resolved_advertiser_page_id: payload.advertiserPageId,
    });
  }
  await rest("research", `advertiser_pages?id=eq.${payload.advertiserPageId}`, {
    method: "PATCH",
    body: json({ status: "resolved_collectable", last_checked_at: checkedAt, last_successful_check_at: checkedAt, consecutive_failed_checks: 0 }),
  });
  return { status: "complete", result: { handler: "blockwise-ad-collector", advertiser_page_id: payload.advertiserPageId, meta_page_id: payload.metaPageId, provider: sourceProvider, capture_mode, ads_seen: outcome.itemCount, ingested_count: ingested.length, reconciliation, ingest_tables: ingestTables } };
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
  let deduped = 0;
  let refreshed = 0;
  let qualityBlocked = 0;
  const buildRunId = await resolveBuildRunId(payload.build_run_id, payload.buildRunId);
  for (const asset of assets) {
    try {
      const stored = await captureMediaAsset(asset, buildRunId);
      if (stored.rejected) {
        await patchMediaAsset(asset.id, {
          storage_bucket: null,
          storage_path: null,
          content_type: stored.contentType,
          byte_size: stored.byteSize,
          width: stored.width,
          height: stored.height,
          capture_status: "blocked",
          captured_at: now(),
          last_error: `Media quality rejected: ${stored.rejectionReason}`,
          metadata: {
            ...(asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {}),
            media_quality_rejection: stored.rejectionReason,
          },
        });
        qualityBlocked += 1;
        continue;
      }
      const existingStoredAsset = await findCapturedMediaAssetByStorage({
        creativeId: payload.adCreativeId,
        storagePath: stored.storagePath,
        excludeId: asset.id,
      });
      if (existingStoredAsset) {
        await patchMediaAsset(asset.id, {
          storage_bucket: null,
          storage_path: null,
          content_type: stored.contentType,
          byte_size: stored.byteSize,
          width: stored.width,
          height: stored.height,
          checksum: stored.checksum,
          content_hash: stored.contentHash,
          capture_status: "blocked",
          captured_at: now(),
          last_error: `Deduped to media asset ${existingStoredAsset.id}`,
          metadata: {
            ...(asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {}),
            deduped_to_media_asset_id: existingStoredAsset.id,
            deduped_storage_path: stored.storagePath,
          },
        });
        deduped += 1;
        continue;
      }
      await patchMediaAsset(asset.id, {
        storage_bucket: mediaBucket,
        storage_path: stored.storagePath,
        content_type: stored.contentType,
        byte_size: stored.byteSize,
        width: stored.width,
        height: stored.height,
        checksum: stored.checksum,
        content_hash: stored.contentHash,
        capture_status: "captured",
        captured_at: now(),
        last_error: null,
      });
      captured += 1;
      if (stored.deduped) deduped += 1;
    } catch (error) {
      if (isDeadMediaSourceError(error)) {
        const freshUrl = await freshMediaUrlForAsset(asset).catch(() => null);
        if (freshUrl) {
          await patchMediaAsset(asset.id, {
            source_url: freshUrl,
            capture_status: "pending",
            last_error: `URL refreshed from saved ad payload after: ${error.message}`,
          });
          refreshed += 1;
          continue;
        }
      }
      await patchMediaAsset(asset.id, { capture_status: "failed", last_error: error.message });
      failed += 1;
    }
  }
  await refreshCreativeStoredMedia(payload.adCreativeId);
  await enqueueFollowUp({
    queue_name: "research",
    job_type: "blockwise-ad-classifier",
    dedupe_key: `classifier:${payload.adCreativeId}:media:${CLASSIFIER_VERSION}:${Date.now()}`,
    advertiser_page_id: job.advertiser_page_id || null,
    priority: 5,
    payload: { adCreativeId: payload.adCreativeId, observedAdId: payload.observedAdId, build_run_id: buildRunId, classifier_version: CLASSIFIER_VERSION },
    status: "pending",
    max_attempts: 3,
  }, job);
  return { status: "complete", result: { handler: "blockwise-media-collector", ad_creative_id: payload.adCreativeId, seeded, captured, deduped, refreshed, quality_blocked: qualityBlocked, failed } };
}

async function findCapturedMediaAssetByStorage({ creativeId, storagePath, excludeId }) {
  if (!creativeId || !storagePath) return null;
  const rows = await rest(
    "research",
    `media_assets?select=id&ad_creative_id=eq.${encode(creativeId)}&storage_bucket=eq.${encode(mediaBucket)}&storage_path=eq.${encode(storagePath)}&capture_status=eq.captured&id=neq.${encode(excludeId)}&limit=1`,
  );
  return rows?.[0] || null;
}

async function loadCreativeForMediaCapture(adCreativeId) {
  const rows = await rest("research", `ad_creatives?select=id,observed_ad_id,ad_snapshot_id,primary_image_url,image_urls,video_url,video_thumbnail_url&id=eq.${adCreativeId}&limit=1`);
  return rows?.[0] || null;
}

function isDeadMediaSourceError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /\bmedia fetch failed 4\d\d\b|\b(?:403|404|410)\b/iu.test(message);
}

async function freshMediaUrlForAsset(asset) {
  const creativeRows = await rest("research", `ad_creatives?select=observed_ad_id&id=eq.${encode(asset.ad_creative_id)}&limit=1`);
  const observedAdId = creativeRows?.[0]?.observed_ad_id;
  if (!observedAdId) return null;

  const adRows = await rest("research", `observed_ads?select=raw_payload&id=eq.${encode(observedAdId)}&limit=1`);
  const raw = adRows?.[0]?.raw_payload;
  if (!raw) return null;

  const normalised = normaliseHostedMetaAd(raw, raw.pageID || raw.pageId || raw.page_id || "");
  const creative = creativeFromMetaAd(normalised);
  const wantedKind = String(asset.kind || "").toLowerCase();
  const candidates = creative.mediaSources
    .filter((source) => String(source.kind || "").toLowerCase() === wantedKind)
    .map((source) => source.source_url)
    .filter((url) => url && url !== asset.source_url);

  return candidates[0] || null;
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
  if (!creative) return { status: "complete", result: { handler: "blockwise-ad-classifier", ad_creative_id: payload.adCreativeId, stale_creative_skipped: true } };
  const capturedAssets = await rest("research", `media_assets?select=id,kind,storage_path,source_url,capture_status,byte_size,width,height&ad_creative_id=eq.${creative.id}&capture_status=eq.captured&limit=20`);
  if (shouldWaitForMediaClassification(creative, capturedAssets)) {
    throw new Error("classifier_waiting_for_media_capture");
  }
  const classificationResult = await classifyCreativeWithModels(creative, capturedAssets, {
    env,
    fetchImpl: fetch,
    storagePublicUrlForPath,
  });
  const classification = classificationResult.classification;
  const requiresMedia = ["image", "video", "carousel"].includes(creative.format);
  const mediaReady = !requiresMedia || hasUsableCapturedMedia(capturedAssets);
  const unresolvedDynamicPlaceholder = hasUnresolvedDynamicPlaceholder(creative);
  const displayState = shouldDisplayClassifiedCreative(creative, capturedAssets, classification) ? "displayable" : "hidden";
  const decisionRows = await rest("research", "agent_decisions", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: json({
      decision_type: "ad_classification",
      subject_type: "ad_creative",
      subject_id: creative.id,
      decision: classification,
      rationale:
        classification.rationale ||
        classification.rejection_reason ||
        "Model-backed Hermes classification for verified real-estate page creative.",
      confidence: Math.round((classification.confidence || 0) * 100),
      evidence: {
        headline: creative.headline,
        body: creative.body,
        cta: creative.cta,
        landing_url: creative.landing_url,
        media_ready: mediaReady,
        unresolved_dynamic_placeholder: unresolvedDynamicPlaceholder,
        evidence_source: classificationResult.evidenceSource,
        classifier_version: CLASSIFIER_VERSION,
        media_assets: capturedAssets.map((asset) => ({ id: asset.id, kind: asset.kind, storage_path: asset.storage_path, byte_size: asset.byte_size })),
      },
      hermes_session_id: workerId,
      hermes_skill: "blockwise-ad-classifier",
      model: classificationResult.model,
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
  return {
    status: "complete",
    result: {
      handler: "blockwise-ad-classifier",
      ad_creative_id: creative.id,
      display_state: displayState,
      media_ready: mediaReady,
      unresolved_dynamic_placeholder: unresolvedDynamicPlaceholder,
      is_real_estate_ad: classification.is_real_estate_ad,
      ad_type: classification.ad_type,
      primary_intent: classification.primary_intent,
      evidence_source: classificationResult.evidenceSource,
      classifier_version: CLASSIFIER_VERSION,
    },
  };
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
    const imageDimensions = asset.kind === "image" ? readImageDimensions(buffer, contentType) : null;
    const imageQuality = asset.kind === "image"
      ? assessCapturedImageQuality({ byteSize: buffer.length, ...imageDimensions })
      : { displayable: true, reason: null };
    if (!imageQuality.displayable) {
      return {
        rejected: true,
        rejectionReason: imageQuality.reason,
        contentType,
        byteSize: buffer.length,
        width: imageDimensions?.width ?? null,
        height: imageDimensions?.height ?? null,
      };
    }
    const checksum = hash(buffer);
    const existingBlob = await findMediaBlob(checksum);
    if (existingBlob) {
      await touchMediaBlob(checksum);
      return {
        storagePath: existingBlob.storage_path,
        contentType: existingBlob.content_type || contentType,
        byteSize: existingBlob.byte_size || buffer.length,
        width: imageDimensions?.width ?? null,
        height: imageDimensions?.height ?? null,
        checksum,
        contentHash: checksum,
        deduped: true,
      };
    }
    const storagePath = `media-blobs/${checksum}${extensionForContentType(contentType, asset.kind)}`;
    await uploadStorageObject(mediaBucket, storagePath, buffer, contentType);
    await insertMediaBlob({
      contentHash: checksum,
      storagePath,
      contentType,
      byteSize: buffer.length,
      asset,
      buildRunId,
    });
    return {
      storagePath,
      contentType,
      byteSize: buffer.length,
      width: imageDimensions?.width ?? null,
      height: imageDimensions?.height ?? null,
      checksum,
      contentHash: checksum,
      deduped: false,
      rejected: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function findMediaBlob(contentHash) {
  try {
    const rows = await rest("research", `media_blobs?select=content_hash,storage_bucket,storage_path,content_type,byte_size&content_hash=eq.${encode(contentHash)}&limit=1`);
    return rows?.[0] || null;
  } catch (error) {
    if (missingSchemaRelation(error, "media_blobs")) return null;
    throw error;
  }
}

async function touchMediaBlob(contentHash) {
  try {
    await rest("research", `media_blobs?content_hash=eq.${encode(contentHash)}`, {
      method: "PATCH",
      body: json({
        last_seen_at: now(),
      }),
    });
  } catch (error) {
    if (!missingSchemaRelation(error, "media_blobs")) throw error;
  }
}

async function insertMediaBlob({ contentHash, storagePath, contentType, byteSize, asset, buildRunId }) {
  try {
    await rest("research", "media_blobs?on_conflict=content_hash", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: json({
        content_hash: contentHash,
        storage_bucket: mediaBucket,
        storage_path: storagePath,
        content_type: contentType,
        byte_size: byteSize,
        first_captured_at: now(),
        last_seen_at: now(),
        metadata: {
          first_media_asset_id: asset.id,
          first_ad_creative_id: asset.ad_creative_id,
          first_observed_ad_id: asset.observed_ad_id,
          source_url: asset.source_url,
          build_run_id: buildRunId,
        },
      }),
    });
  } catch (error) {
    if (!missingSchemaRelation(error, "media_blobs")) throw error;
  }
}

let mediaBucketEnsured = false;
let rawEvidenceBucketEnsured = false;

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

async function ensureRawEvidenceBucket() {
  if (rawEvidenceBucketEnsured) return;
  await mkdir(rawEvidenceDir, { recursive: true });
  rawEvidenceBucketEnsured = true;
}

async function safeWriteBrowserRawEvidence(kind, input, evidence) {
  try {
    return await writeBrowserRawEvidence(kind, input, evidence);
  } catch (error) {
    return { error: error.message };
  }
}

async function writeBrowserRawEvidence(kind, input, evidence) {
  await ensureRawEvidenceBucket();
  const rawTarget = input.metaPageId
    || [input.state, input.postcode, input.query ? hash(String(input.query)).slice(0, 12) : null]
      .filter(Boolean)
      .join("-")
    || "unknown-target";
  const safePathSegment = (value) => String(value).replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^\.+/u, "").slice(0, 160) || "unknown";
  const target = safePathSegment(rawTarget);
  const objectPath = [
    "browser",
    safePathSegment(kind),
    target,
    `${Date.now()}-${hash(json({ kind, input, evidence })).slice(0, 16)}.json`,
  ].join("/");
  const destination = join(rawEvidenceDir, ...objectPath.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(json({ kind, input, evidence }), "utf8"), { mode: 0o600 });
  return { bucket: RAW_EVIDENCE_BUCKET, objectPath };
}

async function uploadStorageObject(bucket, objectPath, buffer, contentType) {
  const encodedObjectPath = objectPath.split("/").map(encode).join("/");
  const response = await fetch(`${customerSupabaseUrl}/storage/v1/object/${encode(bucket)}/${encodedObjectPath}`, {
    method: "POST",
    headers: hermesSupabaseHeaders(customerSupabaseCredential, {
      "Content-Type": contentType,
      "x-upsert": "true",
    }),
    body: buffer,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`storage upload failed ${response.status}: ${text.slice(0, 500)}`);
}

function storagePublicUrlForPath(objectPath) {
  if (!objectPath) return null;
  return `${customerSupabaseUrl}/storage/v1/object/public/${encode(mediaBucket)}/${String(objectPath).split("/").map(encode).join("/")}`;
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
        width: asset.width,
        height: asset.height,
        captureStatus: asset.capture_status,
        capturedAt: asset.captured_at,
      })),
    }),
  });
}

function coverageAuditSuburb(postcode, state, fallback) {
  const indexed = postcodeSuburbIndex.get(`${state || "WA"}:${postcode}`)?.[0];
  return titleCase(fallback || indexed || `Postcode ${postcode}`);
}

function coverageStatusForSnapshot(snapshot) {
  if (snapshot.adsKnown > 0) return "covered";
  if (snapshot.agentsKnown > 0 || snapshot.advertiserPages > 0) return "watch";
  return "needs_work";
}

function coverageScoreForSnapshot(snapshot) {
  if (snapshot.adsKnown > 0) return Math.min(100, 70 + Math.min(snapshot.adsKnown, 30));
  if (snapshot.agentsKnown > 0 || snapshot.advertiserPages > 0) return 45;
  return 5;
}

async function loadCoverageSnapshot(postcode, state) {
  const rows = await rest(
    "research",
    `v_coverage_status?select=postcode,state,live_active_ads,live_advertiser_pages,live_agents,live_agencies,health&postcode=eq.${encode(postcode)}&state=eq.${encode(state)}&limit=1`,
  );
  const row = rows?.[0];
  if (row) {
    return {
      postcode,
      state,
      adsKnown: Number(row.live_active_ads || 0),
      advertiserPages: Number(row.live_advertiser_pages || 0),
      agentsKnown: Number(row.live_agents || 0),
      agenciesKnown: Number(row.live_agencies || 0),
      health: row.health || null,
      source: "v_coverage_status",
    };
  }

  const [agencies, cards] = await Promise.all([
    rest("research", `agencies?select=id&primary_postcode=eq.${encode(postcode)}&state=eq.${encode(state)}&is_real_estate=eq.true&limit=1000`),
    rest("research", `v_customer_meta_ad_library_cards?select=card_id,page_id&postcode=eq.${encode(postcode)}&state=eq.${encode(state)}&limit=1000`),
  ]);

  return {
    postcode,
    state,
    adsKnown: new Set(cards.map((card) => card.card_id).filter(Boolean)).size,
    advertiserPages: new Set(cards.map((card) => card.page_id).filter(Boolean)).size,
    agentsKnown: 0,
    agenciesKnown: agencies.length,
    health: null,
    source: "direct_fallback",
  };
}

async function requestCoverageRefresh({ postcode, state, reason, parentJob, operatorDecisionId = null }) {
  if (!postcode || !state) return false;
  const sourceBacked = hasCensusSourceForPolicy({ postcode, state });
  const nextRefreshAt = sourceBacked ? now() : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const notes = sourceBacked
    ? `Hermes requested immediate refresh: ${reason}`
    : `Hermes could not queue immediate refresh: no enabled census source for ${state}.`;
  await rest("research", "refresh_policies?on_conflict=postcode,state", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: json({
      postcode,
      state,
      priority: state === "WA" ? 3 : 4,
      refresh_cadence_minutes: 1440,
      next_refresh_at: nextRefreshAt,
      active: true,
      notes,
    }),
  });
  await rest("research", `refresh_policies?postcode=eq.${encode(postcode)}&state=eq.${encode(state)}`, {
    method: "PATCH",
    body: json({
      next_refresh_at: nextRefreshAt,
      notes,
    }),
  });

  if (!sourceBacked) return false;

  return enqueueFollowUp({
    queue_name: "research",
    job_type: "blockwise-agent-census",
    dedupe_key: `census:${state}:${postcode}`,
    priority: Math.min(8, censusQueuePriority),
    payload: {
      postcode,
      state,
      verified_roster_first: true,
      location_search_allowed: false,
      legacy_discovery_allowed: false,
      trigger: reason,
      operator_decision_id: operatorDecisionId,
    },
    status: "pending",
    max_attempts: 3,
  }, parentJob);
}

async function insertCoverageGapDefect({ postcode, state, suburb, snapshot, job }) {
  const notes = snapshot.adsKnown > 0
    ? `Hermes coverage audit found ads for ${postcode}, but status still needs review.`
    : snapshot.agentsKnown > 0 || snapshot.advertiserPages > 0
      ? `Hermes coverage audit found verified real-estate coverage for ${postcode}, but no displayable ads yet.`
      : `Hermes coverage audit found no verified real-estate agencies or displayable ads for ${postcode}.`;

  await insertCoverageDefect({
    postcode,
    suburb,
    state,
    reason: "coverage_audit_gap",
    notes,
    reported_by: "auditor",
    reporter_identity: workerId,
    status: "open",
    resolution: {
      source: COVERAGE_AUDITOR_JOB_TYPE,
      work_queue_id: job.id,
      snapshot,
    },
  });
  return true;
}

async function handleCoverageAuditor(job) {
  const payload = job.payload || {};
  const postcode = String(payload.postcode || "").trim();
  const state = String(payload.state || "WA").toUpperCase();
  if (!/^\d{4}$/u.test(postcode)) {
    return { status: "blocked", blocked_reason: "coverage_auditor_missing_postcode", result: { handler: COVERAGE_AUDITOR_JOB_TYPE } };
  }

  const suburb = coverageAuditSuburb(postcode, state, payload.suburb);
  const snapshot = await loadCoverageSnapshot(postcode, state);
  const auditStatus = coverageStatusForSnapshot(snapshot);
  const score = coverageScoreForSnapshot(snapshot);

  const created = await rest("research", "coverage_audits", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: json({
      postcode,
      suburb,
      state,
      audit_method: "provider_cross_check",
      status: auditStatus,
      score,
      agents_known: snapshot.agentsKnown + snapshot.agenciesKnown,
      agents_estimated: Math.max(snapshot.agentsKnown + snapshot.agenciesKnown, snapshot.advertiserPages),
      ads_known: snapshot.adsKnown,
      ads_sampled_external: 0,
      sample_evidence: {
        source: COVERAGE_AUDITOR_JOB_TYPE,
        work_queue_id: job.id,
        snapshot,
      },
    }),
  });

  if (auditStatus === "covered") {
    await resolveCoverageDefects({
      subject_type: "coverage_area",
      subject_key: `${state}:${postcode}`,
      reason: "coverage_audit_gap",
      resolution: { handler: COVERAGE_AUDITOR_JOB_TYPE, audit_status: auditStatus, snapshot },
    });
  }
  const defectInserted = auditStatus === "covered" ? false : await insertCoverageGapDefect({ postcode, state, suburb, snapshot, job });
  const refreshQueued = auditStatus === "covered"
    ? false
    : await requestCoverageRefresh({ postcode, state, reason: "coverage_audit_gap", parentJob: job });

  return {
    status: "complete",
    result: {
      handler: COVERAGE_AUDITOR_JOB_TYPE,
      postcode,
      state,
      audit_id: created?.[0]?.id || null,
      audit_status: auditStatus,
      score,
      ads_known: snapshot.adsKnown,
      agents_known: snapshot.agentsKnown,
      agencies_known: snapshot.agenciesKnown,
      defect_inserted: defectInserted,
      refresh_queued: refreshQueued,
    },
  };
}

function appendInvestigationNote(notes, line) {
  const current = String(notes || "").trim();
  if (!current) return line;
  if (current.includes(line)) return current;
  return `${current}\n${line}`;
}

async function handleDefectInvestigator(job) {
  const payload = job.payload || {};
  const defectId = String(payload.coverageDefectId || payload.coverage_defect_id || payload.defect_id || "").trim();
  if (!uuidOrNull(defectId)) {
    return { status: "blocked", blocked_reason: "defect_investigator_missing_defect_id", result: { handler: DEFECT_INVESTIGATOR_JOB_TYPE } };
  }

  const rows = await rest("research", `coverage_defects?select=*&id=eq.${encode(defectId)}&limit=1`);
  const defect = rows?.[0];
  if (!defect) {
    return { status: "blocked", blocked_reason: "coverage_defect_not_found", result: { handler: DEFECT_INVESTIGATOR_JOB_TYPE, defect_id: defectId } };
  }
  if (defect.status === "resolved" || defect.status === "dismissed") {
    return { status: "complete", result: { handler: DEFECT_INVESTIGATOR_JOB_TYPE, defect_id: defectId, already_terminal: true, status: defect.status } };
  }

  const postcode = typeof defect.postcode === "string" && /^\d{4}$/u.test(defect.postcode) ? defect.postcode : null;
  const state = String(defect.state || "WA").toUpperCase();
  const checkedAt = now();
  const operatorDecisionId = uuidOrNull(payload.operatorDecisionId || payload.operator_decision_id);

  if (!postcode) {
    await rest("research", `coverage_defects?id=eq.${encode(defectId)}`, {
      method: "PATCH",
      body: json({
        status: "investigating",
        notes: appendInvestigationNote(defect.notes, `Hermes investigator checked at ${checkedAt}: no postcode was attached, needs human review.`),
        resolution: { ...(defect.resolution || {}), last_investigated_at: checkedAt, outcome: "missing_postcode" },
        ...(operatorDecisionId ? { resolution_decision_id: operatorDecisionId } : {}),
      }),
    });
    return { status: "complete", result: { handler: DEFECT_INVESTIGATOR_JOB_TYPE, defect_id: defectId, outcome: "needs_human_review" } };
  }

  const snapshot = await loadCoverageSnapshot(postcode, state);
  if (snapshot.adsKnown > 0) {
    await rest("research", `coverage_defects?id=eq.${encode(defectId)}`, {
      method: "PATCH",
      body: json({
        status: "resolved",
        resolved_at: checkedAt,
        notes: appendInvestigationNote(defect.notes, `Hermes investigator resolved at ${checkedAt}: ${snapshot.adsKnown} displayable ad(s) now visible for ${postcode}.`),
        resolution: { ...(defect.resolution || {}), last_investigated_at: checkedAt, outcome: "coverage_restored", snapshot },
        ...(operatorDecisionId ? { resolution_decision_id: operatorDecisionId } : {}),
      }),
    });
    return { status: "complete", result: { handler: DEFECT_INVESTIGATOR_JOB_TYPE, defect_id: defectId, outcome: "resolved", ads_known: snapshot.adsKnown } };
  }

  const refreshQueued = await requestCoverageRefresh({
    postcode,
    state,
    reason: "defect_investigation",
    parentJob: job,
    operatorDecisionId,
  });
  await rest("research", `coverage_defects?id=eq.${encode(defectId)}`, {
    method: "PATCH",
    body: json({
      status: "investigating",
      notes: appendInvestigationNote(
        defect.notes,
        refreshQueued
          ? `Hermes investigator checked at ${checkedAt}: no displayable ads yet; queued postcode refresh.`
          : `Hermes investigator checked at ${checkedAt}: no displayable ads yet; no enabled census source is available for ${state}.`,
      ),
      resolution: { ...(defect.resolution || {}), last_investigated_at: checkedAt, outcome: refreshQueued ? "refresh_queued" : "missing_census_source", refresh_queued: refreshQueued, snapshot },
      ...(operatorDecisionId ? { resolution_decision_id: operatorDecisionId } : {}),
    }),
  });

  return {
    status: "complete",
    result: {
      handler: DEFECT_INVESTIGATOR_JOB_TYPE,
      defect_id: defectId,
      outcome: refreshQueued ? "refresh_queued" : "missing_census_source",
      postcode,
      state,
      refresh_queued: refreshQueued,
      ads_known: snapshot.adsKnown,
    },
  };
}

async function handleJob(job) {
  if (job.job_type === "blockwise-agent-census") return handleAgentCensus(job);
  if (job.job_type === "blockwise-page-resolver") return handlePageResolver(job);
  if (job.job_type === "blockwise-ad-collector") return handleAdCollector(job);
  if (job.job_type === "blockwise-media-collector") return handleMediaCollector(job);
  if (job.job_type === "blockwise-ad-classifier") return handleAdClassifier(job);
  if (job.job_type === COVERAGE_AUDITOR_JOB_TYPE) return handleCoverageAuditor(job);
  if (job.job_type === DEFECT_INVESTIGATOR_JOB_TYPE) return handleDefectInvestigator(job);
  if (job.job_type === CONTENT_RUN_JOB_TYPE) {
    return handleHermesContentRun(job, {
      rest,
      now,
      env,
      fetchImpl: fetch,
      workerId,
      log,
    });
  }
  return { status: "blocked", blocked_reason: `unsupported_job_type:${job.job_type}`, result: { handler: "none", reason: "Hermes runtime does not handle this job type." } };
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

async function deferMetaBrowserChallengeJob(job) {
  const cooldownMs = metaBrowserChallengeResumeDelayMs(job);
  const previousAttempts = Math.max(0, Number(job.attempts || 0) - 1);
  await finishJob(job, "pending", {
    attempts: previousAttempts,
    available_at: new Date(Date.now() + cooldownMs).toISOString(),
    last_error: job.last_error,
    blocked_reason: null,
    result: {
      handler: "meta-browser-challenge-cooldown",
      cooldown_ms: cooldownMs,
      resume_spread_ms: META_BROWSER_CHALLENGE_RESUME_SPREAD_MS,
      previous_attempts: previousAttempts,
      worker_id: workerId,
    },
  }, "update");
  log("deferred Meta capture job during browser challenge cooldown", {
    jobId: job.id,
    jobType: job.job_type,
    cooldownMs,
    attempts: previousAttempts,
  }, "warning");
}

function metaBrowserChallengeResumeDelayMs(job) {
  const cooldownMs = Math.max(60_000, metaBrowserChallengeCooldownRemaining());
  const spreadSeed = parseInt(hash(`${job?.id || ""}:${job?.job_type || ""}`).slice(0, 8), 16);
  const spreadMs = Number.isFinite(spreadSeed) ? spreadSeed % META_BROWSER_CHALLENGE_RESUME_SPREAD_MS : 0;
  return cooldownMs + spreadMs;
}

async function processOneJob(job) {
  const started = Date.now();
  try {
    if (shouldDeferMetaBrowserChallengeJob(job)) {
      await deferMetaBrowserChallengeJob(job);
      return;
    }
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

async function claimContentFastLaneJobs({ jobTypes, limit }) {
  try {
    const claimed = await rpc("claim_work_queue_jobs", {
      p_worker_id: workerId,
      p_queue_name: "research",
      p_job_types: jobTypes,
      p_limit: limit,
      p_claim_ttl_seconds: claimTtlSeconds,
    });
    for (const job of claimed) await recordEvent("claim", "work_queue", job.id, { job_type: job.job_type, workerId }, { work_queue_id: job.id });
    return claimed;
  } catch (error) {
    if (!/claim_work_queue_jobs|PGRST202|404/i.test(error.message)) throw error;
    return [];
  }
}

async function tick() {
  let buildRunId = null;
  let supervisor = { policySeedCandidates: 0, policySeeded: 0, duePolicies: 0, enqueued: 0, recycledCensus: 0, deferredCensus: 0, adRefreshCandidates: 0, adRefreshEnqueued: 0, locationSearchCandidates: 0, locationSearchEnqueued: 0 };
  let watchdogs = {};
  let priorityContentHandled = 0;
  let customerReadModels = { skipped: true, reason: "not_due" };
  let accuracyAudit = { skipped: true, reason: "not_due" };
  let inactiveAdPurge = { skipped: true, reason: "not_due" };
  try {
    const fastLaneJobs = await claimContentFastLaneJobs({ jobTypes: [CONTENT_RUN_JOB_TYPE], limit: 1 });
    await Promise.all(fastLaneJobs.map(processOneJob));
    priorityContentHandled = fastLaneJobs.length;
  } catch (error) {
    log("priority content worker pass failed; continuing to supervisor", { error: error.message }, "error");
  }
  try {
    buildRunId = await ensureBuildRun();
    const policySeed = await ensureSourceBackedRefreshPolicies();
    const census = await enqueueDueCensusJobs(buildRunId);
    await refreshMetaBrowserChallengeCooldownFromSettings();
    const adRefresh = await enqueueDueAdPageRefreshJobs(buildRunId);
    const locationSearch = await enqueueDueLocationAdSearchJobs(buildRunId);
    supervisor = { ...policySeed, ...census, ...adRefresh, ...locationSearch };
  } catch (error) {
    log("supervisor phase failed; continuing to queue worker", { error: error.message }, "error");
  }
  const handled = await processClaimedJobs();
  try {
    watchdogs = await runWatchdogs();
  } catch (error) {
    log("watchdog phase failed after worker pass", { error: error.message }, "error");
  }
  try {
    customerReadModels = await maybePublishCustomerReadModels();
  } catch (error) {
    customerReadModels = { skipped: false, error: error.message };
    log("customer read model publish failed", { error: error.message }, "error");
  }
  try {
    accuracyAudit = await maybeRunAccuracyAudit();
  } catch (error) {
    accuracyAudit = { skipped: false, error: error.message };
    log("Ad Radar accuracy audit failed", { error: error.message }, "error");
  }
  try {
    inactiveAdPurge = await maybeRunInactiveAdPurge();
  } catch (error) {
    inactiveAdPurge = { skipped: false, error: error.message };
    log("inactive-ad purge failed", { error: error.message }, "error");
  }
  log("tick complete", { mode, workerId, buildRunId, priorityContentHandled, ...supervisor, handled, watchdogs, customerReadModels, accuracyAudit, inactiveAdPurge });
}

let lastCustomerReadModelPublishAt = 0;
let lastAccuracyAuditCheckAt = 0;
let lastInactiveAdPurgeCheckAt = 0;

async function maybePublishCustomerReadModels() {
  const current = Date.now();
  if (current - lastCustomerReadModelPublishAt < customerReadModelPublishIntervalMs) {
    return { skipped: true, reason: "not_due" };
  }
  const result = await publishCustomerReadModels({ researchRest: rest, env, fetchImpl: fetch, now });
  lastCustomerReadModelPublishAt = Date.now();
  return result;
}

async function maybeRunAccuracyAudit() {
  const current = Date.now();
  if (current - lastAccuracyAuditCheckAt < accuracyAuditCheckIntervalMs) {
    return { skipped: true, reason: "not_due" };
  }
  lastAccuracyAuditCheckAt = current;
  return runAdRadarAccuracyAudit({
    researchRest: rest,
    env,
    fetchImpl: fetch,
    now,
    intervalHours: accuracyAuditIntervalHours,
  });
}

async function maybeRunInactiveAdPurge() {
  const current = Date.now();
  if (current - lastInactiveAdPurgeCheckAt < inactiveAdPurgeCheckIntervalMs) {
    return { skipped: true, reason: "not_due" };
  }
  lastInactiveAdPurgeCheckAt = current;
  return runInactiveAdPurge({
    researchRest: rest,
    intervalHours: inactiveAdPurgeIntervalHours,
  });
}

async function main() {
  log("starting", { mode, workerId, intervalMs, targetPostcodes: targetPostcodeLog, targetStates, sourceBackedStates: enabledCensusSourceStates, claimLimit, maxJobsPerTick, censusSourceTemplates: sourceTemplates.length, postcodeSuburbs: postcodeSuburbIndex.size, censusQueuePriority, censusPolicyAutoSeedEnabled, censusPolicySeedBatchSize, censusRecycleBlockedEnabled, adPageRefreshEnabled, adPageRefreshIntervalMinutes, adPageRefreshBatchSize, adPageRefreshMaxActive });
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
