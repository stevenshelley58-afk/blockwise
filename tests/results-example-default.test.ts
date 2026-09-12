import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { hasNoMetaConnection } from "../src/lib/meta-monitor/payload-state.ts";
import { buildSampleMetaMonitorPayload } from "../src/lib/meta-monitor/sampleMetaMonitorData.ts";
import type { MetaMonitorPayload } from "../src/lib/meta-monitor/types.ts";

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
