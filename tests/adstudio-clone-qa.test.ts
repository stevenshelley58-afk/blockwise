import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  parseCloneRegions,
} from "../src/lib/adstudio/clone-regions.ts";
import {
  compositeCloneRegionEdit,
  createCloneRegionEditMask,
  generateCloneWithCascade,
  normalizeCloneRenderAspect,
  persistCloneRender,
  renderExactCloneTextEdit,
} from "../src/lib/adstudio/clone-generation.ts";
import {
  fetchProviderRequest,
  ProviderRequestError,
  type ImageProviderAdapter,
} from "../src/lib/adstudio/providers.ts";
import {
  buildProviderRunAttempt,
  type executeAdStudioProviderAttempt,
  ProviderRunPersistenceError,
  runAuditAfterDurableAccounting,
} from "../src/lib/operator/prompts/redact-prompt-run.ts";

test("declared copy regions stay editable as text when vision misclassifies them", () => {
  const regions = parseCloneRegions([
    { key: "headline", kind: "image", box: { x: 0.2, y: 0.5, width: 0.6, height: 0.15 } },
    { key: "property_photo", kind: "image", box: { x: 0, y: 0, width: 1, height: 0.8 } },
  ], { headline: "NEW LISTING" });

  assert.equal(regions.find((region) => region.key === "headline")?.kind, "text");
  assert.equal(regions.find((region) => region.key === "property_photo")?.kind, "image");
});

function roundedBox(box: { x: number; y: number; width: number; height: number } | undefined) {
  assert.ok(box);
  return {
    x: Math.round(box.x * 1000),
    y: Math.round(box.y * 1000),
    width: Math.round(box.width * 1000),
    height: Math.round(box.height * 1000),
  };
}

test("native box_2d detections convert to fractional editor regions", () => {
  const regions = parseCloneRegions([
    { key: "headline", kind: "text", box_2d: [40, 70, 260, 530] },
    { key: "primary_image", kind: "image", box_2d: [0, 550, 1000, 1000] },
    { key: "price", kind: "text", box_2d: [440, 530, 290, 70] },
  ], { headline: "JUST LISTED", price: "$895,000" });

  assert.deepEqual(roundedBox(regions[0]?.box), { x: 70, y: 40, width: 460, height: 220 });
  assert.deepEqual(roundedBox(regions[1]?.box), { x: 550, y: 0, width: 450, height: 1000 });
  // Swapped min/max corners still produce a positive box.
  assert.deepEqual(roundedBox(regions[2]?.box), { x: 70, y: 290, width: 460, height: 150 });
});

test("box_2d answered as 0-1 fractions is not collapsed into the top-left corner", () => {
  const regions = parseCloneRegions([
    { key: "headline", kind: "text", box_2d: [0.04, 0.07, 0.26, 0.53] },
  ], { headline: "JUST LISTED" });

  assert.deepEqual(roundedBox(regions[0]?.box), { x: 70, y: 40, width: 460, height: 220 });
});

test("out-of-range and malformed box_2d values clamp instead of breaking the editor", () => {
  const regions = parseCloneRegions([
    { key: "headline", kind: "text", box_2d: [-50, 200, 1400, "oops"] },
  ], { headline: "JUST LISTED" });

  // ymin clamps to 0, ymax clamps to 1000; the malformed xmax coerces to 0 and
  // the swapped corners still yield x from the smaller value.
  assert.deepEqual(roundedBox(regions[0]?.box), { x: 0, y: 0, width: 200, height: 1000 });
});

test("provider-native portrait renders are cropped to exact Meta placement ratios", async () => {
  const { default: sharp } = await import("sharp");
  const nativePortrait = await sharp({
    create: {
      width: 96,
      height: 144,
      channels: 4,
      background: { r: 18, g: 62, b: 117, alpha: 1 },
    },
  }).png().toBuffer();
  const source = `data:image/png;base64,${nativePortrait.toString("base64")}`;

  const story = await normalizeCloneRenderAspect(source, "9:16");
  const feed = await normalizeCloneRenderAspect(source, "4:5");
  const storyMetadata = await sharp(Buffer.from(story.split(",")[1], "base64")).metadata();
  const feedMetadata = await sharp(Buffer.from(feed.split(",")[1], "base64")).metadata();

  assert.deepEqual(
    { width: storyMetadata.width, height: storyMetadata.height },
    { width: 864, height: 1536 },
  );
  assert.deepEqual(
    { width: feedMetadata.width, height: feedMetadata.height },
    { width: 1024, height: 1280 },
  );

  const nativeSameRatio = await sharp({
    create: {
      width: 800,
      height: 1000,
      channels: 4,
      background: { r: 18, g: 62, b: 117, alpha: 1 },
    },
  }).png().toBuffer();
  const exactFeed = await normalizeCloneRenderAspect(
    `data:image/png;base64,${nativeSameRatio.toString("base64")}`,
    "4:5",
  );
  const exactFeedMetadata = await sharp(Buffer.from(exactFeed.split(",")[1], "base64")).metadata();
  assert.deepEqual(
    { width: exactFeedMetadata.width, height: exactFeedMetadata.height },
    { width: 1024, height: 1280 },
  );
});

test("exact provider-hosted clone renders become owned bytes and persist to workspace storage", async () => {
  const { default: sharp } = await import("sharp");
  const providerBytes = await sharp({
    create: {
      width: 1024,
      height: 1280,
      channels: 4,
      background: { r: 18, g: 62, b: 117, alpha: 1 },
    },
  }).png().toBuffer();
  const fetchImpl = async () => new Response(new Uint8Array(providerBytes), {
    status: 200,
    headers: { "content-type": "image/png" },
  });

  const normalized = await normalizeCloneRenderAspect(
    "https://provider.example/temporary-render.png",
    "4:5",
    fetchImpl as typeof fetch,
  );
  assert.match(normalized, /^data:image\/png;base64,/);

  let uploadedPath = "";
  let uploadedBytes = 0;
  const stored = await persistCloneRender({
    supabase: {
      storage: {
        from(bucket: string) {
          assert.equal(bucket, "workspace-artifacts");
          return {
            async upload(path: string, bytes: Uint8Array, options: { contentType: string; upsert: boolean }) {
              uploadedPath = path;
              uploadedBytes = bytes.byteLength;
              assert.deepEqual(options, { contentType: "image/png", upsert: false });
              return { error: null };
            },
          };
        },
      },
    },
    workspaceId: "workspace_demo",
    assetUrl: normalized,
    fileNameSeed: "accepted-clone",
  });

  assert.equal(uploadedPath, "workspace_demo/adstudio/clones/accepted-clone.png");
  assert.ok(uploadedBytes > 0);
  assert.equal(stored, `/api/adstudio/media?path=${encodeURIComponent(uploadedPath)}`);
});

test("targeted edit masks preserve the full ad outside the selected QA region", async () => {
  const { default: sharp } = await import("sharp");
  const creative = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 4,
      background: { r: 18, g: 62, b: 117, alpha: 1 },
    },
  }).png().toBuffer();
  const source = `data:image/png;base64,${creative.toString("base64")}`;
  const mask = await createCloneRegionEditMask(source, { x: 0.4, y: 0.4, width: 0.2, height: 0.2 });

  assert.ok(mask);
  const { data, info } = await sharp(Buffer.from(mask.split(",")[1], "base64"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
  assert.equal(alphaAt(10, 10), 255, "pixels outside the edit region remain opaque");
  assert.equal(alphaAt(50, 50), 0, "pixels inside the edit region are transparent");
  assert.equal(await createCloneRegionEditMask(source), undefined);
});

test("targeted edits composite only the selected region onto the finished ad", async () => {
  const { default: sharp } = await import("sharp");
  const original = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 220, g: 20, b: 20, alpha: 1 } },
  }).png().toBuffer();
  const edited = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 20, g: 20, b: 220, alpha: 1 } },
  }).png().toBuffer();
  const result = await compositeCloneRegionEdit(
    `data:image/png;base64,${original.toString("base64")}`,
    `data:image/png;base64,${edited.toString("base64")}`,
    { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
  );
  const { data, info } = await sharp(Buffer.from(result.split(",")[1], "base64"))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgbAt = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3));
  assert.deepEqual(rgbAt(10, 10), [220, 20, 20], "outside pixels come from the original ad");
  assert.deepEqual(rgbAt(50, 50), [20, 20, 220], "inside pixels come from the model edit");
});

test("post-clone text edits typeset exact copy only inside the selected region", async () => {
  const { default: sharp } = await import("sharp");
  const source = await sharp({
    create: { width: 240, height: 120, channels: 4, background: { r: 190, g: 20, b: 20, alpha: 1 } },
  })
    .composite([{
      input: await sharp({
        create: { width: 120, height: 120, channels: 4, background: { r: 18, g: 62, b: 117, alpha: 1 } },
      }).png().toBuffer(),
      left: 0,
      top: 0,
    }])
    .png()
    .toBuffer();
  const result = await renderExactCloneTextEdit(
    `data:image/png;base64,${source.toString("base64")}`,
    "JUST LISTED TODAY",
    { x: 0, y: 0, width: 0.5, height: 1 },
  );
  const { data, info } = await sharp(Buffer.from(result.split(",")[1], "base64"))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgbAt = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3));
  assert.deepEqual(rgbAt(200, 60), [190, 20, 20], "pixels outside the selected text region stay unchanged");
  let lightPixels = 0;
  for (let y = 0; y < 120; y += 1) {
    for (let x = 0; x < 120; x += 1) {
      const [red, green, blue] = rgbAt(x, y);
      if (red > 220 && green > 220 && blue > 220) lightPixels += 1;
    }
  }
  assert.ok(lightPixels > 30, "the exact-copy finalizer paints readable high-contrast text in the region");
});

const executeAttempt = (async (input: Parameters<typeof executeAdStudioProviderAttempt>[0]) => {
  try {
    const output = await input.execute();
    return {
      ok: true as const,
      output,
      attempt: buildProviderRunAttempt({
        attemptIndex: input.attemptIndex,
        provider: input.provider,
        modelProfile: input.modelProfile,
        status: "completed",
        output,
      }),
    };
  } catch (error) {
    return {
      ok: false as const,
      error,
      attempt: buildProviderRunAttempt({
        attemptIndex: input.attemptIndex,
        provider: input.provider,
        modelProfile: input.modelProfile,
        status: "failed",
        error,
      }),
    };
  }
}) as typeof executeAdStudioProviderAttempt;

function accountedImageProvider(name: string, generate: ImageProviderAdapter["generate"]): ImageProviderAdapter {
  return {
    providerName: name,
    providerType: "image_generation",
    capabilities: { textToImage: true },
    accounting: {
      model: `${name}-model`,
      pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0, imageUsdPerUnit: 0.04 },
    },
    generate,
  };
}

function submittedProviderFailure(message: string, retryable: boolean): ProviderRequestError {
  return new ProviderRequestError(message, { requestSubmitted: true, retryable });
}

function finalRenderInput(providers: ImageProviderAdapter[]) {
  return {
    format: "4:5",
    providers,
    request: { prompt: "clone", referenceAssets: [], aspectRatio: "4:5", stylePreset: "test" },
    workspaceId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    correlationId: "final-render",
  };
}

async function finalRenderFunction() {
  const module = await import("../src/lib/adstudio/generate-template-campaign.ts");
  const fn = (module as Record<string, unknown>).generateFinalCloneRender;
  assert.equal(typeof fn, "function", "final clone render must be directly testable");
  const render = fn as (input: unknown, dependencies: Record<string, unknown>) => Promise<{ assetUrl: string }>;
  return (input: unknown, dependencies: Record<string, unknown> = {}) => render(input, {
    normalize: async (assetUrl: string) => assetUrl,
    ...dependencies,
  });
}

async function persistencePipelineFunction() {
  const module = await import("../src/lib/adstudio/generate-template-campaign.ts");
  const fn = (module as Record<string, unknown>).runClonePersistencePipeline;
  assert.equal(typeof fn, "function", "clone persistence pipeline must be directly testable");
  return fn as (input: unknown) => Promise<unknown>;
}

test("template campaign generation ships the render immediately with QA as advisory enrichment", () => {
  const pipeline = readFileSync("src/lib/adstudio/generate-template-campaign.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/clone-generation.ts", "utf8");

  // Each customer quality choice resolves through the model-profile registry;
  // neither path hardcodes a vendor or introduces a separate clone pipeline.
  assert.match(generation, /fast: "image_draft"/);
  assert.match(generation, /high: "image_final"/);
  assert.doesNotMatch(generation, /CloneTier|tier:/);
  assert.match(generation, /createImageProviderForCandidate/);
  assert.doesNotMatch(generation, /createOpenAiImageProvider\(\)/);
  assert.match(generation, /recordAdStudioProviderRun/);
  assert.match(generation, /output: result/);
  assert.match(pipeline, /resolveCloneProviders\(generationQuality\)/);
  assert.doesNotMatch(pipeline, /createFalImageProvider|fal-image-provider|FAL_KEY/);

  // The blocking QA gate is gone: no reroll corrections, no verification
  // failures that eat the customer's wait. The vision pass survives as
  // post-persist region detection that attaches editor regions.
  assert.match(pipeline, /enrichCloneCreativesWithRegions/);
  assert.doesNotMatch(pipeline, /cloneQaCorrectionPrompt/);
  assert.doesNotMatch(pipeline, /TemplateCampaignQaError/);
  assert.doesNotMatch(pipeline, /qa\.passed/);
});

test("durable accounting failure after provider success never dispatches a fallback", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const primary = accountedImageProvider("primary", async () => {
    primaryCalls += 1;
    return {
      assetUrl: "data:image/png;base64,b2s=",
      seed: 1,
      model: "primary-model",
      usage: { imageUnits: 1, complete: true },
      providerMetadata: {},
    };
  });
  const fallback = accountedImageProvider("fallback", async () => {
    fallbackCalls += 1;
    throw new Error("must not be called");
  });

  await assert.rejects(
    () => generateCloneWithCascade({
      providers: [primary, fallback],
      request: {
        prompt: "clone",
        referenceAssets: [],
        aspectRatio: "1:1",
        stylePreset: "test",
      },
      workspaceId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      correlationId: "accounting-rpc-failure",
      attempt: 1,
      accounting: {
        executeAttempt,
        recordRun: async () => {
          throw new ProviderRunPersistenceError("RPC transport failed");
        },
      },
    }),
    ProviderRunPersistenceError,
  );

  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 0);
});

test("clone generation does not fallback after a non-retryable provider failure", async () => {
  let fallbackCalls = 0;
  const primary = accountedImageProvider("primary", async () => {
    throw submittedProviderFailure("invalid request", false);
  });
  const fallback = accountedImageProvider("fallback", async () => {
    fallbackCalls += 1;
    return {
      assetUrl: "data:image/png;base64,b2s=",
      seed: 1,
      model: "fallback-model",
      usage: { imageUnits: 1, complete: true },
      providerMetadata: {},
    };
  });

  await assert.rejects(() => generateCloneWithCascade({
    providers: [primary, fallback],
    request: { prompt: "clone", referenceAssets: [], aspectRatio: "4:5", stylePreset: "test" },
    workspaceId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    correlationId: "non-retryable-clone",
    attempt: 1,
    accounting: { executeAttempt, recordRun: async () => {} },
  }), /invalid request/);

  assert.equal(fallbackCalls, 0);
});

test("clone generation falls back when a provider account is depleted", async () => {
  let fallbackCalls = 0;
  const primary = accountedImageProvider("primary", async () => {
    throw new ProviderRequestError("Insufficient credits", {
      requestSubmitted: true,
      retryable: false,
      fallbackEligible: true,
    });
  });
  const fallback = accountedImageProvider("fallback", async () => {
    fallbackCalls += 1;
    return {
      assetUrl: "data:image/png;base64,b2s=",
      seed: 1,
      model: "fallback-model",
      usage: { imageUnits: 1, complete: true },
      providerMetadata: {},
    };
  });

  const result = await generateCloneWithCascade({
    providers: [primary, fallback],
    request: { prompt: "clone", referenceAssets: [], aspectRatio: "4:5", stylePreset: "test" },
    workspaceId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    correlationId: "depleted-primary-clone",
    attempt: 1,
    accounting: { executeAttempt, recordRun: async () => {} },
  });

  assert.equal(result.provider, "fallback");
  assert.equal(fallbackCalls, 1);
});

test("clone generation invokes one fallback after a retryable provider failure", async () => {
  let fallbackCalls = 0;
  const primary = accountedImageProvider("primary", async () => {
    await fetchProviderRequest(
      async () => { throw new TypeError("connection reset"); },
      "https://provider.example/generate",
      { method: "POST" },
    );
    throw new Error("unreachable");
  });
  const fallback = accountedImageProvider("fallback", async () => {
    fallbackCalls += 1;
    return {
      assetUrl: "data:image/png;base64,b2s=",
      seed: 1,
      model: "fallback-model",
      usage: { imageUnits: 1, complete: true },
      providerMetadata: {},
    };
  });

  const result = await generateCloneWithCascade({
    providers: [primary, fallback],
    request: { prompt: "clone", referenceAssets: [], aspectRatio: "4:5", stylePreset: "test" },
    workspaceId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    correlationId: "retryable-clone",
    attempt: 1,
    accounting: { executeAttempt, recordRun: async () => {} },
  });

  assert.equal(result.provider, "fallback");
  assert.equal(fallbackCalls, 1);
});

test("clone generation does not fallback after a dispatched request is aborted", async () => {
  let fallbackCalls = 0;
  const primary = accountedImageProvider("primary", async () => {
    await fetchProviderRequest(
      async () => { throw new DOMException("cancelled", "AbortError"); },
      "https://provider.example/generate",
      { method: "POST" },
    );
    throw new Error("unreachable");
  });
  const fallback = accountedImageProvider("fallback", async () => {
    fallbackCalls += 1;
    throw new Error("must not be called");
  });

  await assert.rejects(() => generateCloneWithCascade({
    providers: [primary, fallback],
    request: { prompt: "clone", referenceAssets: [], aspectRatio: "4:5", stylePreset: "test" },
    workspaceId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    correlationId: "aborted-clone",
    attempt: 1,
    accounting: { executeAttempt, recordRun: async () => {} },
  }), /cancelled after dispatch/);

  assert.equal(fallbackCalls, 0);
});

test("clone generation never invokes a second fallback candidate", async () => {
  let thirdProviderCalls = 0;
  const failedProvider = (name: string) => accountedImageProvider(name, async () => {
    throw submittedProviderFailure(`${name} unavailable`, true);
  });
  const forbiddenThird = accountedImageProvider("third", async () => {
    thirdProviderCalls += 1;
    return {
      assetUrl: "data:image/png;base64,b2s=",
      seed: 1,
      model: "third-model",
      usage: { imageUnits: 1, complete: true },
      providerMetadata: {},
    };
  });

  await assert.rejects(() => generateCloneWithCascade({
    providers: [failedProvider("primary"), failedProvider("fallback"), forbiddenThird],
    request: { prompt: "clone", referenceAssets: [], aspectRatio: "4:5", stylePreset: "test" },
    workspaceId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    correlationId: "bounded-clone",
    attempt: 1,
    accounting: { executeAttempt, recordRun: async () => {} },
  }), /fallback unavailable/);

  assert.equal(thirdProviderCalls, 0);
});

test("final clone renders generate once, normalize to the exact ratio, and never wait on QA", async () => {
  const render = await finalRenderFunction();
  let generateCalls = 0;
  let normalizedFrom = "";

  const result = await render(finalRenderInput([]), {
    generate: async () => {
      generateCalls += 1;
      return {
        assetUrl: "data:image/png;base64,cmF3",
        model: "image-model",
        provider: "primary",
        providerAttemptCount: 1,
      };
    },
    normalize: async (assetUrl: string, format: string) => {
      normalizedFrom = `${assetUrl}:${format}`;
      return "data:image/png;base64,ZXhhY3Q=";
    },
  });

  assert.equal(generateCalls, 1);
  assert.equal(normalizedFrom, "data:image/png;base64,cmF3:4:5");
  assert.equal(result.assetUrl, "data:image/png;base64,ZXhhY3Q=");
});

test("provider cascade failures still fail the render honestly", async () => {
  const render = await finalRenderFunction();
  let providerCalls = 0;
  const failedProvider = (name: string) => accountedImageProvider(name, async () => {
    providerCalls += 1;
    throw submittedProviderFailure(`${name} unavailable`, true);
  });

  await assert.rejects(() => render(finalRenderInput([failedProvider("primary"), failedProvider("fallback")]), {
    generate: (input: Parameters<typeof generateCloneWithCascade>[0]) => generateCloneWithCascade({
      ...input,
      accounting: { executeAttempt, recordRun: async () => {} },
    }),
  }), /fallback unavailable/);

  assert.equal(providerCalls, 2);
});

test("renders and the campaign persist with no QA involvement at all", async () => {
  const pipeline = await persistencePipelineFunction();
  let clonePersistenceCalls = 0;
  let campaignPersistenceCalls = 0;

  const { campaign } = (await pipeline({
    formats: ["4:5", "9:16"],
    generateAccepted: async (format: string) => ({ assetUrl: `render-${format}` }),
    persistClone: async (format: string, generated: { assetUrl: string }) => {
      clonePersistenceCalls += 1;
      return { ...generated, image: `stored-${format}` };
    },
    buildCampaign: (byFormat: Record<string, { image: string }>) => ({
      images: [byFormat["4:5"]?.image, byFormat["9:16"]?.image],
    }),
    persistCampaign: async () => {
      campaignPersistenceCalls += 1;
    },
  })) as { campaign: { images: string[] } };

  assert.equal(clonePersistenceCalls, 2);
  assert.equal(campaignPersistenceCalls, 1);
  assert.deepEqual(campaign.images, ["stored-4:5", "stored-9:16"]);
});

test("post-commit audit failure is contained after durable accounting", async () => {
  let calls = 0;
  await runAuditAfterDurableAccounting(async () => {
    calls += 1;
    throw new Error("audit transport failed");
  });
  assert.equal(calls, 1);
});

test("targeted edit endpoint model-edits selected regions and verifies advisorily", () => {
  const route = readFileSync("src/app/api/adstudio/creatives/[id]/edit/route.ts", "utf8");
  const builder = readFileSync("src/lib/adstudio/reference-clone.ts", "utf8");

  // The anchor is the CURRENT creative image, never the template sample.
  assert.match(builder, /buildTargetedEditRequest/);
  assert.match(builder, /Keep every other pixel unchanged/);
  assert.match(route, /buildTargetedEditRequest/);
  assert.doesNotMatch(route, /canRenderTextDirectly/);
  assert.doesNotMatch(route, /renderExactCloneTextEdit/);
  assert.match(route, /resolveCloneProviders\("fast"\)/);
  assert.match(route, /maxDuration = 300/);

  // Expected copy carries the current value of every text field (from the
  // stored QA copy values) with the edited field overridden, so the model
  // does not drift unedited text while repainting the selected region.
  assert.match(route, /currentQa\?\.copyValues/);
  assert.match(route, /expectedCopy\[editFieldKey\] = newValue/);
  assert.match(route, /createCloneRegionEditMask/);
  // Crop-region edit: the model edits a padded window around the selected
  // region, then compositeRegionBack pastes only the box onto the original.
  assert.match(route, /cropRegionWithPadding/);
  assert.match(route, /compositeRegionBack/);
  assert.match(route, /capabilities\.inpainting/);

  // Edits and restores are saved revisions; a failed verdict never rejects a
  // save, and history is the safety net.
  assert.match(route, /renderHistory/);
  assert.match(route, /redoHistory/);
  assert.match(route, /action === "undo" \|\| action === "redo"/);
  assert.doesNotMatch(route, /qa && !qa\.passed/);
});

test("template generation persists unreviewed renders and defers verdicts to enrichment", () => {
  const builder = readFileSync("src/lib/adstudio/clone-campaign.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/generate-template-campaign.ts", "utf8");

  // The pack builder still carries a verdict when one exists (saved campaigns,
  // future callers), but generation no longer supplies one at build time.
  assert.match(builder, /cloneQa: input\.firstAd\.templateCloneQaByFormat\?\.\[format\]/);
  assert.doesNotMatch(generation, /templateCloneQaByFormat/);
  assert.doesNotMatch(generation, /TemplateCampaignQaError/);
  assert.match(generation, /enrichCloneCreativesWithRegions/);
  // Enrichment is per-creative and guarded: it never clobbers regions a
  // faster in-place edit already wrote.
  assert.match(generation, /existing\.regions\.length > 0\) return/);
});

test("provided copy updates metadata without creating a second image-generation path", () => {
  const enrichment = readFileSync("src/lib/adstudio/campaign-copy-enrichment.ts", "utf8");
  const scoring = readFileSync("src/lib/adstudio/scoring.ts", "utf8");

  assert.match(enrichment, /creatives: pack\.creatives/);
  assert.doesNotMatch(enrichment, /generateAdStudioCopy|Promise\.allSettled/);
  assert.doesNotMatch(scoring, /Provider run persistence failed[\s\S]*console\.warn/);
  assert.match(scoring, /if \(error instanceof ProviderRunPersistenceError\) throw error/);
});
