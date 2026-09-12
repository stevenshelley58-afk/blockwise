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
