import assert from "node:assert/strict";
import test from "node:test";

import { createFalImageProvider, falImageSizeForAspect } from "../src/lib/adstudio/fal-image-provider.ts";
import type { ImageProviderRequest } from "../src/lib/adstudio/providers.ts";

test("falImageSizeForAspect maps known aspects to multiples of 16", () => {
  for (const [aspect, size] of Object.entries({
    "4:5": { width: 1024, height: 1280 },
    "9:16": { width: 768, height: 1344 },
    "1:1": { width: 1024, height: 1024 },
  })) {
    const got = falImageSizeForAspect(aspect);
    assert.deepEqual(got, size);
    assert.equal(got.width % 16, 0);
    assert.equal(got.height % 16, 0);
  }
});

test("unknown aspect falls back to 4:5", () => {
  assert.deepEqual(falImageSizeForAspect("weird"), { width: 1024, height: 1280 });
});

test("generate throws a clear error when FAL_KEY is missing", async () => {
  const provider = createFalImageProvider({ env: {} });
  const req: ImageProviderRequest = {
    prompt: "x",
    referenceAssets: ["https://example.com/a.png"],
    aspectRatio: "4:5",
    stylePreset: "real_estate_clone",
    requiresReferenceAssets: true,
  };
  await assert.rejects(() => provider.generate(req), /FAL_KEY is not configured/);
});

test("generate requires at least one reference image", async () => {
  const provider = createFalImageProvider({ env: { FAL_KEY: "test-key" } });
  const req: ImageProviderRequest = {
    prompt: "x",
    referenceAssets: [],
    aspectRatio: "4:5",
    stylePreset: "real_estate_clone",
    requiresReferenceAssets: true,
  };
  await assert.rejects(() => provider.generate(req), /at least one reference image/);
});
