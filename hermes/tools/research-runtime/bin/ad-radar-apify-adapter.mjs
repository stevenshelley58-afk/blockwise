import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const APIFY_ACTOR_ID = "curious_coder~facebook-ads-library-scraper";
export const APIFY_ACTOR_BUILD = "2.7.25";
export const APIFY_ITEM_PRICE_USD = 0.00075;
export const APIFY_START_PRICE_USD = 0.00005;
export const APIFY_ACCOUNT_HARD_CAP_USD = 19;
export const APIFY_PRIOR_TRIAL_BILLED_USD = 0.48610;
export const APIFY_ACTOR_TIMEOUT_SECONDS = 600;
export const APIFY_DATASET_PAGE_SIZE = 1000;
const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT", "TIMED_OUT", "KILLED"]);

export class ApifyAdapterError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "ApifyAdapterError";
    this.code = code;
    this.retryable = options.retryable === true;
    this.httpStatus = options.httpStatus ?? null;
  }
}

function finiteNonNegative(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new ApifyAdapterError("invalid_budget", `${label} must be a finite non-negative number`);
  return value;
}
function finiteNonNegativeInteger(value, label) {
  const number = finiteNonNegative(value, label);
  if (!Number.isSafeInteger(number)) throw new ApifyAdapterError("invalid_budget", `${label} must be a finite non-negative integer`);
  return number;
}
function reservationIsLiability(entry) { return entry.knownNoCharge !== true; }
function reservationLiabilityUsd(entry) {
  return entry.knownNoCharge === true ? 0 : finiteNonNegative(entry.liabilityUsd ?? entry.reservedUsd, "persisted liabilityUsd");
}
function reservedLiabilityUsd(reservations) {
  return Object.values(reservations).filter(reservationIsLiability).reduce((sum, entry) => sum + reservationLiabilityUsd(entry), 0);
}
function money(value) { return Math.round(value * 100000000) / 100000000; }
async function atomicJsonWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o660 });
  await rename(temporary, path);
}
async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

/** Single-worker atomic ledger. An unknown start remains fully reserved. */
export class ApifyBudgetLedger {
  constructor({ rawEvidenceDir, accountHardCapUsd = APIFY_ACCOUNT_HARD_CAP_USD, priorBilledUsd = APIFY_PRIOR_TRIAL_BILLED_USD, accountUsageGetter = async () => { throw new Error("account usage getter is not configured"); }, lockRetryMs = 20 } = {}) {
    if (!rawEvidenceDir) throw new Error("rawEvidenceDir is required for Apify budget accounting");
    this.path = join(rawEvidenceDir, "apify-budget-ledger.json");
    this.lockPath = `${this.path}.lock`;
    this.accountHardCapUsd = finiteNonNegative(accountHardCapUsd, "accountHardCapUsd");
    this.priorBilledUsd = finiteNonNegative(priorBilledUsd, "priorBilledUsd");
    this.accountUsageGetter = accountUsageGetter;
    this.lockRetryMs = lockRetryMs;
  }
  async withLock(callback) {
    await mkdir(dirname(this.lockPath), { recursive: true });
    let handle;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { handle = await open(this.lockPath, "wx", 0o660); break; }
      catch (error) {
        if (error?.code !== "EEXIST" || attempt === 4) throw new ApifyAdapterError("budget_lock_busy", "Apify budget ledger lock is busy", { retryable: true });
        await new Promise((resolve) => setTimeout(resolve, this.lockRetryMs));
      }
    }
    try { return await callback(); }
    finally { await handle?.close(); await unlink(this.lockPath).catch(() => {}); }
  }
  async usage() {
    const observed = await this.accountUsageGetter();
    if (!observed || typeof observed !== "object" || Array.isArray(observed)) throw new ApifyAdapterError("account_usage_unavailable", "fresh Apify account usage is required");
    const value = finiteNonNegative(observed.billedUsd, "account billed usage");
    const verifiedAt = Date.parse(observed.verifiedAt);
    if (!Number.isFinite(verifiedAt) || Date.now() - verifiedAt > 15 * 60 * 1000 || verifiedAt > Date.now() + 60_000) throw new ApifyAdapterError("account_usage_stale", "fresh Apify account usage receipt is required");
    return value;
  }
  async readState() {
    const state = await readJson(this.path, { version: 1, reservations: {} });
    if (!state || state.version !== 1 || !state.reservations || typeof state.reservations !== "object") throw new ApifyAdapterError("budget_ledger_invalid", "Apify budget ledger is invalid");
    return state;
  }
  async snapshot() {
    return this.withLock(async () => {
      const state = await this.readState();
      const billed = Math.max(this.priorBilledUsd, await this.usage());
      // Account-wide billing can include unrelated usage. It is never evidence
      // that this campaign's maximum liability has settled.
      const reserved = reservedLiabilityUsd(state.reservations);
      return { accountHardCapUsd: this.accountHardCapUsd, priorBilledUsd: this.priorBilledUsd, billedUsd: billed, reservedUsd: money(reserved), remainingUsd: money(Math.max(0, this.accountHardCapUsd - billed - reserved)) };
    });
  }
  async reserve({ reservationId, runKey, reservedUsd }) {
    if (!reservationId || !runKey) throw new Error("reservationId and runKey are required");
    const amount = finiteNonNegative(reservedUsd, "reservedUsd");
    if (amount <= 0 || amount > this.accountHardCapUsd) throw new ApifyAdapterError("invalid_budget", "reservedUsd must be greater than zero and within the account cap");
    return this.withLock(async () => {
      const state = await this.readState();
      const existing = state.reservations[reservationId];
      if (existing) {
        if (existing.runKey !== runKey || existing.reservedUsd !== amount) throw new ApifyAdapterError("reservation_conflict", `Apify reservation ${reservationId} has different run identity or cap`);
        return { ...existing, idempotent: true };
      }
      const billed = Math.max(this.priorBilledUsd, await this.usage());
      const reserved = reservedLiabilityUsd(state.reservations);
      if (billed + reserved + amount > this.accountHardCapUsd + 1e-9) throw new ApifyAdapterError("account_budget_exceeded", `Apify account cap would be exceeded (${money(billed + reserved + amount)} > ${this.accountHardCapUsd})`);
      const entry = { reservationId, runKey, reservedUsd: amount, liabilityUsd: amount, baselineBilledUsd: billed, status: "reserved", createdAt: new Date().toISOString(), settledUsd: null };
      state.reservations[reservationId] = entry;
      await atomicJsonWrite(this.path, state);
      return { ...entry, idempotent: false, billedUsd: billed, reservedTotalUsd: money(reserved + amount) };
    });
  }
  async markUnknown(reservationId) {
    return this.withLock(async () => {
      const state = await this.readState(); const entry = state.reservations[reservationId];
      if (!entry) throw new ApifyAdapterError("budget_reservation_missing", `Unknown reservation ${reservationId}`);
      entry.status = "unknown"; entry.unknownAt = new Date().toISOString(); await atomicJsonWrite(this.path, state); return { ...entry };
    });
  }
  async settle(reservationId, actualUsd, { knownNoCharge = false } = {}) {
    const amount = finiteNonNegative(actualUsd, "actualUsd");
    return this.withLock(async () => {
      const state = await this.readState(); const entry = state.reservations[reservationId];
      if (!entry) throw new ApifyAdapterError("budget_reservation_missing", `Unknown reservation ${reservationId}`);
      if (entry.status === "settled" || entry.status === "settled_pending_billing") {
        if (entry.settledUsd !== amount) throw new ApifyAdapterError("settlement_conflict", `Apify reservation ${reservationId} was settled with a different amount`);
        return { ...entry, idempotent: true };
      }
      entry.settledUsd = amount; entry.settledAt = new Date().toISOString();
      entry.knownNoCharge = amount === 0 && knownNoCharge === true;
      // A provider-verified actual charge replaces the maximum reservation.
      // Account-wide usage can still include it, so snapshot remains conservative.
      entry.liabilityUsd = entry.knownNoCharge ? 0 : amount;
      entry.status = entry.knownNoCharge ? "settled" : "settled_pending_billing";
      await atomicJsonWrite(this.path, state); return { ...entry, idempotent: false };
    });
  }
}

/** Persistent state makes a transport-unknown actor start resumable. */
export class FileApifyRunStore {
  constructor(rawEvidenceDir, { lockRetryMs = 20 } = {}) { if (!rawEvidenceDir) throw new Error("rawEvidenceDir is required for Apify run persistence"); this.path = join(rawEvidenceDir, "apify-runs.json"); this.lockPath = `${this.path}.lock`; this.lockRetryMs = lockRetryMs; }
  async withLock(callback) { await mkdir(dirname(this.lockPath), { recursive: true }); let handle; for (let attempt = 0; attempt < 5; attempt += 1) { try { handle = await open(this.lockPath, "wx", 0o660); break; } catch (error) { if (error?.code !== "EEXIST" || attempt === 4) throw new ApifyAdapterError("run_lock_busy", "Apify run store lock is busy", { retryable: true }); await new Promise((resolve) => setTimeout(resolve, this.lockRetryMs)); } } try { return await callback(); } finally { await handle?.close(); await unlink(this.lockPath).catch(() => {}); } }
  async get(runKey) { return this.withLock(async () => { const state = await readJson(this.path, { version: 1, runs: {} }); return state.runs?.[runKey] ?? null; }); }
  async put(runKey, value) { return this.withLock(async () => { const state = await readJson(this.path, { version: 1, runs: {} }); state.version = 1; state.runs ??= {}; state.runs[runKey] = value; await atomicJsonWrite(this.path, state); return value; }); }
}

export class ApifyClient {
  constructor({ token, baseUrl = "https://api.apify.com/v2", fetchImpl = fetch, timeoutMs = 30_000 } = {}) { this.token = token; this.baseUrl = baseUrl.replace(/\/+$/u, ""); this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; }
  async request(path, { method = "GET", body, query } = {}) {
    if (!this.token) throw new ApifyAdapterError("provider_not_configured", "APIFY_TOKEN is not configured");
    const url = new URL(`${this.baseUrl}/${path.replace(/^\/+/, "")}`); for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { method, signal: controller.signal, headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const raw = await response.text(); let parsed = null; try { parsed = raw ? JSON.parse(raw) : null; } catch { throw new ApifyAdapterError("provider_invalid_response", "Apify returned non-JSON data", { httpStatus: response.status }); }
      if (!response.ok) throw new ApifyAdapterError("provider_http_error", `Apify request failed with HTTP ${response.status}`, { httpStatus: response.status }); return parsed;
    } catch (error) { if (error instanceof ApifyAdapterError) throw error; throw new ApifyAdapterError("provider_transport_unknown", `Apify request outcome is unknown: ${error.message}`, { retryable: true }); }
    finally { clearTimeout(timeout); }
  }
  startActor({ input, maxTotalChargeUsd, maxItems, timeoutSeconds = APIFY_ACTOR_TIMEOUT_SECONDS }) { return this.request(`acts/${encodeURIComponent(APIFY_ACTOR_ID).replace(/%7E/gu, "~")}/runs`, { method: "POST", query: { build: APIFY_ACTOR_BUILD, maxTotalChargeUsd, maxItems, timeout: Math.min(APIFY_ACTOR_TIMEOUT_SECONDS, finiteNonNegativeInteger(timeoutSeconds, "actor timeout seconds")) }, body: input }); }
  async getRun(runId) { const response = await this.request(`actor-runs/${encodeURIComponent(runId)}`); return response?.data ?? response; }
  async getDatasetItems(datasetId, { offset = 0, limit = APIFY_DATASET_PAGE_SIZE } = {}) { const response = await this.request(`datasets/${encodeURIComponent(datasetId)}/items`, { query: { format: "json", clean: true, desc: false, offset: finiteNonNegativeInteger(offset, "dataset offset"), limit: finiteNonNegativeInteger(limit, "dataset limit") } }); return response?.data ?? response; }
  async getAccountUsage() {
    const response = await this.request("users/me/usage/monthly");
    const data = response?.data ?? response;
    const billedUsd = data?.totalUsageCreditsUsdAfterVolumeDiscount;
    const beforeDiscount = data?.totalUsageCreditsUsdBeforeVolumeDiscount;
    const startAt = data?.usageCycle?.startAt;
    const endAt = data?.usageCycle?.endAt;
    if (!Number.isFinite(billedUsd) || billedUsd < 0 || !Number.isFinite(beforeDiscount) || beforeDiscount < 0 || !data?.monthlyServiceUsage || typeof data.monthlyServiceUsage !== "object" || Array.isArray(data.monthlyServiceUsage) || !Array.isArray(data.dailyServiceUsages) || !Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt))) throw new ApifyAdapterError("account_usage_unavailable", "Apify monthly usage response failed schema validation");
    return { billedUsd, verifiedAt: new Date().toISOString(), usageCycle: { startAt, endAt } };
  }
}

function snakeCase(value) { return value.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").replace(/[-\s]+/gu, "_").toLowerCase(); }
function snakeSnapshot(value) { if (Array.isArray(value)) return value.map(snakeSnapshot); if (!value || typeof value !== "object") return value; return Object.fromEntries(Object.entries(value).map(([key, item]) => [snakeCase(key), snakeSnapshot(item)])); }
function firstString(...values) { return values.find((value) => value !== undefined && value !== null && String(value).trim() !== ""); }
function stableValue(value) { if (Array.isArray(value)) return value.map(stableValue); if (!value || typeof value !== "object") return value; return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)])); }
function inputFingerprint(input, maxTotalChargeUsd, maxItems) { return requestFingerprint({ providerInput: input.providerInput ?? input.input ?? null, pages: input.pages ?? input.urls ?? [], maxTotalChargeUsd, maxItems }); }
export function normalizeApifyCard(card) {
  if (!card || typeof card !== "object" || Array.isArray(card)) return card;
  const normalized = { ...card }; const adId = firstString(card.ad_archive_id, card.adArchiveId, card.adArchiveID, card.ad_id, card.adId); if (adId !== undefined) normalized.ad_archive_id = String(adId);
  const snapshot = card.snapshot ?? card.ad_snapshot ?? card.adSnapshot; if (snapshot && typeof snapshot === "object") normalized.snapshot = snakeSnapshot(snapshot);
  if (card.errorCode !== undefined && normalized.error_code === undefined) normalized.error_code = card.errorCode; if (card.pageInfo && normalized.page_info === undefined) normalized.page_info = snakeSnapshot(card.pageInfo); return normalized;
}
export function normalizeApifyDataset(items) { if (!Array.isArray(items)) throw new ApifyAdapterError("provider_invalid_dataset", "Apify dataset must be an array"); return items.map(normalizeApifyCard); }
function pageIdFromUrl(value) { if (!value) return null; const text = typeof value === "string" ? value : value.url; if (!text) return null; try { const url = new URL(text); const queryId = url.searchParams.get("view_all_page_id"); if (/^\d+$/u.test(queryId ?? "")) return queryId; const match = url.pathname.match(/(?:^|\/)(\d+)(?:\/|$)/u); return match?.[1] ?? null; } catch { return null; } }
function requestedPageIds(input) { const pages = input.pages ?? input.urls ?? []; const ids = []; for (const page of pages) { const id = firstString(page.pageId, page.page_id, page.id, pageIdFromUrl(page)); if (id && !ids.includes(String(id))) ids.push(String(id)); } return ids; }
function rowPageIds(item) {
  const nested = [item?.page_info?.page_id, item?.pageInfo?.page_id, item?.snapshot?.page_id];
  return [...new Set([item?.page_id, item?.pageId, ...nested, pageIdFromUrl(item?.url)].filter(Boolean).map(String))];
}
function validNumericId(value) { return /^\d+$/u.test(String(value ?? "")); }
function adRowIssue(item, expectedPageId) {
  const rowIds = rowPageIds(item);
  if (!validNumericId(item?.ad_archive_id)) return "invalid_ad_archive_id";
  if (!validNumericId(item?.page_id)) return "invalid_page_id";
  if (item?.is_active !== true && item?.active !== true) return "not_active";
  if (!item?.snapshot || typeof item.snapshot !== "object" || Array.isArray(item.snapshot)) return "missing_snapshot";
  if (!validNumericId(item.snapshot.page_id) || String(item.snapshot.page_id) !== String(item.page_id)) return "snapshot_page_mismatch";
  if (item.pageInfo && String(item.pageInfo.page_id ?? "") !== String(item.page_id)) return "page_info_mismatch";
  if (expectedPageId && !rowIds.includes(String(expectedPageId))) return "row_page_mismatch";
  if (rowIds.length !== 1 && !rowIds.every((id) => id === String(item.page_id))) return "ambiguous_page_identity";
  return null;
}
export function derivePageOutcomes(items, input) {
  const expected = requestedPageIds(input); const rows = items.filter((item) => item && typeof item === "object"); const observed = new Set(rows.flatMap(rowPageIds)); const pageIds = expected.length ? expected : [...observed];
  const outcomes = pageIds.map((pageId) => {
    const matching = rows.filter((item) => rowPageIds(item).includes(pageId));
    const notFound = matching.find((item) => String(firstString(item.error_code, item.errorCode) ?? "").toUpperCase() === "ADS_NOT_FOUND");
    if (!matching.length) return { pageId, outcome: "failure", trustedZero: false, itemCount: 0, reason: "missing_page" };
    if (notFound) {
      // The ADS_NOT_FOUND row is scoped to the URL that was submitted, and the row's
      // own URL already ties it to this page id (rowPageIds reads view_all_page_id).
      // The actor sometimes omits the nested page identity; a missing echo is not a
      // page mismatch. Record the zero honestly instead of failing the whole capture:
      // a completed scan with an unverified zero, never a trusted zero.
      const ids = rowPageIds(notFound); const nestedPage = firstString(notFound.page_info?.page_id, notFound.pageInfo?.page_id);
      const echoedPageId = validNumericId(nestedPage) ? String(nestedPage) : null;
      if (ids.length > 1 || (echoedPageId && echoedPageId !== pageId)) return { pageId, outcome: "mismatched_identity", trustedZero: false, itemCount: matching.length, reason: "ADS_NOT_FOUND_page_mismatch" };
      if (echoedPageId === pageId) return { pageId, outcome: "ads_not_found", trustedZero: false, itemCount: matching.length, reason: "ADS_NOT_FOUND" };
      return { pageId, outcome: "ads_not_found_unverified", trustedZero: false, itemCount: matching.length, reason: "ADS_NOT_FOUND_no_page_echo" };
    }
    const issue = matching.map((item) => adRowIssue(item, pageId)).find(Boolean);
    if (issue) return { pageId, outcome: "mismatched_identity", trustedZero: false, itemCount: matching.length, reason: issue };
    return { pageId, outcome: "success", trustedZero: false, itemCount: matching.length };
  });
  const mismatched = rows.filter((item) => expected.length && !rowPageIds(item).some((id) => expected.includes(id))); if (mismatched.length) outcomes.push({ pageId: null, outcome: "mismatched_identity", trustedZero: false, itemCount: mismatched.length, reason: "row_page_id_not_requested" }); return outcomes;
}
function eventCounts(run) {
  const events = run?.chargedEventCounts ?? run?.accountedChargedEventCounts;
  if (!events || typeof events !== "object" || Array.isArray(events)) return null;
  const items = events["apify-default-dataset-item"];
  const starts = events["apify-actor-start"];
  if (typeof items !== "number" || typeof starts !== "number" || !Number.isSafeInteger(items) || !Number.isSafeInteger(starts) || items < 0 || starts < 0) return null;
  return { items, starts };
}
function eventCost(run) {
  const counts = eventCounts(run);
  return counts ? money(counts.items * APIFY_ITEM_PRICE_USD + counts.starts * APIFY_START_PRICE_USD) : null;
}
function billingMetadata(run, datasetItemCount = 0) {
  if (run?.platformUsageBillingModel !== "DEVELOPER") return { verified: false, reason: "platform_usage_billing_model_unverified" };
  const counts = eventCounts(run);
  if (!counts) return { verified: false, reason: "charged_event_counts_unverified" };
  if (counts.starts < 1) return { verified: false, reason: "charged_actor_start_pending" };
  if (counts.items < datasetItemCount) return { verified: false, reason: "charged_dataset_items_pending" };
  const costUsd = money(counts.items * APIFY_ITEM_PRICE_USD + counts.starts * APIFY_START_PRICE_USD);
  const reported = run?.usageTotalUsd;
  if (reported !== undefined && (!Number.isFinite(reported) || reported < 0 || Math.abs(reported - costUsd) > 1e-8)) {
    return { verified: false, reason: "charged_event_price_mismatch" };
  }
  return { verified: true, costUsd, counts };
}
function runCapHit(run, itemCount, maxItems, maxTotalChargeUsd) { const text = [run?.statusMessage, run?.statusReason, run?.error, run?.errorMessage, run?.status].filter(Boolean).join(" ").toLowerCase(); const total = run?.usageTotalUsd; const reportedCost = eventCost(run) ?? (typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : null); return Boolean(run?.capHit || run?.budgetExceeded || /max.*total.*charge|maximum.*charge|budget.*cap|max.*items|item.*limit|charge.*limit/u.test(text) || (maxItems && itemCount >= maxItems) || (maxTotalChargeUsd && reportedCost !== null && reportedCost >= maxTotalChargeUsd - 1e-9)); }
function usageCost(run) { const events = eventCost(run); if (events !== null) return events; const total = run?.usageTotalUsd; return typeof total === "number" && Number.isFinite(total) && total >= 0 ? money(total) : null; }
function outcomeFromRun({ run, items, input, maxItems, maxTotalChargeUsd }) {
  const pageOutcomes = derivePageOutcomes(items, input); const billing = billingMetadata(run, items.length); const capHit = runCapHit(run, items.length, maxItems, maxTotalChargeUsd); const providerFailed = run?.status && ["FAILED", "ABORTED", "TIMED-OUT", "TIMED_OUT", "KILLED"].includes(String(run.status).toUpperCase()); const missing = pageOutcomes.some((page) => page.outcome === "failure" || page.outcome === "mismatched_identity"); const unverifiedZero = !missing && pageOutcomes.length > 0 && pageOutcomes.every((page) => page.outcome === "ads_not_found" || page.outcome === "ads_not_found_unverified"); const paginationExhausted = String(run?.status).toUpperCase() === "SUCCEEDED" && !capHit && !missing; const coverageComplete = paginationExhausted && pageOutcomes.length > 0 && pageOutcomes.every((page) => page.outcome === "success" || page.outcome === "ads_not_found" || page.outcome === "ads_not_found_unverified"); const status = (!billing.verified || (!capHit && providerFailed) || missing) ? "FAILED" : coverageComplete ? "SUCCEEDED" : "SUCCEEDED_PARTIAL"; const costUsd = billing.verified ? billing.costUsd : null;
  return { runId: run?.id ?? null, provider: `apify:${APIFY_ACTOR_ID}`, status, items, itemCount: items.length, costUsd, rawDatasetId: run?.defaultDatasetId ?? null, paginationExhausted, coverageComplete, unverifiedZero, metadata: { actorId: APIFY_ACTOR_ID, actorBuild: APIFY_ACTOR_BUILD, itemPriceUsd: APIFY_ITEM_PRICE_USD, startPriceUsd: APIFY_START_PRICE_USD, platformUsageBillingModel: run?.platformUsageBillingModel ?? null, billingVerified: billing.verified, billingFailureReason: billing.reason ?? null, billingPending: !billing.verified, pageOutcomes, capHit, maxItems, maxItemsWasImplicit: input.maxItems === undefined, uniqueAdCount: new Set(items.map((item) => item?.ad_archive_id).filter(Boolean)).size, chargedEventCounts: run?.chargedEventCounts ?? null, statusMessage: run?.statusMessage ?? null } };
}
async function getAllDatasetItems(client, datasetId, maxItems) {
  const items = []; let offset = 0;
  while (items.length < maxItems) {
    const limit = Math.min(APIFY_DATASET_PAGE_SIZE, maxItems - items.length);
    const page = normalizeApifyDataset(await client.getDatasetItems(datasetId, { offset, limit }));
    items.push(...page);
    if (page.length < limit) return { items, exhausted: true };
    offset += page.length;
  }
  return { items, exhausted: false };
}
async function waitForRun(client, runId, { pollIntervalMs = 1_000, maxPolls = APIFY_ACTOR_TIMEOUT_SECONDS } = {}) { const polls = Math.min(APIFY_ACTOR_TIMEOUT_SECONDS, finiteNonNegativeInteger(maxPolls, "max polls")); for (let poll = 0; poll < polls; poll += 1) { const response = await client.getRun(runId); const run = response?.data ?? response; if (TERMINAL_STATUSES.has(String(run?.status).toUpperCase())) return run; if (poll + 1 < polls) await new Promise((resolve) => setTimeout(resolve, finiteNonNegative(pollIntervalMs, "poll interval milliseconds"))); } throw new ApifyAdapterError("provider_timeout", "Apify run did not reach a terminal state within 600 seconds", { retryable: true }); }
async function reconcileBillingEvidence(client, runId, initialRun, datasetItemCount, { pollIntervalMs = 1_000, maxPolls = 3 } = {}) {
  const polls = Math.min(10, finiteNonNegativeInteger(maxPolls, "billing max polls"));
  let run = initialRun;
  let billing = billingMetadata(run, datasetItemCount);
  for (let poll = 1; !billing.verified && poll < polls; poll += 1) {
    if (pollIntervalMs > 0) await new Promise((resolve) => setTimeout(resolve, finiteNonNegative(pollIntervalMs, "billing poll interval milliseconds")));
    const response = await client.getRun(runId);
    run = response?.data ?? response;
    billing = billingMetadata(run, datasetItemCount);
  }
  return { run, billing, polls };
}

export async function runApifyFirstFill(input, dependencies) {
  const deps = dependencies ?? {}; const runKey = input.runKey ?? input.idempotencyKey ?? input.runTag; if (!runKey) throw new ApifyAdapterError("invalid_input", "runKey, idempotencyKey, or runTag is required"); const client = deps.client; if (!client) throw new Error("client is required"); const store = deps.store; if (!store) throw new Error("store is required"); const ledger = deps.ledger; if (!ledger) throw new Error("ledger is required");
  const maxTotalChargeUsd = finiteNonNegative(input.maxTotalChargeUsd ?? 1, "maxTotalChargeUsd"); const requestedMaxItems = input.maxItems === undefined ? Number.POSITIVE_INFINITY : finiteNonNegativeInteger(input.maxItems, "maxItems"); const affordableMaxItems = Math.floor((maxTotalChargeUsd - APIFY_START_PRICE_USD + 1e-12) / APIFY_ITEM_PRICE_USD); if (requestedMaxItems < 1 || affordableMaxItems < 1) throw new ApifyAdapterError("invalid_budget", "per-run cap cannot fund one dataset item and actor start"); const maxItems = Math.min(requestedMaxItems, affordableMaxItems);
  const fingerprint = inputFingerprint(input, maxTotalChargeUsd, maxItems); let state = await store.get(runKey); if (state?.requestFingerprint && state.requestFingerprint !== fingerprint) throw new ApifyAdapterError("run_input_conflict", `Apify run key ${runKey} was reused with different input`); if (state?.outcome) return state.outcome; if (state?.startUnknown && !state.runId) throw new ApifyAdapterError("start_reconciliation_required", "Apify start outcome is unknown; reconcile the persisted run before retrying"); const reservationId = state?.reservationId ?? `apify:${runKey}`;
  if (!state?.runId) {
    const reservation = await ledger.reserve({ reservationId, runKey, reservedUsd: maxTotalChargeUsd }); if (reservation.idempotent && reservation.status !== "settled") throw new ApifyAdapterError("run_reconciliation_required", "Apify reservation exists but run state has no run ID; reconcile before starting another run"); if (reservation.status === "settled") throw new ApifyAdapterError("run_reconciliation_required", "Apify reservation is settled but run state is missing"); const providerInput = input.providerInput ?? input.input ?? Object.fromEntries(Object.entries(input).filter(([key]) => !["runKey", "idempotencyKey", "maxTotalChargeUsd", "maxItems", "providerInput", "input", "pages"].includes(key))); state = { runKey, requestFingerprint: fingerprint, reservationId, startUnknown: false, runId: null, rawDatasetId: null, providerInput, pages: input.pages ?? input.urls ?? [], maxTotalChargeUsd, maxItems, startedAt: new Date().toISOString() };
    try { await store.put(runKey, state); } catch (error) { await ledger.settle(reservationId, 0, { knownNoCharge: true }); throw error; }
    let started; try { started = await client.startActor({ input: providerInput, maxTotalChargeUsd, maxItems, timeoutSeconds: APIFY_ACTOR_TIMEOUT_SECONDS }); } catch (error) { const knownRejected = error?.code === "provider_http_error" && typeof error?.httpStatus === "number" && Number.isInteger(error.httpStatus) && error.httpStatus >= 400 && error.httpStatus < 500; if (knownRejected) { await ledger.settle(reservationId, 0, { knownNoCharge: true }); await store.put(runKey, { ...state, status: "failed", error: error.message }); } else { await ledger.markUnknown(reservationId); await store.put(runKey, { ...state, startUnknown: true, status: "start_unknown", error: error.message }); } throw error; }
    const runId = started?.data?.id ?? started?.id; if (!runId) { await ledger.markUnknown(reservationId); await store.put(runKey, { ...state, startUnknown: true, status: "start_unknown" }); throw new ApifyAdapterError("start_reconciliation_required", "Apify accepted an unidentifiable start response; reconcile before retrying"); }
    state = { ...state, runId: String(runId), rawDatasetId: started?.data?.defaultDatasetId ?? started?.defaultDatasetId ?? null, status: "running", startUnknown: false }; await store.put(runKey, state);
  }
  const run = await waitForRun(client, state.runId, { pollIntervalMs: deps.pollIntervalMs ?? 1_000, maxPolls: deps.maxPolls ?? APIFY_ACTOR_TIMEOUT_SECONDS }); const datasetId = run?.defaultDatasetId ?? state.rawDatasetId;
  if (!datasetId) { await ledger.markUnknown(reservationId); const outcome = { runId: state.runId, provider: `apify:${APIFY_ACTOR_ID}`, status: "FAILED", items: [], itemCount: 0, costUsd: usageCost(run), rawDatasetId: null, paginationExhausted: false, coverageComplete: false, metadata: { actorId: APIFY_ACTOR_ID, actorBuild: APIFY_ACTOR_BUILD, platformUsageBillingModel: run?.platformUsageBillingModel ?? null, pageOutcomes: [], capHit: false, uniqueAdCount: 0, failureReason: "missing_dataset" } }; await store.put(runKey, { ...state, status: "FAILED", outcome, startUnknown: false, finishedAt: new Date().toISOString() }); return outcome; }
  const dataset = await getAllDatasetItems(client, datasetId, state.maxItems);
  const reconciliation = await reconcileBillingEvidence(client, state.runId, run, dataset.items.length, {
    pollIntervalMs: deps.pollIntervalMs ?? 1_000,
    maxPolls: deps.billingMaxPolls ?? 3,
  });
  const reconciledRun = { ...reconciliation.run, id: state.runId, defaultDatasetId: datasetId };
  const outcome = outcomeFromRun({ run: reconciledRun, items: dataset.items, input: { ...input, pages: state.pages }, maxItems: state.maxItems, maxTotalChargeUsd: state.maxTotalChargeUsd });
  if (!reconciliation.billing.verified) {
    await ledger.markUnknown(reservationId);
    await store.put(runKey, {
      ...state,
      status: "billing_pending",
      startUnknown: false,
      billing_pending: { reason: reconciliation.billing.reason, polls: reconciliation.polls, item_count: dataset.items.length },
      finishedAt: new Date().toISOString(),
    });
    return outcome;
  }
  await ledger.settle(reservationId, outcome.costUsd);
  await store.put(runKey, { ...state, status: outcome.status, outcome, startUnknown: false, finishedAt: new Date().toISOString() });
  return outcome;
}
export function createApifyFirstFillAdapter(options = {}) {
  const client = options.client ?? new ApifyClient({ token: options.token, fetchImpl: options.fetchImpl, baseUrl: options.baseUrl, timeoutMs: options.timeoutMs }); const store = options.store ?? new FileApifyRunStore(options.rawEvidenceDir); const ledger = options.ledger ?? new ApifyBudgetLedger({ rawEvidenceDir: options.rawEvidenceDir, accountHardCapUsd: options.accountHardCapUsd, priorBilledUsd: options.priorBilledUsd, accountUsageGetter: options.accountUsageGetter ?? (typeof client.getAccountUsage === "function" ? (() => client.getAccountUsage()) : (async () => { throw new ApifyAdapterError("account_usage_unavailable", "fresh Apify account usage getter is required"); })) });
  return { run: (input) => runApifyFirstFill(input, { client, store, ledger, pollIntervalMs: options.pollIntervalMs, maxPolls: options.maxPolls, billingMaxPolls: options.billingMaxPolls }), async reconcile({ runKey, runId }) { const state = await store.get(runKey); if (!state) throw new ApifyAdapterError("run_not_found", `No persisted Apify run for ${runKey}`); await store.put(runKey, { ...state, runId: String(runId ?? state.runId ?? ""), startUnknown: false, status: "running" }); return runApifyFirstFill({ runKey, pages: state.pages, providerInput: state.providerInput, maxTotalChargeUsd: state.maxTotalChargeUsd, maxItems: state.maxItems }, { client, store, ledger, pollIntervalMs: options.pollIntervalMs, maxPolls: options.maxPolls, billingMaxPolls: options.billingMaxPolls }); }, client, store, ledger };
}
export function requestFingerprint(input) { return createHash("sha256").update(JSON.stringify(stableValue(input))).digest("hex"); }
