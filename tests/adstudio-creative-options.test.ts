import assert from "node:assert/strict";
import test from "node:test";

import { clampOptionCount, generateCreativeOptions } from "../src/lib/adstudio/creative-options.ts";
import type { ImageProviderAdapter, ImageProviderRequest, ImageProviderResponse } from "../src/lib/adstudio/providers.ts";

function imageProvider(
  name: string,
  behavior: (seed: number) => ImageProviderResponse,
): ImageProviderAdapter {
  return {
    providerName: name,
    providerType: "image_generation",
    capabilities: { textToImage: true, imageToImage: true, multiReference: true },
    async generate(input: ImageProviderRequest): Promise<ImageProviderResponse> {
      return behavior(input.seed ?? 0);
    },
  };
}

const baseInput: ImageProviderRequest = {
  prompt: "Generate an alternative real estate creative",
  referenceAssets: ["data:image/png;base64,aW1hZ2U="],
  aspectRatio: "9:16",
  stylePreset: "real_estate_photography",
  requiresReferenceAssets: true,
  seed: 0,
};

test("clampOptionCount clamps to 1..4 and defaults to 3", () => {
  assert.equal(clampOptionCount(undefined), 3);
  assert.equal(clampOptionCount(Number.NaN), 3);
  assert.equal(clampOptionCount(0), 1);
  assert.equal(clampOptionCount(99), 4);
  assert.equal(clampOptionCount(2), 2);
});

test("generateCreativeOptions fans out N options with distinct seeds", async () => {
  const seen: number[] = [];
  const provider = imageProvider("openai", (seed) => {
    seen.push(seed);
    return { assetUrl: `data:image/png;base64,opt${seed}`, seed, model: "gpt-image-2", providerMetadata: {} };
  });

  const result = await generateCreativeOptions({
    providers: [provider],
    imageInput: baseInput,
    copyText: "Thinking of selling in Scarborough?",
    count: 3,
  });

  assert.equal(result.options.length, 3);
  assert.deepEqual([...result.options.map((o) => o.seed)].sort((a, b) => a - b), [1, 2, 3]);
  assert.ok(result.options.every((o) => o.provider === "openai"));
  assert.equal(result.compliance.pass, true);
});

test("generateCreativeOptions cascades to the next provider when one fails", async () => {
  const failing = imageProvider("openai", () => {
    throw new Error("rate limited");
  });
  const working = imageProvider("openrouter", (seed) => ({
    assetUrl: "data:image/png;base64,ok",
    seed,
    model: "google/nano",
    providerMetadata: {},
  }));

  const result = await generateCreativeOptions({
    providers: [failing, working],
    imageInput: baseInput,
    copyText: "clean copy",
    count: 2,
  });

  assert.equal(result.options.length, 2);
  assert.ok(result.options.every((o) => o.provider === "openrouter"));
  assert.ok(result.attempts.some((a) => a.provider === "openai" && a.status === "failed"));
  assert.ok(result.attempts.some((a) => a.provider === "openrouter" && a.status === "completed"));
});

test("generateCreativeOptions returns no options when every provider fails (but still reports attempts + compliance)", async () => {
  const failing = imageProvider("openai", () => {
    throw new Error("down");
  });

  const result = await generateCreativeOptions({
    providers: [failing],
    imageInput: baseInput,
    copyText: "clean copy",
    count: 2,
  });

  assert.equal(result.options.length, 0);
  assert.equal(result.attempts.filter((a) => a.status === "failed").length, 2);
  assert.equal(result.compliance.pass, true);
});

test("generateCreativeOptions treats an empty assetUrl as a failure", async () => {
  const empty = imageProvider("openai", (seed) => ({ assetUrl: "", seed, model: "m", providerMetadata: {} }));

  const result = await generateCreativeOptions({
    providers: [empty],
    imageInput: baseInput,
    copyText: "clean copy",
    count: 1,
  });

  assert.equal(result.options.length, 0);
});

test("generateCreativeOptions re-triggers the compliance gate on the copy", async () => {
  const provider = imageProvider("openai", (seed) => ({
    assetUrl: "data:image/png;base64,ok",
    seed,
    model: "gpt-image-2",
    providerMetadata: {},
  }));

  const result = await generateCreativeOptions({
    providers: [provider],
    imageInput: baseInput,
    copyText: "Guaranteed price for your home, last chance!",
    count: 1,
  });

  assert.equal(result.options.length, 1, "image still generates");
  assert.equal(result.compliance.pass, false, "but compliance flags the banned copy");
  assert.ok(result.compliance.issues.some((issue) => issue.code === "guaranteed_price"));
  assert.ok(result.compliance.issues.some((issue) => issue.code === "fake_scarcity"));
});
