import assert from "node:assert/strict";
import test from "node:test";

import {
  createApifyRun,
  guardApifyBudget,
  ledgerCostFromApifyRunDetail,
  mapApifyDatasetItems,
  scoreApifyActor,
  selectCheapestApifyActor,
} from "../../hermes/tools/research-runtime/bin/apify-capture.mjs";

test("Apify run creation always sends maxTotalChargedUsd and an actor result cap", async () => {
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
  assert.equal(calls[0].url.searchParams.get("maxTotalChargedUsd"), "0.75");
  assert.equal(calls[0].url.searchParams.get("timeout"), "90");
  assert.equal(JSON.parse(calls[0].init.body).count, 50);

  assert.equal(calls[1].url.searchParams.get("maxTotalChargedUsd"), "1");
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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
