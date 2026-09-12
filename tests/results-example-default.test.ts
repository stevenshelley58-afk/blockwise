import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { hasNoMetaConnection } from "../src/lib/meta-monitor/payload-state.ts";
import { buildSampleMetaMonitorPayload } from "../src/lib/meta-monitor/sampleMetaMonitorData.ts";
import type { MetaMonitorPayload } from "../src/lib/meta-monitor/types.ts";
import {
  HOME_REPORTING_RANGE,
  RESULTS_DEFAULT_RANGE,
  WARMED_REPORTING_RANGES,
} from "../src/lib/monitor/dashboard-data.ts";

const range = "last_30" as const;

test("only a missing Meta connection counts as the connect decision", () => {
  const disconnected = buildSampleMetaMonitorPayload({ range, connected: false });
  assert.equal(hasNoMetaConnection(disconnected), true);

  // A connected account with no ads in range also carries sample data, but the
  // account is connected: that is not a connect decision.
  const connectedNoAds = buildSampleMetaMonitorPayload({ range, connected: true });
  assert.equal(hasNoMetaConnection(connectedNoAds), false);

  const live: MetaMonitorPayload = { ...connectedNoAds, source: "live" };
  assert.equal(hasNoMetaConnection(live), false);
});

test("Results opens the example report when nothing is connected", async () => {
  const page = await readFile(
    new URL("../src/app/(customer)/results/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    page,
    /const showExample = explicitExample \|\| hasNoMetaConnection\(reporting\.snapshot\.payload\)/,
  );
  assert.match(page, /key=\{showExample \? "example" : "live"\}/);
  assert.match(page, /showExample=\{showExample\}/);
});

test("Results opens on the same week Home's figure row shows", async () => {
  const page = await readFile(
    new URL("../src/app/(customer)/results/page.tsx", import.meta.url),
    "utf8",
  );

  // One constant decides what Results opens on: the snapshot it loads, the
  // refresh it queues and the example it builds all name the same range, and no
  // range of its own is hardcoded.
  assert.equal(RESULTS_DEFAULT_RANGE, "last_7");
  assert.equal((page.match(/range: RESULTS_DEFAULT_RANGE/g) ?? []).length, 3);
  assert.doesNotMatch(page, /range: "last_(7|30)"/);
  // A page that opened on a range nobody keeps warm would park every connected
  // workspace on its fallback until the next scheduled pass.
  assert.ok(WARMED_REPORTING_RANGES.includes(RESULTS_DEFAULT_RANGE));
  assert.ok(WARMED_REPORTING_RANGES.includes(HOME_REPORTING_RANGE));
});

test("the example report follows the range the customer picks", () => {
  const now = new Date("2026-09-06T08:00:00.000Z");
  const build = (input: Parameters<typeof buildSampleMetaMonitorPayload>[0]) =>
    buildSampleMetaMonitorPayload({ now, connected: false, ...input });

  // The Results date selector offers 1 day, 7 days, 30 days and a custom span,
  // and the demo has to answer each one rather than showing a fixed month.
  assert.equal(build({ range: "today" }).daily.length, 1);
  assert.equal(build({ range: "last_7" }).daily.length, 7);
  assert.equal(build({ range: "last_30" }).daily.length, 30);

  const custom = build({ range: "custom", customRange: { since: "2026-08-20", until: "2026-08-24" } });
  assert.equal(custom.daily.length, 5);
  assert.equal(custom.range.since, "2026-08-20");
  assert.equal(custom.range.until, "2026-08-24");
  // The sample never outgrows the 30 days it holds, whatever window is asked for.
  assert.equal(
    build({ range: "custom", customRange: { since: "2026-01-01", until: "2026-08-24" } }).daily.length,
    30,
  );
});
