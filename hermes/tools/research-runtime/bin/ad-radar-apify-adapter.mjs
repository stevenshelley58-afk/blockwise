import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const APIFY_ACTOR_ID = "curious_coder~facebook-ads-library-scraper";
export const APIFY_ACTOR_BUILD = "2.7.25";
export const APIFY_ITEM_PRICE_USD = 0.00075;
export const APIFY_START_PRICE_USD = 0.00005;
export const APIFY_ACCOUNT_HARD_CAP_USD = 19;
export const APIFY_PRIOR_TRIAL_BILLED_USD = 0.48610;
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
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new ApifyAdapterError("invalid_budget", `${label} must be a finite non-negative number`);
  return number;
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
  constructor({ rawEvidenceDir, accountHardCapUsd = APIFY_ACCOUNT_HARD_CAP_USD, priorBilledUsd = APIFY_PRIOR_TRIAL_BILLED_USD, accountUsageGetter = async () => 0, lockRetryMs = 20 } = {}) {
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
    const raw = typeof observed === "number" ? observed : observed?.billedUsd ?? observed?.usageTotalUsd ?? observed?.totalUsd;
    return finiteNonNegative(raw ?? 0, "account billed usage");
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
      for (const entry of Object.values(state.reservations)) {
        if (entry.status === "settled_pending_billing" && billed + 1e-9 >= entry.billingFloorUsd) entry.status = "settled";
      }
      await atomicJsonWrite(this.path, state);
      const reserved = Object.values(state.reservations).filter((entry) => entry.status === "reserved" || entry.status === "unknown" || entry.status === "settled_pending_billing").reduce((sum, entry) => sum + entry.reservedUsd, 0);
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
      for (const entry of Object.values(state.reservations)) {
        if (entry.status === "settled_pending_billing" && billed + 1e-9 >= entry.billingFloorUsd) entry.status = "settled";
      }
      const reserved = Object.values(state.reservations).filter((entry) => entry.status === "reserved" || entry.status === "unknown" || entry.status === "settled_pending_billing").reduce((sum, entry) => sum + entry.reservedUsd, 0);
      if (billed + reserved + amount > this.accountHardCapUsd + 1e-9) throw new ApifyAdapterError("account_budget_exceeded", `Apify account cap would be exceeded (${money(billed + reserved + amount)} > ${this.accountHardCapUsd})`);
      const entry = { reservationId, runKey, reservedUsd: amount, baselineBilledUsd: billed, status: "reserved", createdAt: new Date().toISOString(), settledUsd: null };
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
  async settle(reservationId, actualUsd) {
    const amount = finiteNonNegative(actualUsd, "actualUsd");
    return this.withLock(async () => {
      const state = await this.readState(); const entry = state.reservations[reservationId];
      if (!entry) throw new ApifyAdapterError("budget_reservation_missing", `Unknown reservation ${reservationId}`);
      if (entry.status === "settled") return { ...entry, idempotent: true };
      entry.settledUsd = amount; entry.settledAt = new Date().toISOString();
      if (amount === 0) entry.status = "settled";
      else { entry.status = "settled_pending_billing"; entry.billingFloorUsd = money((entry.baselineBilledUsd ?? this.priorBilledUsd) + amount); }
      await atomicJsonWrite(this.path, state); return { ...entry, idempotent: false };
    });
  }
}

/** Persistent state makes a transport-unknown actor start resumable. */
export class FileApifyRunStore {
  constructor(rawEvidenceDir) { if (!rawEvidenceDir) throw new Error("rawEvidenceDir is required for Apify run persistence"); this.path = join(rawEvidenceDir, "apify-runs.json"); }
  async get(runKey) { const state = await readJson(this.path, { version: 1, runs: {} }); return state.runs?.[runKey] ?? null; }
  async put(runKey, value) { const state = await readJson(this.path, { version: 1, runs: {} }); state.version = 1; state.runs ??= {}; state.runs[runKey] = value; await atomicJsonWrite(this.path, state); return value; }
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
  startActor({ input, maxTotalChargeUsd, maxItems }) { return this.request(`acts/${encodeURIComponent(APIFY_ACTOR_ID).replace(/%7E/gu, "~")}/runs`, { method: "POST", query: { build: APIFY_ACTOR_BUILD, maxTotalChargeUsd, maxItems }, body: input }); }
  async getRun(runId) { const response = await this.request(`actor-runs/${encodeURIComponent(runId)}`); return response?.data ?? response; }
  async getDatasetItems(datasetId) { const response = await this.request(`datasets/${encodeURIComponent(datasetId)}/items`, { query: { format: "json", clean: true } }); return response?.data ?? response; }
  async getAccountUsage() { const response = await this.request("users/me/usage"); return response?.data ?? response; }
}

function snakeCase(value) { return value.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").replace(/[-\s]+/gu, "_").toLowerCase(); }
function snakeSnapshot(value) { if (Array.isArray(value)) return value.map(snakeSnapshot); if (!value || typeof value !== "object") return value; return Object.fromEntries(Object.entries(value).map(([key, item]) => [snakeCase(key), snakeSnapshot(item)])); }
function firstString(...values) { return values.find((value) => value !== undefined && value !== null && String(value).trim() !== ""); }
export function normalizeApifyCard(card) {
  if (!card || typeof card !== "object" || Array.isArray(card)) return card;
  const normalized = { ...card }; const adId = firstString(card.ad_archive_id, card.adArchiveId, card.adArchiveID, card.ad_id, card.adId); if (adId !== undefined) normalized.ad_archive_id = String(adId);
  const snapshot = card.snapshot ?? card.ad_snapshot ?? card.adSnapshot; if (snapshot && typeof snapshot === "object") normalized.snapshot = snakeSnapshot(snapshot);
  if (card.errorCode !== undefined && normalized.error_code === undefined) normalized.error_code = card.errorCode; if (card.pageInfo && normalized.page_info === undefined) normalized.page_info = snakeSnapshot(card.pageInfo); return normalized;
}
export function normalizeApifyDataset(items) { if (!Array.isArray(items)) throw new ApifyAdapterError("provider_invalid_dataset", "Apify dataset must be an array"); return items.map(normalizeApifyCard); }
function pageIdFromUrl(value) { if (!value) return null; const text = typeof value === "string" ? value : value.url; if (!text) return null; try { const url = new URL(text); const queryId = url.searchParams.get("view_all_page_id"); if (/^\d+$/u.test(queryId ?? "")) return queryId; const match = url.pathname.match(/(?:^|\/)(\d+)(?:\/|$)/u); return match?.[1] ?? null; } catch { return null; } }
function requestedPageIds(input) { const pages = input.pages ?? input.urls ?? []; const ids = []; for (const page of pages) { const id = firstString(page.pageId, page.page_id, page.id, pageIdFromUrl(page)); if (id && !ids.includes(String(id))) ids.push(String(id)); } return ids; }
export function derivePageOutcomes(items, input) {
  const expected = requestedPageIds(input); const rows = items.filter((item) => item && typeof item === "object"); const observed = new Set(rows.map((item) => firstString(item.page_id, item.pageId, pageIdFromUrl(item.url))).filter(Boolean).map(String)); const pageIds = expected.length ? expected : [...observed];
  const outcomes = pageIds.map((pageId) => { const matching = rows.filter((item) => String(firstString(item.page_id, item.pageId, pageIdFromUrl(item.url)) ?? "") === pageId); const notFound = matching.find((item) => String(firstString(item.error_code, item.errorCode) ?? "").toUpperCase() === "ADS_NOT_FOUND"); if (notFound) return { pageId, outcome: "ads_not_found", trustedZero: false, itemCount: matching.length, reason: "ADS_NOT_FOUND" }; if (!matching.length) return { pageId, outcome: "failure", trustedZero: false, itemCount: 0, reason: "missing_page" }; return { pageId, outcome: "success", trustedZero: false, itemCount: matching.length }; });
  const mismatched = rows.filter((item) => { const observedId = firstString(item.page_id, item.pageId); return expected.length && observedId && !expected.includes(String(observedId)); }); if (mismatched.length) outcomes.push({ pageId: null, outcome: "mismatched_identity", trustedZero: false, itemCount: mismatched.length, reason: "row_page_id_not_requested" }); return outcomes;
}
function eventCost(run) { const events = run?.chargedEventCounts ?? run?.accountedChargedEventCounts; if (!events || typeof events !== "object") return null; const items = Number(events["apify-default-dataset-item"]); const starts = Number(events["apify-actor-start"]); if (!Number.isFinite(items) || !Number.isFinite(starts)) return null; return money(items * APIFY_ITEM_PRICE_USD + starts * APIFY_START_PRICE_USD); }
function runCapHit(run, itemCount, maxItems, maxTotalChargeUsd) { const text = [run?.statusMessage, run?.statusReason, run?.error, run?.errorMessage, run?.status].filter(Boolean).join(" ").toLowerCase(); const reportedCost = eventCost(run) ?? Number(run?.usageTotalUsd); return Boolean(run?.capHit || run?.budgetExceeded || /max.?total.?charge|maximum.?charge|budget.?cap|max.?items|item.?limit|charge.?limit/u.test(text) || (maxItems && itemCount >= maxItems && String(run?.status).toUpperCase() !== "SUCCEEDED") || (maxTotalChargeUsd && Number.isFinite(reportedCost) && reportedCost >= maxTotalChargeUsd - 1e-9)); }
function usageCost(run) { const events = eventCost(run); if (events !== null) return events; if (Number.isFinite(Number(run?.usageTotalUsd))) return money(Number(run.usageTotalUsd)); return null; }
function outcomeFromRun({ run, items, input, maxItems, maxTotalChargeUsd }) {
  const pageOutcomes = derivePageOutcomes(items, input); const capHit = runCapHit(run, items.length, maxItems, maxTotalChargeUsd); const providerFailed = run?.status && ["FAILED", "ABORTED", "TIMED-OUT", "TIMED_OUT", "KILLED"].includes(run.status); const missing = pageOutcomes.some((page) => page.outcome === "failure" || page.outcome === "mismatched_identity"); const paginationExhausted = run?.status === "SUCCEEDED" && !capHit && !missing; const coverageComplete = paginationExhausted && pageOutcomes.length > 0 && pageOutcomes.every((page) => page.outcome === "success"); const status = ((!capHit && providerFailed) || missing) ? "failed" : coverageComplete ? "succeeded" : "succeeded_partial"; const costUsd = usageCost(run);
  return { runId: run?.id ?? null, provider: `apify:${APIFY_ACTOR_ID}`, status, items, itemCount: items.length, costUsd, rawDatasetId: run?.defaultDatasetId ?? null, paginationExhausted, coverageComplete, metadata: { actorId: APIFY_ACTOR_ID, actorBuild: APIFY_ACTOR_BUILD, platformUsageBillingModel: run?.platformUsageBillingModel ?? "DEVELOPER", pageOutcomes, capHit, uniqueAdCount: new Set(items.map((item) => item?.ad_archive_id).filter(Boolean)).size, chargedEventCounts: run?.chargedEventCounts ?? null, statusMessage: run?.statusMessage ?? null } };
}
async function waitForRun(client, runId, { pollIntervalMs = 1_000, maxPolls = 600 } = {}) { for (let poll = 0; poll < maxPolls; poll += 1) { const response = await client.getRun(runId); const run = response?.data ?? response; if (TERMINAL_STATUSES.has(String(run?.status).toUpperCase())) return run; if (poll + 1 < maxPolls) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs)); } throw new ApifyAdapterError("provider_timeout", "Apify run did not reach a terminal state", { retryable: true }); }
export async function runApifyFirstFill(input, dependencies) {
  const deps = dependencies ?? {}; const runKey = input.runKey ?? input.idempotencyKey ?? input.runTag; if (!runKey) throw new ApifyAdapterError("invalid_input", "runKey, idempotencyKey, or runTag is required"); const client = deps.client; if (!client) throw new Error("client is required"); const store = deps.store; if (!store) throw new Error("store is required"); const ledger = deps.ledger; if (!ledger) throw new Error("ledger is required");
  const maxTotalChargeUsd = finiteNonNegative(input.maxTotalChargeUsd ?? 1, "maxTotalChargeUsd"); const requestedMaxItems = Math.max(1, Math.floor(Number(input.maxItems ?? 666))); const affordableMaxItems = Math.floor((maxTotalChargeUsd - APIFY_START_PRICE_USD + 1e-12) / APIFY_ITEM_PRICE_USD); if (affordableMaxItems < 1) throw new ApifyAdapterError("invalid_budget", "per-run cap cannot fund one dataset item and actor start"); const maxItems = Math.min(requestedMaxItems, affordableMaxItems);
  let state = await store.get(runKey); if (state?.outcome) return state.outcome; if (state?.startUnknown && !state.runId) throw new ApifyAdapterError("start_reconciliation_required", "Apify start outcome is unknown; reconcile the persisted run before retrying"); const reservationId = state?.reservationId ?? `apify:${runKey}`;
  if (!state?.runId) {
    const reservation = await ledger.reserve({ reservationId, runKey, reservedUsd: maxTotalChargeUsd }); if (reservation.idempotent && reservation.status !== "settled") throw new ApifyAdapterError("run_reconciliation_required", "Apify reservation exists but run state has no run ID; reconcile before starting another run"); if (reservation.status === "settled") throw new ApifyAdapterError("run_reconciliation_required", "Apify reservation is settled but run state is missing"); const providerInput = input.providerInput ?? input.input ?? Object.fromEntries(Object.entries(input).filter(([key]) => !["runKey", "idempotencyKey", "maxTotalChargeUsd", "maxItems", "providerInput", "input", "pages"].includes(key))); state = { runKey, reservationId, startUnknown: false, runId: null, rawDatasetId: null, providerInput, pages: input.pages ?? input.urls ?? [], maxTotalChargeUsd, maxItems, startedAt: new Date().toISOString() };
    try { await store.put(runKey, state); } catch (error) { await ledger.settle(reservationId, 0); throw error; }
    let started; try { started = await client.startActor({ input: providerInput, maxTotalChargeUsd, maxItems }); } catch (error) { const knownRejected = error?.code === "provider_http_error" && Number(error.httpStatus) >= 400 && Number(error.httpStatus) < 500; if (knownRejected) { await ledger.settle(reservationId, 0); await store.put(runKey, { ...state, status: "failed", error: error.message }); } else { await ledger.markUnknown(reservationId); await store.put(runKey, { ...state, startUnknown: true, status: "start_unknown", error: error.message }); } throw error; }
    const runId = started?.data?.id ?? started?.id; if (!runId) { await ledger.markUnknown(reservationId); await store.put(runKey, { ...state, startUnknown: true, status: "start_unknown" }); throw new ApifyAdapterError("start_reconciliation_required", "Apify accepted an unidentifiable start response; reconcile before retrying"); }
    state = { ...state, runId: String(runId), rawDatasetId: started?.data?.defaultDatasetId ?? started?.defaultDatasetId ?? null, status: "running", startUnknown: false }; await store.put(runKey, state);
  }
  const run = await waitForRun(client, state.runId, { pollIntervalMs: deps.pollIntervalMs ?? 1_000, maxPolls: deps.maxPolls ?? 600 }); const datasetId = run?.defaultDatasetId ?? state.rawDatasetId; let items = []; if (datasetId) { const dataset = await client.getDatasetItems(datasetId); items = normalizeApifyDataset(dataset?.data ?? dataset); } const outcome = outcomeFromRun({ run: { ...run, id: state.runId, defaultDatasetId: datasetId }, items, input: { ...input, pages: state.pages }, maxItems: state.maxItems, maxTotalChargeUsd: state.maxTotalChargeUsd }); if (outcome.costUsd === null) await ledger.markUnknown(reservationId); else await ledger.settle(reservationId, outcome.costUsd); await store.put(runKey, { ...state, status: outcome.status, outcome, startUnknown: false, finishedAt: new Date().toISOString() }); return outcome;
}
export function createApifyFirstFillAdapter(options = {}) {
  const client = options.client ?? new ApifyClient({ token: options.token, fetchImpl: options.fetchImpl, baseUrl: options.baseUrl, timeoutMs: options.timeoutMs }); const store = options.store ?? new FileApifyRunStore(options.rawEvidenceDir); const ledger = options.ledger ?? new ApifyBudgetLedger({ rawEvidenceDir: options.rawEvidenceDir, accountHardCapUsd: options.accountHardCapUsd, priorBilledUsd: options.priorBilledUsd, accountUsageGetter: options.accountUsageGetter ?? (typeof client.getAccountUsage === "function" ? (() => client.getAccountUsage()) : (async () => 0)) });
  return { run: (input) => runApifyFirstFill(input, { client, store, ledger, pollIntervalMs: options.pollIntervalMs, maxPolls: options.maxPolls }), async reconcile({ runKey, runId }) { const state = await store.get(runKey); if (!state) throw new ApifyAdapterError("run_not_found", `No persisted Apify run for ${runKey}`); await store.put(runKey, { ...state, runId: String(runId ?? state.runId ?? ""), startUnknown: false, status: "running" }); return runApifyFirstFill({ runKey, pages: state.pages, providerInput: state.providerInput, maxTotalChargeUsd: state.maxTotalChargeUsd, maxItems: state.maxItems }, { client, store, ledger, pollIntervalMs: options.pollIntervalMs, maxPolls: options.maxPolls }); }, client, store, ledger };
}
export function requestFingerprint(input) { return createHash("sha256").update(JSON.stringify(input)).digest("hex"); }
