import assert from "node:assert/strict";
import test from "node:test";

import { buildResearchChatAnswer, summarizeCoverageRows } from "../src/lib/operator/research-chat.ts";

test("operator research chat tolerates deployed coverage views without audit score columns", () => {
  const rows = summarizeCoverageRows([
    {
      postcode: "6126",
      state: "WA",
      live_active_ads: 0,
      health: "never_audited",
    },
    {
      postcode: "6011",
      state: "WA",
      last_refreshed_at: "2026-06-04T00:00:00.000Z",
      live_active_ads: 0,
      health: "refresh_overdue",
    },
  ]);

  assert.deepEqual(rows, [
    {
      postcode: "6126",
      state: "WA",
      score: 0,
      activeAds: 0,
      advertiserPages: 0,
      health: "never_audited",
    },
    {
      postcode: "6011",
      state: "WA",
      score: 25,
      activeAds: 0,
      advertiserPages: 0,
      health: "refresh_overdue",
    },
  ]);
});

test("operator research chat falls back to health when deployed coverage views omit audit fields", () => {
  const rows = summarizeCoverageRows([
    {
      postcode: "6219",
      state: "WA",
      live_active_ads: 0,
      health: "healthy",
    },
    {
      postcode: "6000",
      state: "WA",
      live_active_ads: 0,
      health: "gap_known",
    },
  ]);

  assert.deepEqual(rows.map((row) => [row.postcode, row.score]), [
    ["6000", 15],
    ["6219", 100],
  ]);
});

test("operator research chat answer uses exact source counts", () => {
  assert.equal(
    buildResearchChatAnswer({
      coverageRows: 24,
      activeJobs: 15,
      failedJobs: 2,
      staleJobs: 1,
      defects: 735,
      skillFiles: 7,
      spend24h: 12.345,
    }),
    "24 coverage rows available from research.v_coverage_status. 15 active jobs, 2 failed or blocked jobs, 1 stale claims. 735 coverage defects are visible to the operator view. 7 Hermes skill files are available from hermes/skills. 24h collector spend is $12.35.",
  );
});
