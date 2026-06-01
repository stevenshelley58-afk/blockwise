import assert from "node:assert/strict";
import test from "node:test";

import { adRunningMs, formatAdDuration } from "../../src/lib/research/customer-meta-card.ts";

const DAY = 86_400_000;

test("adRunningMs returns null without a usable start date", () => {
  assert.equal(adRunningMs(null, null), null);
  assert.equal(adRunningMs("not-a-date", null), null);
});

test("adRunningMs measures an active ad from start until now", () => {
  const now = Date.parse("2026-06-01T00:00:00.000Z");
  assert.equal(adRunningMs("2026-05-02T00:00:00.000Z", null, now), 30 * DAY);
});

test("adRunningMs measures a stopped ad between start and stop", () => {
  const now = Date.parse("2026-06-01T00:00:00.000Z");
  assert.equal(adRunningMs("2026-04-01T00:00:00.000Z", "2026-04-13T00:00:00.000Z", now), 12 * DAY);
});

test("adRunningMs never returns a negative duration", () => {
  const now = Date.parse("2026-06-01T00:00:00.000Z");
  assert.equal(adRunningMs("2026-07-01T00:00:00.000Z", null, now), 0);
});

test("formatAdDuration labels a running ad", () => {
  assert.equal(formatAdDuration(61 * DAY, true), "61 days running");
  assert.equal(formatAdDuration(1 * DAY, true), "1 day running");
  assert.equal(formatAdDuration(0, true), "started today");
});

test("formatAdDuration labels a finished ad", () => {
  assert.equal(formatAdDuration(12 * DAY, false), "ran 12 days");
  assert.equal(formatAdDuration(0, false), "ran less than a day");
});
