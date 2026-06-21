import assert from "node:assert/strict";
import test from "node:test";

import { computeDrainOverview, type DrainStage } from "../../src/lib/research/drain-status.ts";

function stage(overrides: Partial<DrainStage>): DrainStage {
  return {
    key: "blockwise-page-resolver",
    label: "Page resolver",
    live: { pending: 0, claimed: 0, failed: 0, blocked: 0 },
    firstFill: { pending: 0, claimed: 0, failed: 0, blocked: 0, complete: 0 },
    completedLastHour: 0,
    firstFillCompletedLastHour: 0,
    ...overrides,
  };
}

test("computeDrainOverview reports original first-fill progress and ETA", () => {
  const overview = computeDrainOverview([
    stage({
      live: { pending: 15, claimed: 5, failed: 0, blocked: 0 },
      firstFill: { pending: 10, claimed: 5, failed: 0, blocked: 0, complete: 85 },
      firstFillCompletedLastHour: 30,
    }),
  ]);

  assert.equal(overview.firstFillOpen, 15);
  assert.equal(overview.liveOpen, 20);
  assert.equal(overview.firstFillPercent, 85);
  assert.equal(overview.etaMinutes, 30);
  assert.equal(overview.readyForMaintain, false);
  assert.equal(overview.status, "draining");
});

test("computeDrainOverview distinguishes first-fill done from live maintain work", () => {
  const overview = computeDrainOverview([
    stage({
      live: { pending: 7, claimed: 0, failed: 0, blocked: 0 },
      firstFill: { pending: 0, claimed: 0, failed: 0, blocked: 0, complete: 100 },
    }),
  ]);

  assert.equal(overview.firstFillReady, true);
  assert.equal(overview.readyForMaintain, false);
  assert.equal(overview.status, "first_fill_done");
});

test("computeDrainOverview marks maintain-ready when the live gate is zero", () => {
  const overview = computeDrainOverview([
    stage({ firstFill: { pending: 0, claimed: 0, failed: 0, blocked: 0, complete: 10 } }),
  ]);

  assert.equal(overview.readyForMaintain, true);
  assert.equal(overview.status, "ready");
});
