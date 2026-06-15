import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { creativeSkeletonSchema } from "../src/lib/ad-template-library/skeleton.ts";

const fixture = JSON.parse(readFileSync("tests/fixtures/adstudio-template-engine-foundation.json", "utf8")) as {
  creativeSkeletons: unknown[];
  sampleGeneratedAd: unknown;
};

test("creative skeleton fixtures parse against the shared contract", () => {
  assert.ok(fixture.creativeSkeletons.length >= 5, "expected at least five skeleton fixtures");

  for (const skeleton of fixture.creativeSkeletons) {
    const parsed = creativeSkeletonSchema.parse(skeleton);
    assert.equal(parsed.version, 1);
    assert.ok(parsed.composition.copy_safe_zones.length > 0);
  }
});

test("creative skeleton rejects copy-safe zones outside the canvas", () => {
  const invalid = {
    ...(fixture.creativeSkeletons[0] as Record<string, unknown>),
    composition: {
      ...((fixture.creativeSkeletons[0] as { composition: Record<string, unknown> }).composition),
      copy_safe_zones: [{ id: "bad", x: 0.8, y: 0.1, width: 0.4, height: 0.2 }],
    },
  };

  assert.equal(creativeSkeletonSchema.safeParse(invalid).success, false);
});
