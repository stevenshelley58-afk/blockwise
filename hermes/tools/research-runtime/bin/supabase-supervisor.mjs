#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CLASSIFIER_VERSION,
  assessCapturedImageQuality,
  classifyCreativeWithModels,
  classifyCreativeFromSavedEvidence,
  hasUnresolvedDynamicPlaceholder,
  hasUsableCapturedMedia,
  readImageDimensions,
  shouldDisplayClassifiedCreative,
  shouldReclassifyCreative,
  shouldWaitForMediaClassification,
} from "./ad-classifier.mjs";
import { CONTENT_RUN_JOB_TYPE, handleHermesContentRun } from "./content-engine.mjs";
import { runAdRadarAccuracyAudit } from "./ad-radar-accuracy-audit.mjs";
import { resolveAdRadarRuntime } from "./ad-radar-runtime-gate.mjs";
import { buildMetaPaginationScenario, parseMetaPaginatedCapture } from "./meta-ad-library-pagination.mjs";
import {
  assertBudgetWithinConfiguredCap,
  executeScrapingBeePaidAttempt,
  parseScrapingBeeUsage,
} from "./scrapingbee-paid-attempt.mjs";
import { publishCustomerReadModels } from "./customer-read-model-publisher.mjs";
import { selectDueAdRadarPages, chunkIds } from "./ad-radar-scheduling.mjs";
import { saveCaptureJournal, loadCaptureJournal, reconcileSavedCaptureSettlement, ensureFetchRun } from "./ad-radar-capture-journal.mjs";
import { syncCustomerAdRadarInterests } from "./customer-freshness-sync.mjs";
import { createFacebookSearchEvidence } from "./facebook-discovery-search.mjs";
import { createFacebookPageIdentityEvidence } from "./facebook-page-identity.mjs";
import {
  DIRECTORY_DISCOVERY_JOB_TYPE,
  enqueueAdRadarDirectoryDiscovery,
  handleAdRadarEntityDiscovery,
  handleAdRadarPageDiscovery,
} from "./ad-radar-directory-coverage.mjs";
import {
  laneForJob,
  resolveAdRadarLaneConfigs,
  runLaneBatch,
  startAdRadarLaneLoops,
} from "./ad-radar-lane-scheduler.mjs";
import { runInactiveAdPurge } from "./inactive-ad-purge.mjs";
import {
  assertHermesOwnedStorageUrl,
  hermesSupabaseHeaders,
  resolveHermesResearchStorageCredential,
  resolveHermesSupabaseCredential,
} from "./supabase-credentials.mjs";

const DEFAULT_POSTCODES = ["ALL"];
const COVERAGE_AUDITOR_JOB_TYPE = "blockwise-coverage-auditor";
const DEFECT_INVESTIGATOR_JOB_TYPE = "blockwise-defect-investigator";
const AD_RADAR_JOB_TYPES = [
  "blockwise-agent-census",
  DIRECTORY_DISCOVERY_JOB_TYPE,
  "blockwise-page-resolver",
  "blockwise-ad-collector",
  "blockwise-media-collector",
  "blockwise-ad-classifier",
  COVERAGE_AUDITOR_JOB_TYPE,
  DEFECT_INVESTIGATOR_JOB_TYPE,
];
const env = process.env;
const narrowAdDbMode = ["--ad-db-worker", "--job-id", "--historical-replay"].some((flag) => process.argv.includes(flag));
const { adRadarEnabled, handledJobTypes: HANDLED_JOB_TYPES } = resolveAdRadarRuntime(
  env,
  CONTENT_RUN_JOB_TYPE,
  AD_RADAR_JOB_TYPES,
);
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
const customerSupabaseUrl = narrowAdDbMode ? supabaseUrl : required("HERMES_CUSTOMER_SUPABASE_URL", env.SUPABASE_URL).replace(/\/+$/u, "");
if (/\.supabase\.(?:co|com)$/iu.test(new URL(customerSupabaseUrl).hostname) || /^(?:supabase\.(?:co|com))$/iu.test(new URL(customerSupabaseUrl).hostname)) {
  throw new Error("HERMES_CUSTOMER_SUPABASE_URL must point at the self-hosted product edge");
}
const researchStorageUrl = narrowAdDbMode ? null : assertHermesOwnedStorageUrl(required("HERMES_RESEARCH_STORAGE_URL"));
const researchStorageCredential = narrowAdDbMode ? null : resolveHermesResearchStorageCredential(env);
if (!narrowAdDbMode && !researchStorageCredential) {
  throw new Error(
    "Missing HERMES_RESEARCH_STORAGE_SECRET_KEY or HERMES_RESEARCH_STORAGE_SERVICE_ROLE_KEY",
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
const adPageRefreshIntervalMinutes = positiveInt("HERMES_AD_PAGE_REFRESH_INTERVAL_MINUTES", 1440);
const adPageRefreshBatchSize = positiveInt("HERMES_AD_PAGE_REFRESH_BATCH_SIZE", mode === "build" ? 40 : 16);
const adPageRefreshMaxActive = positiveInt("HERMES_AD_PAGE_REFRESH_MAX_ACTIVE", mode === "build" ? 200 : 80);
const adPageRefreshScanLimit = Math.max(adPageRefreshBatchSize * 16, adPageRefreshMaxActive + adPageRefreshBatchSize * 4);
const adPageRefreshMaxConsecutiveFailures = 3;
const adRadarInterestSyncIntervalMs = positiveInt("HERMES_AD_RADAR_INTEREST_SYNC_INTERVAL_SECONDS", 300) * 1000;
// Lifecycle reconciliation (active→inactive flips) is gated on coverage-
// complete runs via research.mark_missing_ads_inactive. Disable only for
// forensic audits.
const adPageRefreshLifecycleEnabled = env.HERMES_AD_PAGE_LIFECYCLE_RECONCILIATION !== "false";
// The narrow Ad Radar worker uses entity discovery → exact Page identity →
// page collection. Postcodes select scope and freshness; they are not discovery roots.
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
const META_SCRAPINGBEE_SOURCE_PROVIDER = "scrapingbee_meta_ad_library";
// ScrapingBee (Ad Radar v2 capture provider). Auto-Mode picks the cheapest
// working configuration; Spb-* response headers carry the actual credit cost.
const scrapingBeeApiKey = env.SCRAPINGBEE_API_KEY || env.HERMES_SCRAPINGBEE_API_KEY || "";
const scrapingBeeEnabled = env.HERMES_SCRAPINGBEE_ENABLED === "true" && Boolean(scrapingBeeApiKey.trim());
const scrapingBeeOrder = String(env.HERMES_SCRAPINGBEE_ORDER || "fallback").toLowerCase(); // primary|fallback
const scrapingBeeMaxCostPerCapture = Math.min(positiveInt("HERMES_SCRAPINGBEE_MAX_CREDITS_PER_CAPTURE", 25), 100);
const scrapingBeeMonthlyCreditCap = positiveInt("HERMES_SCRAPINGBEE_MONTHLY_CREDIT_CAP", 200_000);
const scrapingBeeTimeoutMs = positiveInt("HERMES_SCRAPINGBEE_TIMEOUT_MS", 120_000);
// Auto-Mode chooses proxy/rendering tiers but does not wait for page-specific
// asynchronous results. Meta Ad Library needs a short post-render settle time.
const scrapingBeeWaitMs = Math.min(positiveInt("HERMES_SCRAPINGBEE_WAIT_MS", 5_000), 35_000);
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

function adRefreshPriorityForPage(page, { customerInterested = false } = {}) {
  if (customerInterested) return 1;
  if (page.scan_state === "needs_first_fill") return 2;
  return page.status === "resolved_collectable" ? 4 : 8;
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
  const response = await fetch(`${researchStorageUrl}/storage/v1/${path}`, {
    ...init,
    headers: hermesSupabaseHeaders(researchStorageCredential, {
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
  const blockingCollectors = activeCollectors.filter((job) => Number(job.priority || 99) <= 4);
  if (blockingCollectors.length >= adPageRefreshMaxActive) {
    return { adRefreshCandidates: 0, adRefreshEnqueued: 0, adRefreshSkippedActive: blockingCollectors.length, adRefreshBacklog: activeCollectors.length };
  }
  const activePageIds = new Set(activeCollectors.map((job) => job.advertiser_page_id).filter(Boolean));
  // Ad Radar v2 scheduling: read durable scan state straight off the page
  // registry. Cadence and backoff live in next_scan_at/backoff_until
  // never-scanned page is immediately due (first-fill queue). Postcode
  // refresh policies are no longer a scheduler input.
  const pages = await rest(
    "research",
    `advertiser_pages?select=id,page_id,page_name,status,scan_state,next_scan_at,backoff_until,consecutive_failures,has_ever_run_ads,initial_fill_completed_at,last_scan_completed_at,agent_id,agency_id&scan_enabled=eq.true&status=neq.rejected_non_real_estate&page_id=not.is.null&order=next_scan_at.asc&limit=10000`,
  );
  const customerInterestScope = await loadAdRadarCustomerInterestScope(pages);
  // Keep the identity gap visible without allowing metadata-only pages to
  // consume paid captures. WA completion reports this count separately.
  const unmappedIdentityPages = await rest(
    "research",
    "advertiser_pages?select=id,page_id,status&scan_enabled=eq.true&status=neq.rejected_non_real_estate&agent_id=is.null&agency_id=is.null&page_id=not.is.null&limit=10000",
  );
  const capacity = Math.max(0, Math.min(adPageRefreshMaxActive - blockingCollectors.length, adPageRefreshBatchSize));
  if (capacity === 0) return { adRefreshEnqueued: 0 };
  const candidates = selectDueAdRadarPages(pages, customerInterestScope, new Date(), capacity, activePageIds);
  let enqueued = 0;
  for (const [index, page] of candidates.entries()) {
    const scanMode = page.scan_state === "needs_first_fill" ? "initial_fill" : "refresh";
    const queued = await enqueueFollowUp({
      queue_name: "research",
      job_type: "blockwise-ad-collector",
      dedupe_key: `ad-radar:collector:${page.id}:${page.next_scan_at || "first-fill"}`,
      advertiser_page_id: page.id,
      priority: adRefreshPriorityForPage(page, { customerInterested: customerInterestScope.isInterested(page) }),
      payload: {
        advertiserPageId: page.id,
        metaPageId: String(page.page_id),
        build_run_id: buildRunId,
        scanMode,
        country: "AU",
        activeStatus: "active",
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
  return { adRefreshCandidates: candidates.length, adRefreshEnqueued: enqueued, adRefreshActive: blockingCollectors.length, adRefreshBacklog: activeCollectors.length, adRefreshScanned: pages.length, adRefreshCustomerInterests: customerInterestScope.count, adRefreshUnmappedIdentityPages: Array.isArray(unmappedIdentityPages) ? unmappedIdentityPages.length : 0 };
}

async function runWatchdogs() {
  const runHourlyWatchdogs = Date.now() % (60 * 60 * 1000) < intervalMs;
  const [stale, providerFailures, zeroAds, missingMedia, unclassified, staleBlockedArchive, staleAgencyRecheck, unresolvedPageRetry] = await Promise.all([
    rpc("watchdog_requeue_stale_jobs", { p_limit: 100 }),
    rpc("watchdog_record_provider_failures", { p_since: "24 hours", p_failure_threshold: 3 }),
    rpc("watchdog_record_zero_ad_anomalies", { p_since: "48 hours", p_limit: 100 }),
    rpc("watchdog_record_missing_media", { p_since: "24 hours", p_limit: 100 }),
    rpc("watchdog_record_unclassified_creatives", { p_since: "24 hours", p_limit: 100 }),
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

async function loadWaOwnedAdCreativeIds(rows) {
  const observedIds = [...new Set(rows.map((row) => row?.observed_ad_id).filter((id) => uuidPattern.test(String(id || ""))))];
  if (!observedIds.length) return new Set();
  const observed = await rest("research", `observed_ads?select=id,advertiser_page_id&id=in.(${observedIds.map(encode).join(",")})&limit=${observedIds.length}`);
  if (!Array.isArray(observed)) throw new Error("Classification backfill observed-ad response was not an array");
  const pageIds = [...new Set(observed.map((row) => row?.advertiser_page_id).filter((id) => uuidPattern.test(String(id || ""))))];
  if (!pageIds.length) return new Set();
  const pages = await rest("research", `advertiser_pages?select=id,agent_id,agency_id&id=in.(${pageIds.map(encode).join(",")})&limit=${pageIds.length}`);
  if (!Array.isArray(pages)) throw new Error("Classification backfill page response was not an array");
  const agentIds = [...new Set(pages.map((row) => row?.agent_id).filter((id) => uuidPattern.test(String(id || ""))))];
  const agencyIds = [...new Set(pages.map((row) => row?.agency_id).filter((id) => uuidPattern.test(String(id || ""))))];
  const [agents, agencies] = await Promise.all([
    agentIds.length ? rest("research", `agents?select=id,state&id=in.(${agentIds.map(encode).join(",")})&limit=${agentIds.length}`) : [],
    agencyIds.length ? rest("research", `agencies?select=id,state&id=in.(${agencyIds.map(encode).join(",")})&limit=${agencyIds.length}`) : [],
  ]);
  if (!Array.isArray(agents) || !Array.isArray(agencies)) throw new Error("Classification backfill owner response was not an array");
  const waAgents = new Set(agents.filter((row) => String(row?.state || "").toUpperCase() === "WA").map((row) => row.id));
  const waAgencies = new Set(agencies.filter((row) => String(row?.state || "").toUpperCase() === "WA").map((row) => row.id));
  const waPageIds = new Set(pages.filter((row) => waAgents.has(row.agent_id) || waAgencies.has(row.agency_id)).map((row) => row.id));
  const waObservedIds = new Set(observed.filter((row) => waPageIds.has(row.advertiser_page_id)).map((row) => row.id));
  return new Set(rows.filter((row) => waObservedIds.has(row.observed_ad_id)).map((row) => row.id));
}

async function loadClassificationBackfillCandidates() {
  const select = "id,observed_ad_id,creative_hash,classification_status,classification,ad_type,primary_intent,updated_at";
  const sources = [
    `ad_creatives?select=${select}&or=(classified_at.is.null,classification_status.in.(unclassified,failed),classification.eq.%7B%7D)&order=updated_at.asc.nullsfirst`,
    `ad_creatives?select=${select}&classification_status=eq.classified&order=updated_at.asc.nullsfirst`,
    `ad_creatives?select=${select}&or=(ad_type.eq.other,primary_intent.eq.other)&order=updated_at.asc.nullsfirst`,
  ];
  const seen = new Set();
  const candidates = [];
  for (const [sourceIndex, basePath] of sources.entries()) {
    const pageLimit = sourceIndex === 2 ? classificationBackfillWeakBatchSize : classificationBackfillBatchSize;
    for (let offset = 0; ; offset += pageLimit) {
      const rows = await rest("research", basePath + "&limit=" + pageLimit + "&offset=" + offset);
      if (!Array.isArray(rows)) throw new Error("Classification backfill creative response was not an array");
      const waOwned = await loadWaOwnedAdCreativeIds(rows);
      for (const row of rows) {
        if (!row?.id || seen.has(row.id) || !waOwned.has(row.id)) continue;
        seen.add(row.id);
        if (row.classification_status === "classified" &&
          row.classification?.classifier_version === CLASSIFIER_VERSION + ":saved" &&
          row.classification?.creative_hash === row.creative_hash) continue;
        if (!shouldReclassifyCreative(row)) continue;
        candidates.push(row);
        if (candidates.length >= classificationBackfillBatchSize) return candidates;
      }
      if (rows.length < pageLimit) break;
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

// Facebook renders the Ad Library payload with plain quotes inside JSON, but
// variants embedded in JS strings escape the quotes (\"search_results_connection\").
// Accept both, plus optional unicode-escaped whitespace.
const META_SEARCH_CONNECTION_PATTERN = /\\?"search_results_connection\\?"\s*:\s*\{\\?"count\\?"\s*:\s*(\d+)/giu;

function metaSearchHasConfirmedNoAds(html) {
  const text = String(html || "");
  // Absence is confirmed when the search connection reports count 0 with no
  // edges. The marketing "No ads" banner is often absent, so edges decide.
  const match = /\\?"search_results_connection\\?"\s*:\s*\{\\?"count\\?"\s*:\s*0\s*,\\?"edges\\?"\s*:\s*\[\s*\]/iu.exec(text);
  return match !== null;
}

function metaAdLibraryChallengeDetected(html) {
  const text = String(html || "");
  return /\/__rd_verify_[^"'\s<]+/iu.test(text)
    || /\bexecuteChallenge\s*\(/iu.test(text)
    || /\bchallenge=3\b/iu.test(text)
    || /ad_library_is_captcha_required\\?"\s*:\s*true/iu.test(text);
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

function classifierCreativeHash(creative) {
  if (creative?.creative_hash) return String(creative.creative_hash);
  return hash(JSON.stringify({
    headline: creative?.headline || null,
    body: creative?.body || null,
    cta: creative?.cta || null,
    landing_url: creative?.landing_url || null,
    format: creative?.format || null,
  }));
}

async function enqueueClassificationJob(creative, parentJob) {
  const creativeHash = classifierCreativeHash(creative);
  return enqueueFollowUp({
    queue_name: "research",
    job_type: "blockwise-ad-classifier",
    dedupe_key: `ad-radar:classifier:${creative.id}:${creativeHash}:${CLASSIFIER_VERSION}:saved`,
    advertiser_page_id: null,
    priority: 5,
    payload: {
      adCreativeId: creative.id,
      observedAdId: creative.observed_ad_id || null,
      creative_hash: creativeHash,
      classifier_version: CLASSIFIER_VERSION + ":saved",
      classifierMode: "deterministic",
      ad_db_child: true,
    },
    status: "pending",
    max_attempts: 3,
  }, parentJob);
}
async function enqueueFollowUp(input, parentJob) {
  const existing = await rest("research", `work_queue?select=id,status&dedupe_key=eq.${encode(input.dedupe_key)}&limit=1`);
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
  if (existing.length) return false;
  const created = await rest("research", "work_queue", { method: "POST", headers: { Prefer: "return=representation" }, body: json(input) });
  if (created?.[0]?.id) await recordEvent("insert", "work_queue", created[0].id, { parent_work_queue_id: parentJob?.id || null, job_type: input.job_type }, { work_queue_id: created[0].id });
  return Boolean(created?.[0]?.id);
}

async function enqueuePostIngestJobs(item, advertiserPageId, buildRunId, parentJob) {
  if (item.media_sources > 0) {
    await enqueueFollowUp({
      queue_name: "research",
      job_type: "blockwise-media-collector",
      dedupe_key: `ad-radar:media:${item.ad_creative_id}:${item.creative_hash}`,
      advertiser_page_id: advertiserPageId,
      priority: 5,
      payload: { adCreativeId: item.ad_creative_id, observedAdId: item.observed_ad_id, build_run_id: buildRunId, ad_db_child: true },
      status: "pending",
      max_attempts: 3,
    }, parentJob);
  }
  if (!item.creative_hash) return;
  const creativeHash = String(item.creative_hash);
  await enqueueFollowUp({
    queue_name: "research",
    job_type: "blockwise-ad-classifier",
    dedupe_key: `ad-radar:classifier:${item.ad_creative_id}:${creativeHash}:${CLASSIFIER_VERSION}:saved`,
    advertiser_page_id: advertiserPageId,
    priority: 5,
    payload: {
      adCreativeId: item.ad_creative_id,
      observedAdId: item.observed_ad_id,
      build_run_id: buildRunId,
      creative_hash: creativeHash,
      classifier_version: CLASSIFIER_VERSION + ":saved",
      classifierMode: "deterministic",
      ad_db_child: true,
    },
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
    dedupe_key: `ad-radar:collector:${page.advertiserPageId}`,
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
      activeStatus: "active",
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

function captureCreditCap(payload) {
  const values = [payload.runCreditCap, payload.maxCredits]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
  if (!values.length) return scrapingBeeMaxCostPerCapture;
  for (const value of values) assertBudgetWithinConfiguredCap(value, scrapingBeeMaxCostPerCapture);
  return Math.min(...values.map(Number));
}

function captureInput(payload) {
  return {
    advertiserPageId: payload.advertiserPageId,
    metaPageId: String(payload.metaPageId),
    country: String(payload.country || "AU").toUpperCase(),
    activeStatus: ["active", "inactive", "all"].includes(payload.activeStatus) ? payload.activeStatus : "active",
    resultsLimit: Math.max(1, Math.min(Number.parseInt(payload.resultsLimit || ("" + metaCaptureResultsLimit), 10) || metaCaptureResultsLimit, 250)),
    runCreditCap: captureCreditCap(payload),
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
    activeStatus: input.activeStatus || "active",
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

function captureModeForSourceProvider(sourceProvider, suffix = "") {
  const modeName = sourceProvider === META_OFFICIAL_SOURCE_PROVIDER
    ? "official_api"
    : sourceProvider === META_STRUCTURED_SOURCE_PROVIDER
      ? "http_json"
      : sourceProvider === META_SCRAPINGBEE_SOURCE_PROVIDER
        ? "scrapingbee_auto"
        : "browser";
  return suffix ? `${modeName}_${suffix}` : modeName;
}

// --- ScrapingBee capture (Ad Radar v2) -------------------------------------
// One Auto-Mode request per page capture. Never uses ScrapingBee AI
// extraction and never proxies video bytes through ScrapingBee; media bytes
// are still captured by the existing media collector directly from source.

let scrapingBeeUsageCache = { at: 0, value: null };
let scrapingBeeUsageInFlight = null;

async function scrapingBeeBalanceEvidence() {
  if (scrapingBeeUsageCache.value && Date.now() - scrapingBeeUsageCache.at < 65_000) {
    return scrapingBeeUsageCache.value;
  }
  if (scrapingBeeUsageInFlight) return scrapingBeeUsageInFlight;
  scrapingBeeUsageInFlight = (async () => {
  const response = await fetch(`https://app.scrapingbee.com/api/v1/usage?api_key=${encodeURIComponent(scrapingBeeApiKey)}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`scrapingbee usage failed ${response.status}`);
  const usage = await response.json();
  scrapingBeeUsageCache = {
    at: Date.now(),
    value: parseScrapingBeeUsage(usage, now()),
  };
  return scrapingBeeUsageCache.value;
  })();
  try { return await scrapingBeeUsageInFlight; }
  finally { scrapingBeeUsageInFlight = null; }

}

async function assertScrapingBeeBudgetConfiguration() {
  const budgets = await rest("research", "provider_credit_budgets?provider=eq.scrapingbee&select=max_credits&order=period_start.desc&limit=1");
  assertBudgetWithinConfiguredCap(budgets?.[0]?.max_credits, scrapingBeeMonthlyCreditCap);
}

let facebookSearchAdapter = null;
async function searchFacebookEvidence(input) {
  facebookSearchAdapter ||= createFacebookSearchEvidence({
    rest,
    rpc,
    apiKey: scrapingBeeApiKey,
    enabled: scrapingBeeEnabled,
    balanceEvidence: scrapingBeeBalanceEvidence,
    recordAttempt: recordAdFetchAttempt,
    patchAttempt: patchAdFetchAttempt,
    sourceDocument,
    rawEvidenceDir,
    now,
  });
  return facebookSearchAdapter(input);
}

let facebookPageIdentityAdapter = null;
async function resolveFacebookPageEvidence(input) {
  facebookPageIdentityAdapter ||= createFacebookPageIdentityEvidence({
    rest, rpc, apiKey: scrapingBeeApiKey, enabled: scrapingBeeEnabled,
    balanceEvidence: scrapingBeeBalanceEvidence,
    recordAttempt: recordAdFetchAttempt, patchAttempt: patchAdFetchAttempt,
    sourceDocument, rawEvidenceDir, now,
    captureMode: env.HERMES_FACEBOOK_IDENTITY_CAPTURE_MODE || "classic",
    creditCap: Number(env.HERMES_FACEBOOK_IDENTITY_CREDIT_CAP || "1"),
  });
  return facebookPageIdentityAdapter(input);
}

async function recordAdFetchAttempt(attempt) {
  const created = await rest("research", "ad_fetch_attempts", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: json(attempt),
  });
  if (created?.[0]?.provider_credit_attempt_id !== attempt.provider_credit_attempt_id) {
    throw new Error("provider attempt persistence was not confirmed");
  }
}

async function patchAdFetchAttempt(attemptId, body) {
  const updated = await rest("research", `ad_fetch_attempts?provider_credit_attempt_id=eq.${encode(attemptId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: json(body),
  });
  if (updated?.length !== 1) throw new Error("provider attempt update was not confirmed");
}

async function savePaidCaptureEvidence(input, body, receipt) {
  if (typeof body !== "string" || body.length === 0) {
    throw new Error("paid capture returned an empty response body");
  }
  await ensureRawEvidenceBucket();
  const contentHash = hash(body);
  const page = String(input.metaPageId).replace(/[^0-9]/gu, "") || "unknown-page";
  const objectPath = ["meta-ad-library", page, `${contentHash}.html`].join("/");
  const destination = join(rawEvidenceDir, ...objectPath.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  try {
    await writeFile(destination, body, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const stored = await readFile(destination, "utf8");
  if (hash(stored) !== contentHash) throw new Error("raw evidence write verification failed");
  const sourceDocumentId = await sourceDocument(
    "meta_ad_library_page_capture",
    metaAdLibraryPageUrl(input),
    body,
    {
      advertiser_page_id: input.advertiserPageId || null,
      meta_page_id: input.metaPageId,
      provider: META_SCRAPINGBEE_SOURCE_PROVIDER,
      provider_request_id: receipt?.requestId || null,
      captured_at: now(),
    },
  );
  if (!sourceDocumentId) throw new Error("raw evidence source document was not persisted");
  await rest("research", `source_documents?id=eq.${encode(sourceDocumentId)}`, {
    method: "PATCH",
    body: json({ storage_bucket: RAW_EVIDENCE_BUCKET, storage_path: objectPath }),
  });
  return {
    sourceDocumentId,
    bucket: RAW_EVIDENCE_BUCKET,
    objectPath,
    ref: `${RAW_EVIDENCE_BUCKET}/${objectPath}`,
    contentHash,
    byteSize: Buffer.byteLength(stored),
  };
}

async function runScrapingBeePageCapture(input) {
  const startedAt = now();
  const runCreditCap = input.runCreditCap || scrapingBeeMaxCostPerCapture;
  assertBudgetWithinConfiguredCap(runCreditCap, scrapingBeeMaxCostPerCapture);
  if (!scrapingBeeApiKey) {
    return skippedCaptureOutcome(META_SCRAPINGBEE_SOURCE_PROVIDER, input, startedAt, "scrapingbee_api_key_missing");

  }
  if (!uuidPattern.test(String(input.adFetchRunId || ""))) {
    return failedCaptureOutcome(META_SCRAPINGBEE_SOURCE_PROVIDER, input, startedAt, "scrapingbee_missing_durable_fetch_run", {}, 0);
  }

  const savedCapture = await loadCaptureJournal(rawEvidenceDir, input);
  let balance;
  try {
    balance = savedCapture ? { verifiedAt: savedCapture.capturedAt } : await scrapingBeeBalanceEvidence();
  } catch (error) {
    return failedCaptureOutcome(META_SCRAPINGBEE_SOURCE_PROVIDER, input, startedAt,
      `scrapingbee_balance_unverified (${error.message})`, {}, 0);
  }

  const attemptHex = hash(`scrapingbee:${input.adFetchRunId}:1`).slice(0, 32).split("");
  attemptHex[12] = "5";
  attemptHex[16] = ((Number.parseInt(attemptHex[16], 16) & 0x3) | 0x8).toString(16);
  const attemptId = `${attemptHex.slice(0, 8).join("")}-${attemptHex.slice(8, 12).join("")}-${attemptHex.slice(12, 16).join("")}-${attemptHex.slice(16, 20).join("")}-${attemptHex.slice(20).join("")}`;
  const requestStartedAt = Date.now();
  const url = metaAdLibraryPageUrl(input);
  const telemetry = {
    provider_request_count: 0,
    provider_credits: 0,
    provider_cost_usd: 0,
    scrapingbee_tier: "auto_mode",
    scraper_run_id: null,
    request_ids: [],
    url_without_key: url,
    provider_credit_attempt_id: attemptId,
    provider_balance_verified_at: balance.verifiedAt,
    charge_known: false,
  };
  const processResponse = async ({ response, body: html, receipt }) => {
        telemetry.scraper_run_id = receipt.requestId;
        if (receipt.requestId) telemetry.request_ids.push(receipt.requestId);
        const evidence = await savePaidCaptureEvidence(input, html, receipt);
        const evidenceMetadata = {
          raw_evidence_ref: evidence.ref,
          source_document_id: evidence.sourceDocumentId,
          raw_evidence_sha256: evidence.contentHash,
          raw_evidence_bytes: evidence.byteSize,
        };
        await patchAdFetchAttempt(attemptId, { raw_evidence_ref: evidence.ref });
        // Auto Mode may recover an initial 403 at a later tier. Only the
        // final HTTP result and strict payload parsing determine usability.
        // The initial status remains in the receipt for diagnostics/accounting.
        const blocked = !response.ok || response.status === 401 || response.status === 429;
        if (blocked) {
          const message = `scrapingbee request failed ${response.status}`;
          return {
            attempt: { outcome: "blocked", httpStatus: response.status, responseBytes: html.length, error: message },
            result: failedCaptureOutcome(META_SCRAPINGBEE_SOURCE_PROVIDER, input, startedAt, message,
              { ...evidenceMetadata, provider_telemetry: telemetry, http_status: response.status, spb_initial_status_code: receipt.initialStatus }, 0),
          };
        }
        const classified = parseMetaPaginatedCapture(html, input.metaPageId, { country: input.country || "AU", activeStatus: input.activeStatus || "active" });
        if (["challenge", "login_wall", "unparseable"].includes(classified.outcome)) {
          const outcome = classified.outcome === "unparseable" ? "unparseable" : "blocked";
          const message = `scrapingbee_${classified.outcome}`;
          return {
            attempt: { outcome, httpStatus: response.status, responseBytes: html.length, error: message },
            result: failedCaptureOutcome(META_SCRAPINGBEE_SOURCE_PROVIDER, input, startedAt, message,
              { ...evidenceMetadata, provider_telemetry: telemetry, parser_outcome: classified.outcome, html_bytes: html.length }, 0),
          };
        }
        // Partial parser evidence is still valuable. Keep every validated ad
        // ID (including sparse nodes) as an observation, but mark coverage
        // incomplete so lifecycle and zero-ad scheduling remain untouched.
        const parsed = normaliseHostedMetaItems({
          body: classified.ads.map((ad) => ad.node || { ad_archive_id: ad.id, page_id: input.metaPageId }),
          pageId: input.metaPageId,
          limit: Math.max(Number(input.resultsLimit) || 250, classified.ads.length),
        });
        const paginationExhausted = classified.pageInfo.hasNextPage === false;
        const confirmedAbsence = classified.outcome === "confirmed_absence";
        const partialEvidence = classified.outcome === "partial";
        return {
          attempt: { outcome: "success", httpStatus: response.status, responseBytes: html.length, error: null },
          result: {
            runId: `scrapingbee-${input.metaPageId}-${Date.now()}`,
            provider: META_SCRAPINGBEE_SOURCE_PROVIDER,
            status: "SUCCEEDED",
            startedAt,
            finishedAt: now(),
            costUsd: 0,
            itemCount: parsed.items.length,
            items: parsed.items,
            rawDatasetId: null,
            errorMessage: parsed.warnings.join("; ") || null,
            coverageComplete: !partialEvidence && (confirmedAbsence || paginationExhausted),
            paginationExhausted,
            stopReason: confirmedAbsence ? "confirmed_absence" : partialEvidence ? "partial_evidence" : paginationExhausted ? "page_exhausted" : "pagination_unresolved",
            metadata: {
              ...evidenceMetadata,
              advertiserPageId: input.advertiserPageId,
              resolverDecisionId: input.resolverDecisionId,
              confirmed_absence: confirmedAbsence,
              challenge_detected: false,
              connection_count: classified.connectionCount,
              pagination_records: classified.paginationRecords || 0,
              page_info: classified.pageInfo,
              parser_outcome: classified.outcome,
              partial_evidence: partialEvidence,
              warnings: [...new Set([...classified.warnings, ...parsed.warnings])],
              provider_telemetry: telemetry,
            },
          },
        };
  };
  if (savedCapture) {
    const receipt = savedCapture.receipt;
    const handled = await processResponse({
      response: { status: savedCapture.status, ok: savedCapture.status >= 200 && savedCapture.status < 300 },
      body: savedCapture.body, receipt,
    });
    await reconcileSavedCaptureSettlement({
      rest,
      settle: (payload) => rpc("settle_provider_attempt_credits", payload),
      attemptId,
      runId: input.adFetchRunId,
      receipt,
      outcome: handled.attempt.outcome,
    });
    telemetry.provider_request_count = 1;
    telemetry.provider_credits = receipt.chargeKnown ? receipt.credits : runCreditCap;
    telemetry.provider_cost_usd = scrapingBeeCostUsd(telemetry.provider_credits);
    telemetry.charge_known = receipt.chargeKnown;
    handled.result.metadata = { ...handled.result.metadata, replayed_saved_capture: true, provider_telemetry: telemetry };
    handled.result.costUsd = telemetry.provider_cost_usd;
    return handled.result;
  }
  const params = new URLSearchParams({
    api_key: scrapingBeeApiKey,
    url,
    mode: "auto",
    max_cost: String(runCreditCap),
    wait: String(scrapingBeeWaitMs),
    json_response: "true",
    js_scenario: JSON.stringify(buildMetaPaginationScenario()),
  });

  try {
    return await executeScrapingBeePaidAttempt({
      reserve: () => rpc("reserve_provider_attempt_credits", {
        p_attempt_id: attemptId,
        p_provider: "scrapingbee",
        p_run_id: input.adFetchRunId,
        p_reserved_credits: runCreditCap,
        p_run_credit_cap: runCreditCap,
        p_provider_balance_remaining: balance.remaining,
        p_provider_balance_verified_at: balance.verifiedAt,
      }),
      persist: () => recordAdFetchAttempt({
        ad_fetch_run_id: input.adFetchRunId,
        advertiser_page_id: input.advertiserPageId || null,
        provider: META_SCRAPINGBEE_SOURCE_PROVIDER,
        attempt_index: 1,
        idempotency_key: attemptId,
        provider_credit_attempt_id: attemptId,
        tier: "auto_mode",
        request_url_host: "app.scrapingbee.com",
        request_params: { mode: "auto", max_cost: runCreditCap, wait_ms: scrapingBeeWaitMs, json_response: true, pagination: "native_cursor_v1", target_host: new URL(url).host },
        outcome: "error",
        error: "reserved_before_provider_request",
        started_at: new Date(requestStartedAt).toISOString(),
      }),
      request: async () => {
        telemetry.provider_request_count = 1;
        return fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`, {
          signal: AbortSignal.timeout(scrapingBeeTimeoutMs),
        });
      },
      handleResponse: async ({ response, body: html, receipt }) => {
        await saveCaptureJournal(rawEvidenceDir, input, { body: html, receipt, status: response.status });
        return processResponse({ response, body: html, receipt });
      },
      persistReceipt: ({ receipt, response }) => patchAdFetchAttempt(attemptId, {
        http_status: response.status,
        provider_http_status: receipt.initialStatus,
        spb_cost: receipt.spbCost,
        spb_auto_cost: receipt.spbAutoCost,
        spb_request_id: receipt.requestId,
      }),
      complete: async ({ receipt, outcome, httpStatus, responseBytes, error }) => {
        const charged = receipt.chargeKnown ? receipt.credits : scrapingBeeMaxCostPerCapture;
        telemetry.provider_credits = charged;
        telemetry.provider_cost_usd = scrapingBeeCostUsd(charged);
        telemetry.charge_known = receipt.chargeKnown;
        await patchAdFetchAttempt(attemptId, {
          http_status: httpStatus,
          provider_http_status: receipt.initialStatus,
          spb_cost: receipt.spbCost,
          spb_auto_cost: receipt.spbAutoCost,
          spb_request_id: receipt.requestId,
          credits_charged: charged,
          cost_usd: telemetry.provider_cost_usd,
          outcome,
          response_bytes: responseBytes,
          duration_ms: Date.now() - requestStartedAt,
          error,
          completed_at: now(),
        });
      },
      settle: ({ outcome, chargeKnown, actualCredits }) => rpc("settle_provider_attempt_credits", {
        p_attempt_id: attemptId,
        p_outcome: outcome,
        p_charge_known: chargeKnown,
        p_actual_credits: chargeKnown ? actualCredits : null,
      }),
    }).then((result) => {
      result.costUsd = telemetry.provider_cost_usd;
      if (result.metadata?.provider_telemetry) result.metadata.provider_telemetry = telemetry;
      return result;
    });
  } catch (error) {
    // Paid bytes are already safe. A database/ingestion failure retries this
    // same queue job and run from the journal, not a new paid capture.
    if (await loadCaptureJournal(rawEvidenceDir, input)) throw error;
    return failedCaptureOutcome(META_SCRAPINGBEE_SOURCE_PROVIDER, input, startedAt,
      `scrapingbee request error: ${error.message}`, { provider_telemetry: telemetry, error: error.message },
      telemetry.provider_cost_usd);
  }
}


function scrapingBeeCostUsd(credits) {
  // Auto-Mode credit price is account-specific; kept configurable and only
  // used for indicative cost reporting. Credits are the source of truth.
  const creditPriceUsd = Number(env.HERMES_SCRAPINGBEE_CREDIT_PRICE_USD || 0);
  return Number.isFinite(creditPriceUsd) && creditPriceUsd > 0 ? credits * creditPriceUsd : 0;
}

async function runMetaPageCapture(input) {
  const fallbackSourceProvider = configuredMetaFallbackSourceProvider();
  // A page scan makes AT MOST ONE paid ScrapingBee request. A failed primary
  // attempt is never followed by a second paid attempt for the same page.
  let scrapingBeeAttempted = false;

  const tryScrapingBee = async (metadataExtras = {}, preserveFailure = false) => {
    if (!scrapingBeeEnabled || scrapingBeeAttempted) return null;
    scrapingBeeAttempted = true;
    const spb = await runScrapingBeePageCapture(input);
    if (spb.status === "SUCCEEDED") {
      return {
        outcome: { ...spb, metadata: { ...(spb.metadata || {}), ...metadataExtras } },
        sourceProvider: META_SCRAPINGBEE_SOURCE_PROVIDER,
        captureMode: captureModeForSourceProvider(META_SCRAPINGBEE_SOURCE_PROVIDER),
      };
    }
    log("ScrapingBee capture failed", {
      advertiser_page_id: input.advertiserPageId,
      meta_page_id: input.metaPageId,
      error: spb.errorMessage,
    }, "warn");
    return preserveFailure
      ? {
          outcome: { ...spb, metadata: { ...(spb.metadata || {}), ...metadataExtras } },
          sourceProvider: META_SCRAPINGBEE_SOURCE_PROVIDER,
          captureMode: captureModeForSourceProvider(META_SCRAPINGBEE_SOURCE_PROVIDER),
        }
      : null;
  };

  if (scrapingBeeEnabled && scrapingBeeOrder === "primary") {
    // Primary paid collection fails closed. A provider error must not invoke
    // an unrelated browser path or make a second provider request.
    return tryScrapingBee({}, true);
  }

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
    const spb = await tryScrapingBee({ official_api_failed: true, official_api_error: official.errorMessage });
    if (spb) return spb;
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

  const spb = await tryScrapingBee();
  if (spb) return spb;

  const fallback = await runFallbackMetaPageCapture(input, fallbackSourceProvider);
  const sourceProvider = fallback.provider || fallbackSourceProvider;
  return {
    outcome: fallback,
    sourceProvider,
    captureMode: captureModeForSourceProvider(sourceProvider),
  };
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

function softUnescape(text) {
  // One level of JS-string unescaping: \" -> ", \\ -> \. Escaped payload
  // variants (JSON embedded in a JS string) only become parseable after this.
  return String(text).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
}

function extractJsonObjectsAfterKey(text, key) {
  const out = [];
  const seen = new Set();
  // Scan both the raw text and a one-level-unescaped copy. Brace matching and
  // JSON.parse must run over the SAME text the key was found in: escaped
  // variants break string-aware brace matching in raw form.
  for (const source of [String(text), softUnescape(text)]) {
    let cursor = 0;
    while (cursor < source.length) {
      const keyIndex = source.indexOf(key, cursor);
      if (keyIndex === -1) break;
      const colonIndex = source.indexOf(":", keyIndex + key.length);
      const braceIndex = colonIndex === -1 ? -1 : source.indexOf("{", colonIndex + 1);
      if (braceIndex === -1) {
        cursor = keyIndex + key.length;
        continue;
      }
      const endIndex = findJsonObjectEnd(source, braceIndex);
      if (endIndex === -1) {
        cursor = braceIndex + 1;
        continue;
      }
      try {
        const parsed = JSON.parse(source.slice(braceIndex, endIndex + 1));
        const dedupeKey = json(parsed);
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          out.push(parsed);
        }
      } catch {
        // Meta can change embedded payloads without changing the page shell.
      }
      cursor = endIndex + 1;
    }
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
  raw = { ...(asObject(raw?.collation_result?.ad_archive) || {}), ...raw };
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
  const scanMode = ["initial_fill", "refresh", "manual"].includes(payloadString(job.payload?.scanMode))
    ? payloadString(job.payload.scanMode)
    : job.payload?.initialFill === true ? "initial_fill" : "refresh";
  const row = {
    build_run_id: buildRunId,
    work_queue_id: job.id,
    advertiser_page_id: input.advertiserPageId || null,
    scan_mode: scanMode,
    idempotency_key: `ad-collector:${job.id}:${input.advertiserPageId || "unknown"}`,
    source_provider: provider,
    role: "primary",
    trigger: scanMode === "manual" ? "manual" : "scheduled",
    target_kind: "advertiser_page",
    target_value: input.advertiserPageId,
    input_payload: input,
    input_hash: hash(json(input)),
    status: "running",
    result_summary: {},
  };
  return ensureFetchRun(rest, row);
}

function payloadString(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Lift provider telemetry (ScrapingBee Spb-* headers, request counts,
// coverage flags) out of a capture outcome into ad_fetch_runs columns.
function runTelemetryPatch(outcome) {
  const metadata = outcome?.metadata || {};
  const telemetry = metadata.provider_telemetry || {};
  const numericOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  const patch = {};
  if (uuidPattern.test(String(metadata.source_document_id || ""))) patch.source_document_id = metadata.source_document_id;
  if (telemetry.scraper_run_id) patch.scraper_run_id = String(telemetry.scraper_run_id).slice(0, 200);
  const requestCount = numericOrNull(telemetry.provider_request_count);
  if (requestCount !== null) patch.provider_request_count = Math.round(requestCount);
  const credits = numericOrNull(telemetry.provider_credits);
  if (credits !== null) patch.provider_credits = credits;
  const costUsd = numericOrNull(telemetry.provider_cost_usd);
  if (costUsd !== null) patch.provider_cost_usd = costUsd;
  if (telemetry.scrapingbee_tier) patch.scrapingbee_tier = String(telemetry.scrapingbee_tier);
  if (typeof outcome.coverageComplete === "boolean") patch.coverage_complete = outcome.coverageComplete;
  if (typeof outcome.paginationExhausted === "boolean") patch.pagination_exhausted = outcome.paginationExhausted;
  if (outcome.stopReason) patch.stop_reason = String(outcome.stopReason).slice(0, 200);
  if (outcome.items && Array.isArray(outcome.items)) {
    patch.dataset_checksum = hash(json(outcome.items.map((item) => item.adArchiveID || item.id || null)));
  }
  return patch;
}

async function updateFetchRun(id, patch, { schedulePage = true } = {}) {
  const completedAt = now();
  const updated = await rest("research", `ad_fetch_runs?id=eq.${encode(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: json({
      completed_at: completedAt,
      ...patch,
      ...(schedulePage ? {} : { ad_radar_scheduled_at: completedAt }),
    }),
  });
  if (!updated?.[0]?.id) throw new Error("ad fetch run finalization was not confirmed");
  if (schedulePage) await rpc("schedule_ad_radar_after_run", { p_run_id: id });
  return updated[0];
}

async function markAdvertiserPageScanStarted(advertiserPageId) {
  if (!advertiserPageId) return;
  await rest("research", `advertiser_pages?id=eq.${advertiserPageId}`, {
    method: "PATCH",
    body: json({ last_scan_started_at: now(), scan_state: "scanning" }),
  });
}

async function ingestMetaAd({ ad, advertiserPageId, adFetchRunId, buildRunId, sourceProvider, parentJob, explicitAreaMatch = null, historicalObservedAt = null, preserveLifecycle = false }) {
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
  const observationTime = historicalObservedAt || now();
  const observedRow = {
    external_ad_id: ad.adArchiveID,
    advertiser_page_id: advertiserPageId,
    first_seen_provider: sourceProvider,
    platform: normalisePlatformForDb(platforms),
    last_seen_at: observationTime,
    last_checked_at: observationTime,
    missing_successive_checks: 0,
    meta_publisher_platforms: platforms,
    ad_delivery_started_at: metaTimestamp(ad.startDate),
    raw_payload: rawPayload,
    payload_hash: payloadHash,
    metadata: { ad_library_url: ad.inputUrl || "https://www.facebook.com/ads/library/?id=" + ad.adArchiveID, page_id: ad.pageID },
  };
  // Historical replay must not turn old evidence into a current observation or
  // overwrite its lifecycle state. The original observed timestamp and status
  // remain the source of truth; only the canonical parser/upsert is replayed.
  if (!preserveLifecycle) {
    observedRow.active_status = activeStatus;
    observedRow.ad_delivery_stopped_at = deliveryStoppedAtForMetaAd(ad, activeStatus);
  }
  const observed = await rest("research", "observed_ads?on_conflict=advertiser_page_id,external_ad_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: json(observedRow),
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
  const mediaCount = await upsertMediaAssets({
    creativeId: adCreative.id,
    observedAdId: observedAd.id,
    snapshotId: snapshot?.id || null,
    mediaSources: creative.mediaSources,
    preserveCaptureState: preserveLifecycle,
  });
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
  if (sourceProvider === META_OFFICIAL_SOURCE_PROVIDER || sourceProvider === META_SCRAPINGBEE_SOURCE_PROVIDER) return true;
  const rows = await rest(
    "research",
    `observed_ads?select=id&advertiser_page_id=eq.${encode(advertiserPageId)}&limit=1`,
  );
  return rows.length === 0;
}

// Lifecycle reconciliation is DB-authoritative: only a successful run recorded
// as coverage_complete + pagination_exhausted may flip ads inactive or
// reactivate them (research.mark_missing_ads_inactive). Anything else is
// absence-of-evidence only.
async function reconcileMissingObservedAds({ advertiserPageId, seenExternalAdIds, adFetchRunId, coverageComplete = false }) {
  if (!adPageRefreshLifecycleEnabled) {
    return { activeAdsChecked: 0, missingAdsUpdated: 0, adsMarkedInactive: 0, skipped: "lifecycle_reconciliation_disabled" };
  }
  if (!adFetchRunId || !coverageComplete) {
    return { activeAdsChecked: 0, missingAdsUpdated: 0, adsMarkedInactive: 0, skipped: "run_not_coverage_complete" };
  }
  const seenIds = seenExternalAdIds.map((id) => String(id || "")).filter(Boolean);
  try {
    const result = await rpc("mark_missing_ads_inactive", { p_run_id: adFetchRunId, p_seen_external_ad_ids: seenIds });
    return {
      activeAdsChecked: Number(result?.active_ads_checked || 0),
      missingAdsUpdated: Number(result?.missing_seen || 0),
      adsMarkedInactive: Number(result?.marked_inactive || 0),
      reactivated: Number(result?.reactivated || 0),
      allowed: result?.allowed !== false,
    };
  } catch (error) {
    log("Lifecycle reconciliation via DB function failed", {
      advertiser_page_id: advertiserPageId,
      ad_fetch_run_id: adFetchRunId,
      error: error.message,
    }, "warn");
    return { activeAdsChecked: 0, missingAdsUpdated: 0, adsMarkedInactive: 0, error: error.message };
  }
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

async function upsertMediaAssets({ creativeId, observedAdId, snapshotId, mediaSources, preserveCaptureState = false }) {
  let count = 0;
  for (const source of mediaSources) {
    if (!source.source_url || !/^https?:\/\//iu.test(source.source_url)) continue;
    const existing = await rest("research", `media_assets?select=id,capture_status,archive_object_id,archive_verified_at&ad_creative_id=eq.${creativeId}&source_url=eq.${encode(source.source_url)}&limit=1`);
    if (existing?.[0]?.id) {
      if (existing[0].capture_status === "captured" && existing[0].archive_object_id && existing[0].archive_verified_at) { count += 1; continue; }
      if (preserveCaptureState) { count += 1; continue; }
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
        const raced = await rest("research", `media_assets?select=id,capture_status,archive_object_id,archive_verified_at&ad_creative_id=eq.${creativeId}&source_url=eq.${encode(source.source_url)}&limit=1`);
        if (!raced?.[0]?.id) throw error;
        if (raced[0].capture_status === "captured" && raced[0].archive_object_id && raced[0].archive_verified_at) { count += 1; continue; }
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
  if (!payload.advertiserPageId || !payload.metaPageId) {
    return { status: "blocked", blocked_reason: "collector_missing_page", result: { handler: "blockwise-ad-collector", collection_started: false } };
  }
  // Queue selection owns WA/customer scope. Execution rechecks the exact
  // numeric identity and respects a page disabled since it was queued.
  if (!uuidPattern.test(String(payload.advertiserPageId)) || !/^[0-9]+$/.test(String(payload.metaPageId))) {
    return { status: "blocked", blocked_reason: "collector_invalid_page_identity", result: { collection_started: false } };
  }
  const pageRows = await rest(
    "research",
    "advertiser_pages?select=id,page_id,page_name,status,scan_enabled,scan_state&id=eq." + encode(String(payload.advertiserPageId)) + "&page_id=eq." + encode(String(payload.metaPageId)) + "&limit=1",
  );
  const pageRow = pageRows?.[0];
  if (!pageRow?.id) {
    return { status: "blocked", blocked_reason: "collector_unknown_advertiser_page", result: { handler: "blockwise-ad-collector", advertiser_page_id: payload.advertiserPageId, collection_started: false } };
  }
  if (pageRow.scan_enabled === false) {
    return { status: "blocked", blocked_reason: "collector_scan_disabled", result: { handler: "blockwise-ad-collector", advertiser_page_id: pageRow.id, collection_started: false } };
  }
  payload.advertiserPageId = pageRow.id;
  const ingestTables = ["ad_fetch_runs", "observed_ads", "ad_snapshots", "ad_creatives", "media_assets"];
  const input = captureInput(payload);
  const buildRunId = await resolveBuildRunId(payload.build_run_id, payload.buildRunId);
  const initialSourceProvider = scrapingBeeEnabled && scrapingBeeOrder === "primary"
    ? META_SCRAPINGBEE_SOURCE_PROVIDER
    : metaOfficialApiEnabled ? META_OFFICIAL_SOURCE_PROVIDER : configuredMetaFallbackSourceProvider();
  const adFetchRunId = await insertFetchRun(job, buildRunId, input, initialSourceProvider);
  if (!adFetchRunId) throw new Error("ad_fetch_run insert did not return an id");
  // Link provider attempts back to the run row.
  input.adFetchRunId = adFetchRunId;
  const replayingSavedCapture = initialSourceProvider === META_SCRAPINGBEE_SOURCE_PROVIDER
    && Boolean(await loadCaptureJournal(rawEvidenceDir, input));
  if (!replayingSavedCapture) await markAdvertiserPageScanStarted(pageRow.id);
  // Historical replay can improve evidence without replacing newer scheduling truth.
  const finalizeFetchRun = (patch) => updateFetchRun(
    adFetchRunId,
    patch,
    { schedulePage: !replayingSavedCapture },
  );
  const capture = await runMetaPageCapture(input);
  const { outcome, sourceProvider, captureMode: capture_mode } = capture;
  if (outcome.status === "SKIPPED") {
    await finalizeFetchRun({
      source_provider: sourceProvider,
      status: "failed",
      result_summary: {
        provider: sourceProvider,
        active_ads: outcome.items.filter((ad) => activeStatusForMetaAd(ad) === "active").length,
        skipped: true,
        skip_reason: outcome.metadata?.skip_reason || "capture_skipped",
        metadata: outcome.metadata || {},
      },
      error: outcome.errorMessage || "capture skipped",
      cost_usd: 0,
    });
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
    await finalizeFetchRun({ source_provider: sourceProvider, status: "failed", result_summary: { provider: sourceProvider, active_ads: null, metadata: outcome.metadata || {} }, error: outcome.errorMessage || "capture failed", cost_usd: outcome.costUsd || 0, ...runTelemetryPatch(outcome) });
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
    return {
      status: "blocked",
      blocked_reason: "collector_capture_failed",
      result: {
        handler: "blockwise-ad-collector",
        advertiser_page_id: payload.advertiserPageId,
        meta_page_id: payload.metaPageId,
        provider: sourceProvider,
        capture_mode,
        collection_failed: true,
        error: outcome.errorMessage || "Meta capture failed",
        ingest_tables: ingestTables,
      },
    };
  }
  const checkedAt = now();
  // Coverage contract: a run is complete/comparable only when pagination ran
  // to exhaustion (or absence was explicitly confirmed). Truncated captures
  // never drive lifecycle.
  const metadataTruncated = outcome.metadata?.truncated === true;
  const paginationExhausted = outcome.paginationExhausted ?? (!metadataTruncated && outcome.itemCount < input.resultsLimit);
  const coverageComplete = outcome.coverageComplete ?? paginationExhausted;
  if (outcome.itemCount === 0 && outcome.metadata?.confirmed_absence) {
    const zeroCaptureTrusted = await isTrustedConfirmedZeroAdCapture({
      advertiserPageId: payload.advertiserPageId,
      sourceProvider,
    });
    if (!zeroCaptureTrusted) {
      await finalizeFetchRun({
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
        ...runTelemetryPatch(outcome),
      });
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
    // Finalize the run (with coverage flags) BEFORE reconciliation so the
    // DB function sees the authoritative coverage columns. A confirmed
    // zero-ad result is a valid observation, never a fake.
    await finalizeFetchRun({
      source_provider: sourceProvider,
      status: "success",
      result_summary: { provider: sourceProvider, active_ads: 0, item_count: 0, confirmed_absence: true, metadata: outcome.metadata || {} },
      cost_usd: outcome.costUsd || 0,
      ...runTelemetryPatch(outcome),
      coverage_complete: coverageComplete,
      pagination_exhausted: paginationExhausted,
      stop_reason: outcome.stopReason || "confirmed_absence",
    });
    const reconciliation = await reconcileMissingObservedAds({
      advertiserPageId: payload.advertiserPageId,
      seenExternalAdIds: [],
      adFetchRunId,
      coverageComplete,
    });
    await openCircuitIfPaidSpendWithoutIngest({ sourceProvider, input, costUsd: outcome.costUsd || 0, ingestedCount: 0, reason: "confirmed_absence", scope: "page_capture_confirmed_absence" });
    await rest("research", `advertiser_pages?id=eq.${payload.advertiserPageId}`, {
      method: "PATCH",
      body: json({ status: "no_ads_confirmed" }),
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
    await finalizeFetchRun({
      source_provider: sourceProvider,
      status: "partial",
      result_summary: {
        provider: sourceProvider,
        active_ads: outcome.items.filter((ad) => activeStatusForMetaAd(ad) === "active").length,
        item_count: outcome.itemCount,
        ingested_count: ingested.length,
        raw_dataset_id: outcome.rawDatasetId,
        metadata: outcome.metadata || {},
        ingest_error: error.message,
      },
      error: `ingest failed after capture: ${error.message}`,
      cost_usd: outcome.costUsd || 0,
      ...runTelemetryPatch(outcome),
      coverage_complete: false,
      pagination_exhausted: paginationExhausted,
      stop_reason: "ingest_failed",
    });
    await openCircuitIfPaidSpendWithoutIngest({ sourceProvider, input, costUsd: outcome.costUsd || 0, ingestedCount: ingested.length, reason: error.message, scope: "page_ingest_failure" });
    throw error;
  }
  const activeCount = outcome.items.filter((ad) => activeStatusForMetaAd(ad) === "active").length;
  // Finalize the run (with coverage flags) BEFORE reconciliation so the DB
  // function sees the authoritative coverage columns.
  await finalizeFetchRun({
    source_provider: sourceProvider,
    status: "success",
    result_summary: { provider: sourceProvider, active_ads: activeCount, item_count: outcome.itemCount, ingested_count: ingested.length, raw_dataset_id: outcome.rawDatasetId, metadata: outcome.metadata || {} },
    cost_usd: outcome.costUsd || 0,
    ...runTelemetryPatch(outcome),
    coverage_complete: coverageComplete,
    pagination_exhausted: paginationExhausted,
    stop_reason: outcome.stopReason || (coverageComplete ? "page_exhausted" : "results_limit_reached"),
  });
  const reconciliation = await reconcileMissingObservedAds({
    advertiserPageId: payload.advertiserPageId,
    seenExternalAdIds: ingested.map((item) => item.external_ad_id),
    adFetchRunId,
    coverageComplete,
  });
  await openCircuitIfPaidSpendWithoutIngest({ sourceProvider, input, costUsd: outcome.costUsd || 0, ingestedCount: ingested.length, reason: "zero_ingested_after_successful_capture", scope: "page_capture_success" });
  const captureTruncated = !paginationExhausted;
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
    body: json({ status: "resolved_collectable" }),
  });
  return { status: "complete", result: { handler: "blockwise-ad-collector", advertiser_page_id: payload.advertiserPageId, meta_page_id: payload.metaPageId, provider: sourceProvider, capture_mode, ads_seen: outcome.itemCount, ingested_count: ingested.length, active_ads: activeCount, coverage_complete: coverageComplete, reconciliation, ingest_tables: ingestTables } };
}

async function handleMediaCollector(job) {
  const payload = job.payload || {};
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(payload.adCreativeId || "") || !uuid.test(payload.observedAdId || "")) {
    return { status: "blocked", blocked_reason: "media_collector_missing_creative", result: { handler: "blockwise-media-collector" } };
  }
  const load = () => rest("research", "media_assets?select=*&ad_creative_id=eq." + payload.adCreativeId + "&observed_ad_id=eq." + payload.observedAdId + "&capture_status=in.(pending,failed,captured)&archive_object_id=is.null&order=created_at.asc&limit=250");
  let assets = await load();
  let seeded = 0;
  if (!assets.length) {
    const creative = await loadCreativeForMediaCapture(payload.adCreativeId);
    if (creative && creative.observed_ad_id === payload.observedAdId) {
      seeded = await upsertMediaAssets({ creativeId: creative.id, observedAdId: payload.observedAdId, snapshotId: creative.ad_snapshot_id || null, mediaSources: mediaSourcesFromCreative(creative) });
      assets = await load();
    }
  }
  let captured = 0, failed = 0;
  for (const asset of assets) {
    try {
      // The archive RPC owns capture status and object metadata atomically.
      // Do not overwrite it with legacy public-bucket paths or enqueue AI.
      await captureMediaAsset(asset, payload.build_run_id || payload.buildRunId);
      captured += 1;
    } catch (error) {
      await patchMediaAsset(asset.id, { capture_status: "failed", archive_failure_reason: error.message, last_error: error.message });
      failed += 1;
    }
  }
  if (failed > 0) throw new Error("media_capture_failed");
  await refreshClassifiedCreativeDisplay(payload.adCreativeId);
  return {
    status: "complete",
    result: { handler: "blockwise-media-collector", ad_creative_id: payload.adCreativeId, seeded, captured, failed, model_calls: 0 },
  };
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
  const expectedCreativeHash = classifierCreativeHash(creative);
  if (creative.classification_status === "classified" &&
      ((creative.classification?.classifier_version === CLASSIFIER_VERSION + ":saved" &&
        creative.classification?.creative_hash === expectedCreativeHash) ||
       (creative.ad_type && creative.ad_type !== "other" &&
        Number(creative.classification?.confidence) >= 0.7))) {
    return {status:"complete",result:{handler:"blockwise-ad-classifier",
      ad_creative_id:creative.id,preserved_classification:true,model_calls:0}};
  }
  if (payload.creative_hash && String(payload.creative_hash) !== expectedCreativeHash) {
    return { status: "complete", result: { handler: "blockwise-ad-classifier", ad_creative_id: creative.id, stale_hash_skipped: true, model_calls: 0 } };
  }
  const capturedAssets = await rest("research", `media_assets?select=id,kind,storage_path,source_url,capture_status,archive_object_id,archive_verified_at,byte_size,width,height&ad_creative_id=eq.${creative.id}&capture_status=eq.captured&archive_object_id=not.is.null&archive_verified_at=not.is.null&limit=20`);
  const deterministic = payload.classifierMode === "deterministic" && payload.ad_db_child === true;
  if (!deterministic && shouldWaitForMediaClassification(creative, capturedAssets)) {
    throw new Error("classifier_waiting_for_media_capture");
  }
  if (narrowAdDbMode && !deterministic) {
    return {
      status: "blocked",
      blocked_reason: "legacy_classifier_job_not_allowed_in_narrow_worker",
      result: { handler: "blockwise-ad-classifier", ad_creative_id: creative.id, model_calls: 0 },
    };
  }
  const classificationResult = deterministic
    ? classifyCreativeFromSavedEvidence(creative, { evidenceSource: "saved_creative" })
    : await classifyCreativeWithModels(creative, capturedAssets, {
      env,
      fetchImpl: fetch,
      storagePublicUrlForPath,
    });
  const classification = deterministic
    ? {...classificationResult.classification, classifier_version: CLASSIFIER_VERSION + ":saved", creative_hash: expectedCreativeHash}
    : classificationResult.classification;
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
        media_assets: capturedAssets.map((asset) => ({ id: asset.id, kind: asset.kind, archive_object_id: asset.archive_object_id, archive_verified_at: asset.archive_verified_at, byte_size: asset.byte_size })),
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
  await refreshClassifiedCreativeDisplay(creative.id);
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

async function refreshClassifiedCreativeDisplay(creativeId) {
  const [creative] = await rest("research", `ad_creatives?select=*&id=eq.${encode(creativeId)}&limit=1`);
  if (!creative || creative.classification_status !== "classified") return;
  const assets = await rest("research", `media_assets?select=*&ad_creative_id=eq.${encode(creativeId)}&capture_status=eq.captured&archive_object_id=not.is.null&archive_verified_at=not.is.null&limit=250`);
  const displayState = shouldDisplayClassifiedCreative(creative,assets,creative.classification) ? "displayable" : "hidden";
  if (displayState !== creative.display_state) await rest("research",`ad_creatives?id=eq.${encode(creativeId)}`,{
    method:"PATCH",body:json({display_state:displayState})});
}

async function captureMediaAsset(asset, buildRunId) {
  const cliPath = env.HERMES_MEDIA_ARCHIVE_CLI_PATH || join(dirname(new URL(import.meta.url).pathname), "media-archive.mjs");
  const runArchive = (sourceUrl = "") => new Promise((resolve, reject) => {
    const args = [cliPath, "--asset-id", String(asset.id), ...(sourceUrl ? ["--source-url", sourceUrl] : [])];
    const child = spawn(process.execPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolve()
      : reject(new Error("media archive failed: " + (stderr.trim().slice(0, 500) || code))));
  });
  try {
    await runArchive();
  } catch (error) {
    const freshSourceUrl = await freshMediaUrlForAsset(asset);
    if (!freshSourceUrl || freshSourceUrl === asset.source_url) throw error;
    await runArchive(freshSourceUrl);
  }
  const rows = await rest("research", "v_ad_db_archived_media?select=id,observed_ad_id,content_hash,byte_size,object_key&id=eq." + encode(asset.id) + "&observed_ad_id=eq." + encode(asset.observed_ad_id) + "&limit=1");
  const archived = rows?.[0];
  if (!archived || !/^[a-f0-9]{64}$/.test(archived.content_hash) || archived.object_key !== "sha256/" + archived.content_hash || !(Number(archived.byte_size) > 0)) {
    throw new Error("archive worker did not produce a verified object for this ad");
  }
  return archived;
}

let rawEvidenceBucketEnsured = false;

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
  const response = await fetch(`${researchStorageUrl}/storage/v1/object/${encode(bucket)}/${encodedObjectPath}`, {
    method: "POST",
    headers: hermesSupabaseHeaders(researchStorageCredential, {
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
  return `${researchStorageUrl}/storage/v1/object/public/${encode(mediaBucket)}/${String(objectPath).split("/").map(encode).join("/")}`;
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
  if (job.job_type === DIRECTORY_DISCOVERY_JOB_TYPE) {
    return handleAdRadarPageDiscovery(job, { rest, fetchImpl: fetch, now, rawEvidenceDir });
  }
  if (job.job_type === "blockwise-ad-directory-discovery-entity") {
    return handleAdRadarEntityDiscovery(job, { rest, fetchImpl: fetch, now, rawEvidenceDir, searchEvidence: searchFacebookEvidence, resolvePageEvidence: resolveFacebookPageEvidence });
  }
  if (job.job_type === "blockwise-agent-census") return handleAgentCensus(job);
  if (job.job_type === "blockwise-page-resolver") {
    if (job.payload?.ad_radar_discovery === true) {
      return { status: "blocked", blocked_reason: "canonical_page_discovery_handler_not_loaded", result: { handler: "blockwise-page-resolver", model_calls: 0 } };
    }
    if (narrowAdDbMode) {
      return { status: "blocked", blocked_reason: "legacy_page_resolver_not_allowed_in_narrow_worker", result: { handler: "blockwise-page-resolver", model_calls: 0 } };
    }
    return handlePageResolver(job);
  }
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
  const adRadarDisabled = { skipped: true, reason: "ad_radar_disabled", adRadarEnabled: false };
  let supervisor = adRadarEnabled
    ? { policySeedCandidates: 0, policySeeded: 0, duePolicies: 0, enqueued: 0, recycledCensus: 0, deferredCensus: 0, adRefreshCandidates: 0, adRefreshEnqueued: 0 }
    : adRadarDisabled;
  let watchdogs = adRadarEnabled ? {} : adRadarDisabled;
  let priorityContentHandled = 0;
  let customerReadModels = adRadarEnabled ? { skipped: true, reason: "not_due" } : adRadarDisabled;
  let accuracyAudit = adRadarEnabled ? { skipped: true, reason: "not_due" } : adRadarDisabled;
  let inactiveAdPurge = adRadarEnabled ? { skipped: true, reason: "not_due" } : adRadarDisabled;
  try {
    const fastLaneJobs = await claimContentFastLaneJobs({ jobTypes: [CONTENT_RUN_JOB_TYPE], limit: 1 });
    await Promise.all(fastLaneJobs.map(processOneJob));
    priorityContentHandled = fastLaneJobs.length;
  } catch (error) {
    log("priority content worker pass failed; continuing to supervisor", { error: error.message }, "error");
  }
  if (adRadarEnabled) {
    try {
      buildRunId = await ensureBuildRun();
      const policySeed = await ensureSourceBackedRefreshPolicies();
      const census = await enqueueDueCensusJobs(buildRunId);
      await refreshMetaBrowserChallengeCooldownFromSettings();
      const adRefresh = await enqueueDueAdPageRefreshJobs(buildRunId);
      supervisor = { ...policySeed, ...census, ...adRefresh };
    } catch (error) {
      log("supervisor phase failed; continuing to queue worker", { error: error.message }, "error");
    }
  } else {
    log("Ad Radar runtime phases skipped", { adRadarEnabled: false, reason: "HERMES_AD_RADAR_ENABLED=false" });
  }
  const handled = await processClaimedJobs();
  if (adRadarEnabled) {
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
  }
  log("tick complete", { mode, workerId, adRadarEnabled, buildRunId, priorityContentHandled, ...supervisor, handled, watchdogs, customerReadModels, accuracyAudit, inactiveAdPurge });
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
  // Ad evidence and archived media are retained permanently. This guard stays
  // in the runtime so an old scheduled RPC can never delete collection data.
  return { skipped: true, reason: "archival_retention_enabled" };
}

const exactJobMode = process.argv.includes("--job-id");
const adDbWorkerMode = process.argv.includes("--ad-db-worker");
const adDbWorkerPollMs = positiveInt("HERMES_AD_DB_WORKER_POLL_MS", 10_000);
const adRadarLaneConfigs = resolveAdRadarLaneConfigs(env);
const EXACT_CANONICAL_JOB_TYPES = new Set(
  Object.values(adRadarLaneConfigs).flatMap((lane) => lane.jobTypes),
);

function exactJobId() {
  const marker = process.argv.indexOf("--job-id");
  const value = marker >= 0 ? process.argv[marker + 1] : "";
  if (!uuidPattern.test(String(value || ""))) throw new Error("--job-id requires a UUID");
  return value;
}

async function runExactJob(jobId, expectedLane = null) {
  const rows = await rest(
    "research",
    "work_queue?select=*&id=eq." + encode(jobId) + "&queue_name=eq.research&status=eq.pending&available_at=lte." + encode(now()) + "&limit=1",
  );
  const job = rows?.[0];
  if (!job) throw new Error("canonical job is missing or not pending");
  const lane = laneForJob(job, adRadarLaneConfigs);
  if (!EXACT_CANONICAL_JOB_TYPES.has(job.job_type) || !lane) {
    throw new Error("exact mode requires a canonical marked Ad Radar lane job");
  }
  if (expectedLane && lane.name !== expectedLane.name) {
    throw new Error("job does not belong to the requested Ad Radar lane");
  }
  const claimToken = randomUUID();
  const claimed = await rest("research", "work_queue?id=eq." + encode(job.id) + "&status=eq.pending", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: json({
      status: "claimed",
      claimed_at: now(),
      claimed_by: workerId,
      claim_token: claimToken,
      claim_expires_at: new Date(Date.now() + claimTtlSeconds * 1000).toISOString(),
      attempts: (job.attempts ?? 0) + 1,
    }),
  });
  if (!claimed?.[0]) throw new Error("canonical job was claimed concurrently; refusing a second execution");
  await recordEvent("claim", "work_queue", job.id, { job_type: job.job_type, workerId, exact: true }, { work_queue_id: job.id });
  await processOneJob(claimed[0]);
  return { job_id: job.id, job_type: job.job_type, bounded: true, max_jobs: 1 };
}

let lastAdRadarInterestSyncAt = 0;
let lastAdRadarClassificationBackfillAt = 0;

async function runAdDbSupervisorPass() {
  const result = {};
  try { result.leaseRecovery = await rpc("watchdog_requeue_stale_jobs", { p_limit: 100 }); }
  catch (error) { result.leaseRecoveryError = error.message; log("ad-db lease recovery failed; continuing", { error: error.message }, "error"); }
  try {
    if (Date.now() - lastAdRadarInterestSyncAt >= adRadarInterestSyncIntervalMs) {
      result.customerInterestSync = await syncCustomerAdRadarInterests({ researchRest: rest, env, now: now() });
      lastAdRadarInterestSyncAt = Date.now();
    } else result.customerInterestSync = { skipped: true, reason: "not_due" };
  } catch (error) { lastAdRadarInterestSyncAt = Date.now(); result.customerInterestSync = { skipped: false, error: error.message }; log("ad-db customer interest sync failed; continuing", { error: error.message }, "error"); }
  try {
    const buildRunId = await ensureBuildRun();
    await refreshMetaBrowserChallengeCooldownFromSettings();
    result.scheduler = await enqueueDueAdPageRefreshJobs(buildRunId);
    result.directoryDiscovery = await enqueueAdRadarDirectoryDiscovery({ rest, now, buildRunId });
    if (Date.now() - lastAdRadarClassificationBackfillAt >= adRadarInterestSyncIntervalMs) {
      result.classificationBackfill = await enqueueClassificationBackfillJobs();
      lastAdRadarClassificationBackfillAt = Date.now();
    } else result.classificationBackfill = { skipped: true, reason: "not_due" };
  }
  catch (error) { result.scheduler = { error: error.message }; log("ad-db scheduler failed; continuing", { error: error.message }, "error"); }
  return result;
}

async function loadPendingAdRadarLaneJobs(lane) {
  const jobTypes = lane.jobTypes.map((jobType) => encode(jobType)).join(",");
  return rest(
    "research",
    "work_queue?select=*&queue_name=eq.research&status=eq.pending&available_at=lte." + encode(now())
      + "&job_type=in.(" + jobTypes + ")"
      + "&dedupe_key=like." + encode(lane.dedupePrefix) + "%25"
      + "&order=priority.asc,available_at.asc,created_at.asc&limit=100",
  );
}

async function runAdRadarLanePass(lane) {
  const jobs = await loadPendingAdRadarLaneJobs(lane);
  // The queue already orders customer refreshes ahead of first fill.
  const result = await runLaneBatch({
    jobs,
    lane,
    runJob: (job) => runExactJob(job.id, lane),
  });
  if (result.attempted) {
    log("ad-db lane pass", {
      lane: lane.name,
      attempted: result.attempted,
      completed: result.completed,
      failed: result.failed,
      jobIds: result.jobIds,
    });
  }
  return result;
}

async function runAdDbWorkerOnce() {
  const lanes = Object.values(adRadarLaneConfigs);
  const settled = await Promise.allSettled([
    runAdDbSupervisorPass(),
    ...lanes.map((lane) => runAdRadarLanePass(lane)),
  ]);
  const supervisor = settled[0].status === "fulfilled"
    ? settled[0].value
    : { error: settled[0].reason?.message || "scheduler failed" };
  const laneResults = settled.slice(1).map((item, index) => item.status === "fulfilled"
    ? item.value
    : { lane: lanes[index].name, attempted: 0, completed: 0, failed: 1, jobIds: [], results: [], error: item.reason?.message || "lane failed" });
  const attempted = laneResults.reduce((sum, result) => sum + result.attempted, 0);
  const handled = laneResults.reduce((sum, result) => sum + result.completed, 0);
  const failures = laneResults.flatMap((result) => [
    ...(result.error ? [result.error] : []),
    ...(result.results || []).filter((item) => item.status === "rejected").map((item) => item.reason?.message || "canonical job failed"),
  ]);
  return {
    supervisor,
    lanes: laneResults.map(({ lane, attempted: laneAttempted, completed, failed, jobIds, error }) => ({ lane, attempted: laneAttempted, completed, failed, jobIds, ...(error ? { error } : {}) })),
    attempted,
    handled,
    failures,
  };
}

async function runAdDbWorker() {
  if (env.HERMES_RESEARCH_RUN_ONCE === "true") {
    const result = await runAdDbWorkerOnce();
    log("ad-db worker pass", result);
    return;
  }

  const scheduler = startAdRadarLaneLoops({
    lanes: [{ name: "scheduler" }],
    pollMs: adDbWorkerPollMs,
    runLanePass: () => runAdDbSupervisorPass(),
    onError: (error) => log("ad-db scheduler failed; continuing", { error: error.message }, "error"),
  }).start();
  const workers = startAdRadarLaneLoops({
    lanes: Object.values(adRadarLaneConfigs),
    pollMs: adDbWorkerPollMs,
    runLanePass: runAdRadarLanePass,
    onError: (error, lane) => log("ad-db lane failed; continuing", { lane: lane.name, error: error.message }, "error"),
  }).start();

  await new Promise((resolve) => {
    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      log("ad-db worker draining", { signal });
      await Promise.all([scheduler.stop(), workers.stop()]);
      resolve();
    };
    process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
    process.once("SIGINT", () => { void shutdown("SIGINT"); });
  });
}

const historicalReplayMode = process.argv.includes("--historical-replay");
const HISTORICAL_REPLAY_MAX_LIMIT = 5;

function historicalReplayLimit() {
  const marker = process.argv.indexOf("--limit");
  const value = marker >= 0 ? process.argv[marker + 1] : "5";
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > HISTORICAL_REPLAY_MAX_LIMIT) {
    throw new Error("historical replay limit must be an integer from 1 to " + HISTORICAL_REPLAY_MAX_LIMIT);
  }
  return parsed;
}

async function replayCounts(observedIds) {
  const ids = [...new Set(observedIds.filter((id) => uuidPattern.test(String(id))))];
  if (!ids.length) return { observed_ads: 0, ad_snapshots: 0, ad_creatives: 0, media_assets: 0, archived_media: 0 };
  const inFilter = ids.join(",");
  const [observed, snapshots, creatives, media, archived] = await Promise.all([
    rest("research", "observed_ads?select=id&id=in.(" + inFilter + ")"),
    rest("research", "ad_snapshots?select=id&observed_ad_id=in.(" + inFilter + ")"),
    rest("research", "ad_creatives?select=id&observed_ad_id=in.(" + inFilter + ")"),
    rest("research", "media_assets?select=id&observed_ad_id=in.(" + inFilter + ")"),
    rest("research", "v_ad_db_archived_media?select=id,content_hash,byte_size,object_key&observed_ad_id=in.(" + inFilter + ")"),
  ]);
  return {
    observed_ads: observed?.length || 0,
    ad_snapshots: snapshots?.length || 0,
    ad_creatives: creatives?.length || 0,
    media_assets: media?.length || 0,
    archived_media: (archived || []).filter((row) => /^[a-f0-9]{64}$/u.test(String(row.content_hash || ""))
      && row.object_key === "sha256/" + row.content_hash && Number(row.byte_size) > 0).length,
  };
}

async function runHistoricalReplay(limit) {
  const candidates = await rest(
    "research",
    "observed_ads?select=id,advertiser_page_id,external_ad_id,first_seen_at,last_seen_at,active_status,raw_payload"
      + "&raw_payload=not.is.null&order=last_seen_at.asc&limit=5000",
  );
  const selected = [];
  for (const row of candidates || []) {
    if (selected.length >= limit || !uuidPattern.test(String(row.advertiser_page_id || ""))) continue;
    const raw = row.raw_payload;
    const pageId = raw?.page_id || raw?.pageID || raw?.pageId || "";
    const ad = normaliseHostedMetaAd(raw, pageId);
    const creative = creativeFromMetaAd(ad);
    if (!looksLikeAdId(ad.adArchiveID) || !creative.mediaSources.length) continue;
    const snapshots = await rest(
      "research",
      "ad_snapshots?select=ad_fetch_run_id,source_provider,created_at&observed_ad_id=eq." + encode(row.id)
        + "&ad_fetch_run_id=not.is.null&order=created_at.asc&limit=1",
    );
    const snapshot = snapshots?.[0];
    if (!snapshot?.ad_fetch_run_id) continue;
    selected.push({ row, ad, creative, snapshot });
  }
  const before = await replayCounts(selected.map(({ row }) => row.id));
  const results = [];
  let archiveAttempts = 0;
  for (const { row, ad, creative, snapshot } of selected) {
    const historicalObservedAt = row.last_seen_at || row.first_seen_at || metaTimestamp(ad.startDate);
    const input = {
      ad,
      advertiserPageId: row.advertiser_page_id,
      adFetchRunId: snapshot.ad_fetch_run_id,
      buildRunId: null,
      sourceProvider: snapshot.source_provider || "historical_replay",
      historicalObservedAt,
      preserveLifecycle: true,
    };
    // Two identical canonical upserts prove deduplication without creating a
    // new fetch run, paid attempt, AI call, or present-time observation.
    const first = await ingestMetaAd(input);
    const second = await ingestMetaAd(input);
    const assets = await rest(
      "research",
      "media_assets?select=*&ad_creative_id=eq." + encode(first.ad_creative_id)
        + "&observed_ad_id=eq." + encode(first.observed_ad_id) + "&order=created_at.asc&limit=20",
    );
    const asset = (assets || []).find((candidate) => candidate.capture_status === "pending"
      || (candidate.capture_status === "captured" && !candidate.archive_object_id)) || null;
    let archiveStatus = "not_attempted";
    let archiveError = null;
    if (asset) {
      archiveAttempts += 1;
      try {
        const archived = await captureMediaAsset(asset, null);
        archiveStatus = Number(archived.byte_size) > 0 ? "captured" : "failed_verification";
      } catch (error) {
        archiveStatus = "failed";
        archiveError = error.message;
        await patchMediaAsset(asset.id, {
          capture_status: "failed",
          archive_failure_reason: error.message,
          last_error: error.message,
        });
      }
    } else if ((assets || []).some((candidate) => candidate.capture_status === "captured"
      && candidate.archive_object_id && candidate.archive_verified_at)) {
      archiveStatus = "already_captured";
    }
    results.push({
      external_ad_id: row.external_ad_id,
      observed_ad_id: first.observed_ad_id,
      ad_creative_id: first.ad_creative_id,
      media_sources: creative.mediaSources.length,
      media_asset_id: asset?.id || null,
      archive_status: archiveStatus,
      archive_error: archiveError,
      repeat_same_observed_ad: first.observed_ad_id === second.observed_ad_id,
      repeat_same_creative: first.ad_creative_id === second.ad_creative_id,
    });
  }
  const after = await replayCounts(selected.map(({ row }) => row.id));
  return {
    limit,
    selected: selected.length,
    archive_attempts: archiveAttempts,
    paid_requests: 0,
    ai_calls: 0,
    before,
    after,
    results,
  };
}

async function main() {
  if (adDbWorkerMode) {
    await runAdDbWorker();
    return;
  }
  if (exactJobMode) {
    const result = await runExactJob(exactJobId());
    log("exact canonical job complete", result);
    return;
  }
  if (historicalReplayMode) {
    const result = await runHistoricalReplay(historicalReplayLimit());
    log("historical replay complete", result);
    return;
  }
  log("starting", { mode, workerId, adRadarEnabled, handledJobTypes: HANDLED_JOB_TYPES, intervalMs, targetPostcodes: targetPostcodeLog, targetStates, sourceBackedStates: enabledCensusSourceStates, claimLimit, maxJobsPerTick, censusSourceTemplates: sourceTemplates.length, postcodeSuburbs: postcodeSuburbIndex.size, censusQueuePriority, censusPolicyAutoSeedEnabled, censusPolicySeedBatchSize, censusRecycleBlockedEnabled, adPageRefreshEnabled, adPageRefreshIntervalMinutes, adPageRefreshBatchSize, adPageRefreshMaxActive });
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
async function loadAdRadarCustomerInterestScope(pages) {
  let interests = [];
  try {
    interests = await rest("research", "ad_radar_customer_interests?select=customer_key,agent_id,advertiser_page_id,postcode,state,last_synced_at,updated_at&active=eq.true&limit=10000");
  } catch (error) {
    if (!/ad_radar_customer_interests|PGRST205|PGRST204|42P01/iu.test(error.message)) throw error;
    log("customer interest table unavailable; continuing with owned page scope", { error: error.message }, "warning");
  }
  const directPageIds = new Set(interests.map((row) => row.advertiser_page_id).filter(Boolean));
  const directAgentIds = new Set(interests.map((row) => row.agent_id).filter(Boolean));
  const interestLocations = new Set(interests
    .filter((row) => row.postcode)
    .map((row) => `${String(row.state || "WA").toUpperCase()}:${String(row.postcode).trim()}`));
  const pageAgentIds = [...new Set(pages.map((page) => page.agent_id).filter(Boolean))];
  const agentIds = [...new Set([...pageAgentIds, ...directAgentIds])];
  const pageAgencyIds = [...new Set(pages.map((page) => page.agency_id).filter(Boolean))];
  async function readOwners(relation, select, field, ids) {
    const rows = [];
    for (const group of chunkIds(ids)) {
      for (let offset = 0; ; offset += 500) {
        const result = await rest("research", relation + "?select=" + select + "&" + field
          + "=in.(" + group.map(encode).join(",") + ")&order=id.asc&limit=500&offset=" + offset);
        if (!Array.isArray(result)) throw new Error("Invalid research ownership response");
        rows.push(...result);
        if (result.length < 500) break;
      }
    }
    return rows;
  }
  const [agents, agencies, agentAreas, agencyAreas] = await Promise.all([
    readOwners("agents", "id,agency_id,state,primary_postcode", "id", agentIds),
    readOwners("agencies", "id,state,primary_postcode", "id", pageAgencyIds),
    readOwners("agent_service_areas", "id,agent_id,agency_id,state,postcode", "agent_id", agentIds),
    readOwners("agent_service_areas", "id,agent_id,agency_id,state,postcode", "agency_id", pageAgencyIds),
  ]);
  const serviceAreas = [...agentAreas, ...agencyAreas];
  const ownerLocations = new Map();
  for (const row of [...(agents || []), ...(agencies || [])]) {
    if (row.state && row.primary_postcode) ownerLocations.set(String(row.id), `${String(row.state).toUpperCase()}:${String(row.primary_postcode).trim()}`);
  }
  const interestedAgencyIds = new Set((agents || []).filter((row) => directAgentIds.has(row.id) && row.agency_id).map((row) => row.agency_id));
  const waAgentIds = new Set((agents || []).filter((row) => String(row.state || "").toUpperCase() === "WA").map((row) => row.id));
  const waAgencyIds = new Set((agencies || []).filter((row) => String(row.state || "").toUpperCase() === "WA").map((row) => row.id));
  const areaLocations = new Map();
  for (const row of serviceAreas || []) {
    if (!row.postcode) continue;
    const ownerId = row.agent_id || row.agency_id;
    if (!ownerId) continue;
    const key = `${String(row.state || "WA").toUpperCase()}:${String(row.postcode).trim()}`;
    if (!areaLocations.has(String(ownerId))) areaLocations.set(String(ownerId), new Set());
    areaLocations.get(String(ownerId)).add(key);
  }
  const latestInterestSyncedAt = interests.map((row) => row.last_synced_at || row.updated_at).filter((value) => Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
  return {
    count: interests.length,
    latestSyncedAt: latestInterestSyncedAt,
    isWaOwned(page) { return waAgentIds.has(page.agent_id) || waAgencyIds.has(page.agency_id); },
    isInterested(page) {
      if (directPageIds.has(page.id) || directAgentIds.has(page.agent_id) || interestedAgencyIds.has(page.agency_id)) return true;
      const agentLocation = ownerLocations.get(page.agent_id);
      const agencyLocation = ownerLocations.get(page.agency_id);
      const agentAreas = areaLocations.get(String(page.agent_id || ""));
      const agencyAreas = areaLocations.get(String(page.agency_id || ""));
      return Boolean((agentLocation && interestLocations.has(agentLocation)) || (agencyLocation && interestLocations.has(agencyLocation))
        || [...(agentAreas || []), ...(agencyAreas || [])].some((location) => interestLocations.has(location)));
    },
  };
}
