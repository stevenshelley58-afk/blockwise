import assert from "node:assert/strict";
import test from "node:test";

import {
  createMockProviderAdapter,
  listProviderSyncSummaries,
} from "../src/modules/providers/mock-adapters.ts";

test("mock provider adapters return deterministic reporting snapshots", async () => {
  const meta = createMockProviderAdapter("meta");
  const google = createMockProviderAdapter("google");

  const [metaSnapshot, googleSnapshot] = await Promise.all([
    meta.getReportingSnapshot("workspace_demo"),
    google.getReportingSnapshot("workspace_demo"),
  ]);

  assert.equal(metaSnapshot.provider, "meta");
  assert.equal(metaSnapshot.metrics.spendAud, 1840);
  assert.equal(metaSnapshot.metrics.leads, 92);
  assert.equal(googleSnapshot.provider, "google");
  assert.equal(googleSnapshot.metrics.cplAud, 41.5);
});

test("listProviderSyncSummaries exposes Meta and Google connection state", async () => {
  const summaries = await listProviderSyncSummaries("workspace_demo");

  assert.deepEqual(
    summaries.map((summary) => `${summary.provider}:${summary.status}`),
    ["meta:connected", "google:needs_attention"],
  );
});
