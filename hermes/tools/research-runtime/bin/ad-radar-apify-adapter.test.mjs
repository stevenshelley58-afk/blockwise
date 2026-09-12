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
    { ad_archive_id: "a", page_id: "1" },
    { error_code: "ADS_NOT_FOUND", url: "https://www.facebook.com/2" },
    { ad_archive_id: "foreign", page_id: "9" },
  ], { urls: [{ url: "https://www.facebook.com/1" }, { url: "https://www.facebook.com/2" }, { url: "https://www.facebook.com/3" }] });
  assert.deepEqual(outcomes.map((item) => item.outcome), ["success", "ads_not_found", "failure", "mismatched_identity"]);
  assert.equal(outcomes.every((item) => item.trustedZero === false), true);
  assert.equal(outcomes.find((item) => item.pageId === "3").reason, "missing_page");
});

test("successful first fill returns the stable integration outcome and provider-enforced cap", async () => {
  const store = new Map(); const ledger = fakeLedger(); const starts = [];
  const client = {
    async startActor(args) { starts.push(args); return { id: "run-1", defaultDatasetId: "dataset-1" }; },
    async getRun() { return { id: "run-1", status: "SUCCEEDED", defaultDatasetId: "dataset-1", usageTotalUsd: 0.24305, platformUsageBillingModel: "DEVELOPER", chargedEventCounts: { "apify-default-dataset-item": 324, "apify-actor-start": 1 } }; },
    async getDatasetItems() { return [{ ad_archive_id: "a", page_id: "1", snapshot: { pageName: "One" } }]; },
  };
  const adapter = createApifyFirstFillAdapter({ client, store: { get: async (key) => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); } }, ledger, pollIntervalMs: 0 });
  const result = await adapter.run({ runKey: "fill-1", maxTotalChargeUsd: 0.5, maxItems: 666, urls: [{ url: "https://www.facebook.com/1" }], providerInput: { urls: [{ url: "https://www.facebook.com/1" }] } });
  assert.equal(starts.length, 1);
  assert.equal(starts[0].maxTotalChargeUsd, 0.5);
  assert.equal(starts[0].maxItems, 666);
  assert.equal(result.runId, "run-1");
  assert.equal(result.provider, `apify:${APIFY_ACTOR_ID}`);
  assert.equal(result.status, "succeeded");
  assert.equal(result.coverageComplete, true);
  assert.equal(result.costUsd, 0.24305);
  assert.equal(result.metadata.platformUsageBillingModel, "DEVELOPER");
});

test("unknown actor start is persisted and a retry never posts a second run", async () => {
  const dir = await tempDir();
  try {
    const ledger = new ApifyBudgetLedger({ rawEvidenceDir: dir, accountUsageGetter: async () => 0 }); let starts = 0;
    const client = { async startActor() { starts += 1; throw new Error("socket reset"); } };
    const adapter = createApifyFirstFillAdapter({ rawEvidenceDir: dir, client });
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
    const ledger = new ApifyBudgetLedger({ rawEvidenceDir: dir, accountHardCapUsd: APIFY_ACCOUNT_HARD_CAP_USD, priorBilledUsd: APIFY_PRIOR_TRIAL_BILLED_USD, accountUsageGetter: async () => 18.6 });
    await ledger.reserve({ reservationId: "r1", runKey: "one", reservedUsd: 0.3 });
    await assert.rejects(ledger.reserve({ reservationId: "r2", runKey: "two", reservedUsd: 0.2 }), (error) => error.code === "account_budget_exceeded");
    const snapshot = await ledger.snapshot();
    assert.equal(snapshot.billedUsd, 18.6);
    assert.equal(snapshot.reservedUsd, 0.3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("known spend keeps the full reservation until fresh account billing catches up", async () => {
  const dir = await tempDir(); let billed = 0;
  try {
    const ledger = new ApifyBudgetLedger({ rawEvidenceDir: dir, priorBilledUsd: 0, accountUsageGetter: async () => billed });
    await ledger.reserve({ reservationId: "r1", runKey: "one", reservedUsd: 0.5 });
    await ledger.settle("r1", 0.2);
    assert.equal((await ledger.snapshot()).reservedUsd, 0.5);
    billed = 0.1;
    assert.equal((await ledger.snapshot()).reservedUsd, 0.5);
    billed = 0.2;
    assert.equal((await ledger.snapshot()).reservedUsd, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("run cap is treated as incomplete even when the provider reports success-like data", async () => {
  const store = new Map(); const ledger = fakeLedger();
  const client = { async startActor() { return { id: "run-cap", defaultDatasetId: "d" }; }, async getRun() { return { id: "run-cap", status: "ABORTED", statusMessage: "Maximum total charge reached", defaultDatasetId: "d", usageTotalUsd: 0.5 }; }, async getDatasetItems() { return [{ ad_archive_id: "a", page_id: "1" }]; } };
  const adapter = createApifyFirstFillAdapter({ client, store: { get: async (key) => store.get(key) ?? null, put: async (key, value) => store.set(key, value) }, ledger, pollIntervalMs: 0 });
  const result = await adapter.run({ runKey: "cap-1", maxTotalChargeUsd: 0.5, providerInput: {}, urls: [{ url: "https://www.facebook.com/1" }] });
  assert.equal(result.status, "succeeded_partial");
  assert.equal(result.paginationExhausted, false);
  assert.equal(result.coverageComplete, false);
  assert.equal(result.metadata.capHit, true);
});
