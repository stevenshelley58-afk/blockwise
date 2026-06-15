import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSkeletonGenerationContext, buildSkeletonMaskSvgDataUrl } from "../src/lib/adstudio/skeleton-to-prompt.ts";
import { creativeSkeletonSchema } from "../src/lib/ad-template-library/skeleton.ts";

const fixture = JSON.parse(readFileSync("tests/fixtures/adstudio-template-engine-foundation.json", "utf8")) as {
  creativeSkeletons: unknown[];
};
const skeleton = creativeSkeletonSchema.parse(fixture.creativeSkeletons[1]);

test("buildSkeletonGenerationContext emits skeleton brief before layout fallback", () => {
  const context = buildSkeletonGenerationContext(skeleton, {
    format: "4:5",
    fallbackBrief: "Fallback geometry brief.",
  });

  assert.match(context.brief, /Creative skeleton/);
  assert.match(context.brief, /market_stat/);
  assert.match(context.brief, /copy-safe zones/);
  assert.match(context.brief, /Fallback geometry brief/);
  assert.match(context.copySafeZoneSummary, /stat-panel/);
});

test("buildSkeletonMaskSvgDataUrl maps normalized zones into format canvas pixels", () => {
  const mask = buildSkeletonMaskSvgDataUrl(skeleton, "4:5");
  const decoded = decodeURIComponent(mask.replace("data:image/svg+xml,", ""));

  assert.match(decoded, /width="1080" height="1350"/);
  assert.match(decoded, /<rect x="97" y="189" width="562" height="783" fill="white"\/>/);
});
