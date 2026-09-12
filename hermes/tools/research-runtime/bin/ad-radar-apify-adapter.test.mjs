import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  APIFY_ACTOR_BUILD,
  APIFY_ACTOR_ID,
  APIFY_ACCOUNT_HARD_CAP_USD,
  APIFY_PRIOR_TRIAL_BILLED_USD,
  ApifyAdapterError,
  ApifyClient,
  ApifyBudgetLedger,
  createApifyFirstFillAdapter,
  derivePageOutcomes,
  normalizeApifyDataset,
} from "./ad-radar-apify-adapter.mjs";

async function tempDir() { return mkdtemp(join(tmpdir(), "ad-radar-apify-")); }
function fakeLedger() {
  const reservations = new Map();
  return {
    reservations,
    async reserve({ reservationId, reservedUsd }) { if (reservations.has(reservationId)) return { ...reservations.get(reservationId), idempotent: true }; const entry = { reservationId, reservedUsd, status: "reserved" }; reservations.set(reservationId, entry); return entry; },
    async markUnknown(id) { const entry = reservations.get(id); entry.status = "unknown"; return entry; },
    async settle(id, amount) { const entry = reservations.get(id); entry.status = "settled"; entry.settledUsd = amount; return entry; },
  };
}

test("normalization preserves every row, canonicalizes ad_archive_id and snake-cases snapshots", () => {
  const rows = normalizeApifyDataset([{ adArchiveId: 17, snapshot: { pageName: "Example", cards: [{ videoHdUrl: "x" }] }, custom: "kept" }, { errorCode: "ADS_NOT_FOUND", url: "https://www.facebook.com/99" }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ad_archive_id, "17");
  assert.equal(rows[0].snapshot.page_name, "Example");
  assert.equal(rows[0].snapshot.cards[0].video_hd_url, "x");
  assert.equal(rows[0].custom, "kept");
  assert.equal(rows[1].error_code, "ADS_NOT_FOUND");
});

test("page outcomes never turn ADS_NOT_FOUND or mismatched identity into trusted zero", () => {
  const outcomes = derivePageOutcomes([
    { ad_archive_id: "1", page_id: "1", is_active: true, snapshot: { page_id: "1" }, pageInfo: { page_id: "1" } },
    { error_code: "ADS_NOT_FOUND", url: "https://www.facebook.com/2" },
    { ad_archive_id: "foreign", page_id: "9" },
  ], { urls: [{ url: "https://www.facebook.com/1" }, { url: "https://www.facebook.com/2" }, { url: "https://www.facebook.com/3" }] });
  assert.deepEqual(outcomes.map((item) => item.outcome), ["success", "mismatched_identity", "failure", "mismatched_identity"]);
  assert.equal(outcomes.every((item) => item.trustedZero === false), true);
  assert.equal(outcomes.find((item) => item.pageId === "3").reason, "missing_page");
});

test("successful first fill returns the stable integration outcome and provider-enforced cap", async () => {
  const store = new Map(); const ledger = fakeLedger(); const starts = [];
  const client = {
    async startActor(args) { starts.push(args); return { id: "run-1", defaultDatasetId: "dataset-1" }; },
    async getRun() { return { id: "run-1", status: "SUCCEEDED", defaultDatasetId: "dataset-1", usageTotalUsd: 0.24305, platformUsageBillingModel: "DEVELOPER", chargedEventCounts: { "apify-default-dataset-item": 324, "apify-actor-start": 1 } }; },
    async getDatasetItems() { return [{ ad_archive_id: "1", page_id: "1", is_active: true, snapshot: { page_id: "1", pageName: "One" }, pageInfo: { page_id: "1" } }]; },
  };
  const adapter = createApifyFirstFillAdapter({ client, store: { get: async (key) => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); } }, ledger, pollIntervalMs: 0 });
  const result = await adapter.run({ runKey: "fill-1", maxTotalChargeUsd: 0.5, maxItems: 666, urls: [{ url: "https://www.facebook.com/1" }], providerInput: { urls: [{ url: "https://www.facebook.com/1" }] } });
  assert.equal(starts.length, 1);
  assert.equal(starts[0].maxTotalChargeUsd, 0.5);
  assert.equal(starts[0].maxItems, 666);
  assert.equal(result.runId, "run-1");
  assert.equal(result.provider, `apify:${APIFY_ACTOR_ID}`);
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.coverageComplete, true);
  assert.equal(result.costUsd, 0.24305);
  assert.equal(result.metadata.platformUsageBillingModel, "DEVELOPER");
});

test("unknown actor start is persisted and a retry never posts a second run", async () => {
  const dir = await tempDir();
  try {
    const ledger = new ApifyBudgetLedger({ rawEvidenceDir: dir, accountUsageGetter: async () => ({ billedUsd: 0, verifiedAt: new Date().toISOString() }) }); let starts = 0;
    const client = { async startActor() { starts += 1; throw new Error("socket reset"); } };
    const adapter = createApifyFirstFillAdapter({ rawEvidenceDir: dir, client, accountUsageGetter: async () => ({ billedUsd: 0, verifiedAt: new Date().toISOString() }) });
    await assert.rejects(adapter.run({ runKey: "unknown-1", maxTotalChargeUsd: 0.5, providerInput: {} }), /socket reset/);
    await assert.rejects(adapter.run({ runKey: "unknown-1", maxTotalChargeUsd: 0.5, providerInput: {} }), (error) => error.code === "start_reconciliation_required");
    assert.equal(starts, 1);
    const persisted = JSON.parse(await readFile(join(dir, "apify-runs.json"), "utf8"));
    assert.equal(persisted.runs["unknown-1"].startUnknown, true);
    const budget = JSON.parse(await readFile(join(dir, "apify-budget-ledger.json"), "utf8"));
    assert.equal(budget.reservations["apify:unknown-1"].status, "unknown");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("account reservations include prior trial spend and reject cap overflow", async () => {
  const dir = await tempDir();
  try {
    const ledger = new ApifyBudgetLedger({ rawEvidenceDir: dir, accountHardCapUsd: APIFY_ACCOUNT_HARD_CAP_USD, priorBilledUsd: APIFY_PRIOR_TRIAL_BILLED_USD, accountUsageGetter: async () => ({ billedUsd: 18.6, verifiedAt: new Date().toISOString() }) });
    await ledger.reserve({ reservationId: "r1", runKey: "one", reservedUsd: 0.3 });
    await assert.rejects(ledger.reserve({ reservationId: "r2", runKey: "two", reservedUsd: 0.2 }), (error) => error.code === "account_budget_exceeded");
    const snapshot = await ledger.snapshot();
    assert.equal(snapshot.billedUsd, 18.6);
    assert.equal(snapshot.reservedUsd, 0.3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("verified terminal cost replaces the full reservation while account usage remains conservative", async () => {
  const dir = await tempDir(); let billed = 0;
  try {
    const ledger = new ApifyBudgetLedger({ rawEvidenceDir: dir, priorBilledUsd: 0, accountUsageGetter: async () => ({ billedUsd: billed, verifiedAt: new Date().toISOString() }) });
    await ledger.reserve({ reservationId: "r1", runKey: "one", reservedUsd: 0.5 });
    await ledger.settle("r1", 0.2);
    assert.equal((await ledger.snapshot()).reservedUsd, 0.2);
    billed = 0.1;
    assert.equal((await ledger.snapshot()).reservedUsd, 0.2);
    billed = 0.2;
    assert.equal((await ledger.snapshot()).reservedUsd, 0.2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("account usage is fail-closed for absent, malformed, and stale receipts", async () => {
  const dir = await tempDir();
  try {
    for (const getter of [async () => undefined, async () => ({}), async () => ({ billedUsd: 1 }), async () => ({ billedUsd: 1, verifiedAt: "2020-01-01T00:00:00Z" })]) {
      const ledger = new ApifyBudgetLedger({ rawEvidenceDir: dir, accountUsageGetter: getter });
      await assert.rejects(ledger.reserve({ reservationId: `x-${Math.random()}`, runKey: "x", reservedUsd: 0.1 }), /account usage|fresh Apify|billed/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("overlapping verified costs replace caps without assuming account usage attribution", async () => {
  const dir = await tempDir(); let billed = 0;
  try {
    const ledger = new ApifyBudgetLedger({ rawEvidenceDir: dir, priorBilledUsd: 0, accountUsageGetter: async () => ({ billedUsd: billed, verifiedAt: new Date().toISOString() }) });
    await ledger.reserve({ reservationId: "a", runKey: "a", reservedUsd: 0.5 });
    await ledger.reserve({ reservationId: "b", runKey: "b", reservedUsd: 0.5 });
    await ledger.settle("a", 0.2); await ledger.settle("b", 0.3);
    billed = 0.2; assert.equal((await ledger.snapshot()).reservedUsd, 0.5);
    billed = 0.5; assert.equal((await ledger.snapshot()).reservedUsd, 0.5);
    await ledger.reserve({ reservationId: "c", runKey: "c", reservedUsd: 0.5 });
    await ledger.settle("c", 0.2);
    billed = 0.5; assert.equal((await ledger.snapshot()).reservedUsd, 0.7);
    billed = 0.7; assert.equal((await ledger.snapshot()).reservedUsd, 0.7);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("reusing a run key with changed input is rejected and a reached item cap is incomplete", async () => {
  const store = new Map(); const ledger = fakeLedger(); let starts = 0;
  const client = { async startActor() { starts += 1; return { id: "run-limit", defaultDatasetId: "d" }; }, async getRun() { return { id: "run-limit", status: "SUCCEEDED", defaultDatasetId: "d", usageTotalUsd: 0.0008, platformUsageBillingModel: "DEVELOPER", chargedEventCounts: { "apify-default-dataset-item": 1, "apify-actor-start": 1 } }; }, async getDatasetItems() { return [{ ad_archive_id: "1", page_id: "1", is_active: true, snapshot: { page_id: "1" }, pageInfo: { page_id: "1" } }]; } };
  const adapter = createApifyFirstFillAdapter({ client, store: { get: async (key) => store.get(key) ?? null, put: async (key, value) => store.set(key, value) }, ledger, pollIntervalMs: 0 });
  const first = await adapter.run({ runKey: "same", maxTotalChargeUsd: 0.5, maxItems: 1, providerInput: { q: "a" }, urls: [{ url: "https://www.facebook.com/1" }] });
  assert.equal(first.status, "SUCCEEDED_PARTIAL"); assert.equal(first.metadata.capHit, true);
  await assert.rejects(adapter.run({ runKey: "same", maxTotalChargeUsd: 0.5, maxItems: 1, providerInput: { q: "changed" }, urls: [{ url: "https://www.facebook.com/1" }] }), (error) => error.code === "run_input_conflict");
  assert.equal(starts, 1);
});

test("a successful provider run without a dataset is a failed outcome", async () => {
  const store = new Map(); const ledger = fakeLedger();
  const adapter = createApifyFirstFillAdapter({ client: { async startActor() { return { id: "no-dataset" }; }, async getRun() { return { id: "no-dataset", status: "SUCCEEDED", usageTotalUsd: 0.001 }; } }, store: { get: async (key) => store.get(key) ?? null, put: async (key, value) => store.set(key, value) }, ledger, pollIntervalMs: 0 });
  const result = await adapter.run({ runKey: "missing-dataset", providerInput: {}, urls: [{ url: "https://www.facebook.com/1" }] });
  assert.equal(result.status, "FAILED"); assert.equal(result.metadata.failureReason, "missing_dataset");
});

test("account usage uses Apify's documented monthly usage endpoint and schema", async () => {
  const urls = [];
  const client = new ApifyClient({ token: "test-token", fetchImpl: async (url) => { urls.push(String(url)); return new Response(JSON.stringify({ data: { usageCycle: { startAt: "2026-09-01T00:00:00.000Z", endAt: "2026-10-01T00:00:00.000Z" }, monthlyServiceUsage: {}, dailyServiceUsages: [], totalUsageCreditsUsdBeforeVolumeDiscount: 1.2, totalUsageCreditsUsdAfterVolumeDiscount: 1.1 } }), { status: 200, headers: { "content-type": "application/json" } }); } });
  const receipt = await client.getAccountUsage();
  assert.match(urls[0], /\/v2\/users\/me\/usage\/monthly$/);
  assert.equal(receipt.billedUsd, 1.1); assert.match(receipt.verifiedAt, /^20/);
});

test("file run store serializes concurrent writes without dropping a run", async () => {
  const dir = await tempDir();
  try {
    const { FileApifyRunStore } = await import("./ad-radar-apify-adapter.mjs");
    const store = new FileApifyRunStore(dir, { lockRetryMs: 1 });
    await Promise.all([store.put("a", { runId: "a" }), store.put("b", { runId: "b" })]);
    assert.deepEqual(await store.get("a"), { runId: "a" }); assert.deepEqual(await store.get("b"), { runId: "b" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("run cap is treated as incomplete even when the provider reports success-like data", async () => {
  const store = new Map(); const ledger = fakeLedger();
  const client = { async startActor() { return { id: "run-cap", defaultDatasetId: "d" }; }, async getRun() { return { id: "run-cap", status: "ABORTED", statusMessage: "Maximum total charge reached", defaultDatasetId: "d", usageTotalUsd: 0.0008, platformUsageBillingModel: "DEVELOPER", chargedEventCounts: { "apify-default-dataset-item": 1, "apify-actor-start": 1 } }; }, async getDatasetItems() { return [{ ad_archive_id: "1", page_id: "1", is_active: true, snapshot: { page_id: "1" }, pageInfo: { page_id: "1" } }]; } };
  const adapter = createApifyFirstFillAdapter({ client, store: { get: async (key) => store.get(key) ?? null, put: async (key, value) => store.set(key, value) }, ledger, pollIntervalMs: 0 });
  const result = await adapter.run({ runKey: "cap-1", maxTotalChargeUsd: 0.5, providerInput: {}, urls: [{ url: "https://www.facebook.com/1" }] });
  assert.equal(result.status, "SUCCEEDED_PARTIAL");
  assert.equal(result.paginationExhausted, false);
  assert.equal(result.coverageComplete, false);
  assert.equal(result.metadata.capHit, true);
});

function completeRows(count) {
  return Array.from({ length: count }, (_, index) => ({ ad_archive_id: String(index + 1), page_id: "1", is_active: true, snapshot: { page_id: "1" }, pageInfo: { page_id: "1" } }));
}

test("pre-dispatch persistence failure releases its reservation without starting an actor", async () => {
  const dir = await tempDir();
  try {
    const ledger = new ApifyBudgetLedger({ rawEvidenceDir: dir, priorBilledUsd: 0, accountUsageGetter: async () => ({ billedUsd: 0, verifiedAt: new Date().toISOString() }) });
    let starts = 0;
    const adapter = createApifyFirstFillAdapter({
      client: { async startActor() { starts += 1; } },
      store: { get: async () => null, put: async () => { throw new Error("disk unavailable"); } },
      ledger,
    });
    await assert.rejects(adapter.run({ runKey: "store-failure", maxTotalChargeUsd: 0.5, providerInput: {} }), /disk unavailable/);
    assert.equal(starts, 0);
    assert.equal((await ledger.snapshot()).reservedUsd, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("delayed charged events are reconciled after dataset load before settling actual cost", async () => {
  const store = new Map(); const ledger = fakeLedger(); let reads = 0;
  const client = {
    async startActor() { return { id: "delayed-events", defaultDatasetId: "d" }; },
    async getRun() {
      reads += 1; const items = reads === 1 ? 290 : 324;
      return { id: "delayed-events", status: "SUCCEEDED", defaultDatasetId: "d", platformUsageBillingModel: "DEVELOPER", usageTotalUsd: items * 0.00075 + 0.00005, chargedEventCounts: { "apify-default-dataset-item": items, "apify-actor-start": 1 } };
    },
    async getDatasetItems() { return completeRows(324); },
  };
  const adapter = createApifyFirstFillAdapter({ client, store: { get: async (key) => store.get(key) ?? null, put: async (key, value) => store.set(key, value) }, ledger, pollIntervalMs: 0, billingMaxPolls: 2 });
  const result = await adapter.run({ runKey: "delayed-events", maxTotalChargeUsd: 0.5, maxItems: 666, providerInput: {}, urls: [{ url: "https://www.facebook.com/1" }] });
  assert.equal(reads, 2);
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.costUsd, 0.24305);
  assert.equal(ledger.reservations.get("apify:delayed-events").settledUsd, 0.24305);
});

test("unreconciled terminal billing stays visible and retains the full cap without another dispatch", async () => {
  const store = new Map(); const ledger = fakeLedger(); let starts = 0;
  const client = {
    async startActor() { starts += 1; return { id: "billing-pending", defaultDatasetId: "d" }; },
    async getRun() { return { id: "billing-pending", status: "SUCCEEDED", defaultDatasetId: "d", platformUsageBillingModel: "DEVELOPER", usageTotalUsd: 0.21755, chargedEventCounts: { "apify-default-dataset-item": 290, "apify-actor-start": 1 } }; },
    async getDatasetItems() { return completeRows(324); },
  };
  const adapter = createApifyFirstFillAdapter({ client, store: { get: async (key) => store.get(key) ?? null, put: async (key, value) => store.set(key, value) }, ledger, pollIntervalMs: 0, billingMaxPolls: 2 });
  const input = { runKey: "billing-pending", maxTotalChargeUsd: 0.5, maxItems: 666, providerInput: {}, urls: [{ url: "https://www.facebook.com/1" }] };
  const first = await adapter.run(input);
  assert.equal(first.status, "FAILED");
  assert.equal(first.metadata.billingPending, true);
  assert.equal(first.metadata.billingFailureReason, "charged_dataset_items_pending");
  assert.equal(ledger.reservations.get("apify:billing-pending").status, "unknown");
  assert.equal(store.get("billing-pending").status, "billing_pending");
  assert.equal(store.get("billing-pending").outcome, undefined);
  await adapter.run(input);
  assert.equal(starts, 1);
});
