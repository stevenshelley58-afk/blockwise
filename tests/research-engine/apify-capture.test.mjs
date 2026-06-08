import assert from "node:assert/strict";
import test from "node:test";

import {
  apifyCircuitOpenUntilIso,
  createApifyRun,
  ensureApifyAccountLimit,
  evaluateApifyCircuitRecovery,
  guardApifyBudget,
  inferApifySchemaMap,
  ledgerCostFromApifyRunDetail,
  mapApifyDatasetItems,
  runApifyCapture,
  scoreApifyActor,
  selectCheapestApifyActor,
} from "../../hermes/tools/research-runtime/bin/apify-capture.mjs";

test("Apify run creation always sends maxTotalChargeUsd and an actor result cap", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(String(url)), init });
    return jsonResponse({ data: { id: `run-${calls.length}`, defaultDatasetId: "dataset-1" } });
  };

  await createApifyRun({
    actorId: "automly/facebook-ad-library-scraper",
    input: { searchUrl: "https://facebook.com/ads/library", count: 999 },
    maxTotalChargedUsd: 0.75,
    resultLimit: 50,
    timeoutSecs: 90,
    fetchImpl,
  });
  await createApifyRun({
    actorId: "constructive_calm/facebook-ad-library-pro",
    input: { searchUrl: "https://facebook.com/ads/library" },
    fetchImpl,
  });

  assert.equal(calls[0].url.pathname, "/v2/acts/automly~facebook-ad-library-scraper/runs");
  assert.equal(calls[0].url.searchParams.get("maxTotalChargeUsd"), "0.75");
  assert.equal(calls[0].url.searchParams.get("timeout"), "90");
  assert.equal(JSON.parse(calls[0].init.body).count, 50);

  assert.equal(calls[1].url.searchParams.get("maxTotalChargeUsd"), "1");
  assert.equal(JSON.parse(calls[1].init.body).maxResults, 250);

  await assert.rejects(
    () => createApifyRun({
      actorId: "automly/facebook-ad-library-scraper",
      input: {},
      maxTotalChargedUsd: 0,
      fetchImpl,
    }),
    /maxTotalChargedUsd must be a positive number/u,
  );
});

test("Apify budget guard fails closed when the paid account state cannot be verified", async () => {
  const result = await guardApifyBudget({
    ledgerSpendUsd: 0,
    fetchImpl: async () => jsonResponse({ error: { message: "Apify unavailable" } }, 503),
  });

  assert.equal(result.allowed, false);
  assert.equal(result.failClosed, true);
  assert.equal(result.reason, "apify_limits_unavailable");
});

test("Apify budget guard meters pipeline ledger spend separately from old account spend", async () => {
  const result = await guardApifyBudget({
    ledgerSpendUsd: 0,
    settings: {
      apify_monthly_cap_usd: 25,
      apify_account_limit_usd: 300,
    },
    limits: {
      monthlyUsageUsd: 219.93,
      maxMonthlyUsageUsd: 300,
    },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, "within_budget");
  assert.equal(result.spendUsd, 0);
  assert.equal(result.apifyReportedUsageUsd, 219.93);
});

test("Apify account limit check tolerates rejected lower-limit updates", async () => {
  const calls = [];
  const result = await ensureApifyAccountLimit({
    settings: { apify_account_limit_usd: 30 },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      if (init.method === "GET") {
        return jsonResponse({
          data: {
            current: { monthlyUsageUsd: 219.93 },
            limits: { maxMonthlyUsageUsd: 250 },
          },
        });
      }
      return jsonResponse({ error: { message: "cannot lower limit" } }, 400);
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(result.updated, false);
  assert.equal(result.updateFailed, true);
  assert.equal(result.warning, "account_limit_lowering_rejected");
  assert.equal(result.maxMonthlyUsageUsd, 250);
  assert.equal(result.desiredMaxMonthlyUsageUsd, 30);
});

test("Apify budget guard opens the circuit at local cap or account backstop", async () => {
  const sideEffects = [];
  const localCap = await guardApifyBudget({
    ledgerSpendUsd: 25,
    settings: {
      apify_monthly_cap_usd: 25,
      apify_account_limit_usd: 300,
    },
    limits: {
      monthlyUsageUsd: 100,
      maxMonthlyUsageUsd: 300,
    },
    setRuntimeSetting: async (...args) => sideEffects.push(args),
  });

  assert.equal(localCap.allowed, false);
  assert.equal(localCap.reason, "apify_budget_cap");
  assert.equal(localCap.limitType, "local_monthly_cap");
  assert.equal(localCap.circuitOpen, true);

  const accountBackstop = await guardApifyBudget({
    ledgerSpendUsd: 0,
    settings: {
      apify_monthly_cap_usd: 25,
      apify_account_limit_usd: 300,
    },
    limits: {
      monthlyUsageUsd: 270,
      maxMonthlyUsageUsd: 300,
    },
  });

  assert.equal(accountBackstop.allowed, false);
  assert.equal(accountBackstop.reason, "apify_budget_cap");
  assert.equal(accountBackstop.limitType, "account_backstop");
  assert.equal(accountBackstop.accountBackstopThresholdUsd, 270);
});

test("Apify ledger cost is extracted from run detail", () => {
  const ledger = ledgerCostFromApifyRunDetail({
    data: {
      id: "run-1",
      actId: "automly/facebook-ad-library-scraper",
      usageTotalUsd: 0.42,
      chargedEventCounts: { DATASET_ITEM: 84 },
    },
  });

  assert.equal(ledger.cost_usd, 0.42);
  assert.equal(ledger.result_summary.provider, "apify:automly/facebook-ad-library-scraper");
  assert.equal(ledger.result_summary.apify_run_id, "run-1");
  assert.deepEqual(ledger.result_summary.charged_event_counts, { DATASET_ITEM: 84 });
});

test("Apify actor selection never chooses a banned actor", () => {
  const banned = {
    actor_id: "apify/facebook-ads-scraper",
    status: "approved",
    last_benchmark: { valid_ad_count: 100, cost_usd: 0.01, failure_rate: 0, duplicate_ratio: 0, mapping_pass_rate: 1 },
  };
  const selected = selectCheapestApifyActor([
    banned,
    {
      actor_id: "automly/facebook-ad-library-scraper",
      status: "approved",
      last_benchmark: { valid_ad_count: 20, cost_usd: 0.2, failure_rate: 0, duplicate_ratio: 0, mapping_pass_rate: 1 },
    },
  ]);

  assert.equal(scoreApifyActor(banned).reason, "banned");
  assert.equal(selected.actorId, "automly/facebook-ad-library-scraper");
});

test("Apify actor selection chooses the cheapest passing approved actor", () => {
  const selected = selectCheapestApifyActor([
    {
      actor_id: "constructive_calm/facebook-ad-library-pro",
      status: "approved",
      last_benchmark: { valid_ad_count: 50, cost_usd: 0.2, failure_rate: 0, duplicate_ratio: 0.02, mapping_pass_rate: 0.99 },
    },
    {
      actor_id: "automly/facebook-ad-library-scraper",
      status: "approved",
      last_benchmark: { valid_ad_count: 50, cost_usd: 0.05, failure_rate: 0, duplicate_ratio: 0.02, mapping_pass_rate: 0.99 },
    },
    {
      actor_id: "curious_coder/facebook-ads-library-scraper",
      status: "candidate",
      last_benchmark: { valid_ad_count: 50, cost_usd: 0.01, failure_rate: 0, duplicate_ratio: 0.02, mapping_pass_rate: 0.99 },
    },
  ]);

  assert.equal(selected.actorId, "automly/facebook-ad-library-scraper");
  assert.equal(selected.score.costPerValidAdUsd, 0.001);
});

test("Apify schema_map fails capture when required-field mapping failures exceed 5%", async () => {
  const rawItems = Array.from({ length: 20 }, (_, index) => ({
    ad: { id: `ad-${index}` },
    page: { id: "page-1" },
    body: "Book a property appraisal this week.",
  }));
  rawItems[0].ad.id = "";
  rawItems[1].ad.id = "";

  let evidence = null;
  await assert.rejects(
    () => mapApifyDatasetItems({
      actorId: "automly/facebook-ad-library-scraper",
      items: rawItems,
      schemaMap: {
        external_ad_id: "ad.id",
        page_id: "page.id",
        creative_text: "body",
      },
      writeRawEvidence: async (payload) => {
        evidence = payload;
      },
    }),
    /schema_map failed/u,
  );

  assert.equal(evidence.provider, "apify:automly/facebook-ad-library-scraper");
  assert.equal(evidence.rawItemCount, 20);
  assert.equal(evidence.failedCount, 2);
  assert.equal(evidence.failureRate, 0.1);
});

test("Apify capture preserves run cost when dataset mapping fails after a charged run", async () => {
  const fetchImpl = async (url, init) => {
    const href = String(url);
    if (href.includes("/acts/")) {
      return jsonResponse({ data: { id: "run-1", defaultDatasetId: "dataset-1" } });
    }
    if (href.includes("/actor-runs/run-1")) {
      return jsonResponse({
        data: {
          id: "run-1",
          status: "SUCCEEDED",
          defaultDatasetId: "dataset-1",
          usageTotalUsd: 0.05,
          chargedEventCounts: { "actor-start": 1 },
        },
      });
    }
    if (href.includes("/datasets/dataset-1/items")) {
      return jsonResponse([{ ad: { id: "" }, page: { id: "" }, body: "" }]);
    }
    throw new Error(`unexpected ${init.method} ${href}`);
  };

  await assert.rejects(
    () => runApifyCapture({
      actorId: "automly/facebook-ad-library-scraper",
      input: { urls: ["https://www.facebook.com/ads/library/?id=123"] },
      schemaMap: {
        external_ad_id: "ad.id",
        page_id: "page.id",
        creative_text: "body",
      },
      fetchImpl,
      pollOptions: { intervalMs: 1, timeoutMs: 100 },
    }),
    (error) => {
      assert.equal(error.details.costUsd, 0.05);
      assert.equal(error.details.runId, "run-1");
      assert.equal(error.details.rawDatasetId, "dataset-1");
      return /schema_map failed/u.test(error.message);
    },
  );
});

test("Apify capture wraps plain post-run failures with charged run cost", async () => {
  const fetchImpl = async (url, init) => {
    const href = String(url);
    if (href.includes("/acts/")) {
      return jsonResponse({ data: { id: "run-1", defaultDatasetId: "dataset-1" } });
    }
    if (href.includes("/actor-runs/run-1")) {
      return jsonResponse({
        data: {
          id: "run-1",
          status: "SUCCEEDED",
          defaultDatasetId: "dataset-1",
          usageTotalUsd: 0.05,
          chargedEventCounts: { "actor-start": 1 },
        },
      });
    }
    if (href.includes("/datasets/dataset-1/items")) {
      throw new Error("dataset network timeout");
    }
    throw new Error(`unexpected ${init.method} ${href}`);
  };

  await assert.rejects(
    () => runApifyCapture({
      actorId: "automly/facebook-ad-library-scraper",
      input: { urls: ["https://www.facebook.com/ads/library/?id=123"] },
      fetchImpl,
      pollOptions: { intervalMs: 1, timeoutMs: 100 },
    }),
    (error) => {
      assert.equal(error.details.costUsd, 0.05);
      assert.equal(error.details.runId, "run-1");
      assert.equal(error.details.rawDatasetId, "dataset-1");
      return /failed after actor run/u.test(error.message);
    },
  );
});

test("Apify schema_map inference maps common actor result shapes", async () => {
  const rawItems = [
    {
      adArchiveID: "123456789012345",
      pageID: "998877665544332",
      pageName: "Example Realty",
      body: "Just listed in Perth with home opens this weekend.",
      imageUrl: "https://example.com/ad.jpg",
      linkUrl: "https://example.com/property",
      adSnapshotUrl: "https://www.facebook.com/ads/library/?id=123456789012345",
    },
    {
      ad: { id: "223456789012345" },
      page: { id: "998877665544332", name: "Example Realty" },
      creative: { text: "Property appraisal campaign for Perth homeowners.", media_url: "https://example.com/ad2.jpg" },
    },
  ];

  const schemaMap = inferApifySchemaMap(rawItems);
  const mapped = await mapApifyDatasetItems({
    actorId: "automly/facebook-ad-library-scraper",
    items: rawItems,
    schemaMap,
  });

  assert.equal(schemaMap.inferred, true);
  assert.deepEqual(schemaMap.fields.external_ad_id, { paths: ["adArchiveID", "ad.id"] });
  assert.deepEqual(schemaMap.fields.page_id, { paths: ["pageID", "page.id"] });
  assert.equal(mapped.items.length, 2);
  assert.equal(mapped.metadata.mapping_failure_rate, 0);
  assert.equal(mapped.items[0].external_ad_id, "123456789012345");
  assert.equal(mapped.items[1].external_ad_id, "223456789012345");
});

test("Apify circuit recovery waits for the cooldown window then auto-recovers", () => {
  const base = {
    apify_state: "circuit_open",
    apify_monthly_cap_usd: 25,
    apify_circuit_open_until: new Date(10_000).toISOString(),
  };

  const cooling = evaluateApifyCircuitRecovery(base, { now: 5_000, monthlySpendUsd: 0 });
  assert.equal(cooling.recover, false);
  assert.equal(cooling.reason, "cooling_down");

  const recovered = evaluateApifyCircuitRecovery(base, { now: 20_000, monthlySpendUsd: 0 });
  assert.equal(recovered.recover, true);
  assert.equal(recovered.reason, "cooldown_elapsed");
});

test("Apify circuit recovery heals legacy opens that carry no cooldown stamp", () => {
  const legacy = { apify_state: "circuit_open", apify_monthly_cap_usd: 25 };
  const decision = evaluateApifyCircuitRecovery(legacy, { monthlySpendUsd: 1.5 });
  assert.equal(decision.recover, true);
  assert.equal(decision.reason, "no_cooldown_recorded");
});

test("Apify circuit recovery never overrides the monthly spend cap", () => {
  const atCap = {
    apify_state: "circuit_open",
    apify_monthly_cap_usd: 25,
    apify_circuit_open_until: new Date(0).toISOString(),
  };
  const decision = evaluateApifyCircuitRecovery(atCap, { now: 1_000, monthlySpendUsd: 25 });
  assert.equal(decision.recover, false);
  assert.equal(decision.reason, "monthly_cap_reached");
});

test("Apify circuit recovery is a no-op when the circuit is already closed", () => {
  const decision = evaluateApifyCircuitRecovery({ apify_state: "ready" });
  assert.equal(decision.recover, false);
  assert.equal(decision.reason, "circuit_not_open");
});

test("apifyCircuitOpenUntilIso stamps a future resume time from the cooldown window", () => {
  assert.equal(apifyCircuitOpenUntilIso(0, 60_000), new Date(60_000).toISOString());
  assert.equal(Date.parse(apifyCircuitOpenUntilIso(1_000_000, 3_600_000)), 1_000_000 + 3_600_000);
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
