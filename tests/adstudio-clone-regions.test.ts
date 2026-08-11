import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  buildPrebuiltTemplateCloneQa,
  parseCloneRegions,
} from "../src/lib/adstudio/clone-regions.ts";
import {
  AD_STUDIO_TEMPLATES,
  RESOLVABLE_AD_STUDIO_TEMPLATES,
} from "../src/lib/adstudio/templates.ts";
import {
  compositeCloneRegionEdit,
  createCloneRegionEditMask,
  generateCloneWithCascade,
  normalizeCloneRenderAspect,
  persistCloneRender,
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

test("native-format editor regions come from the offline template build without vision", () => {
  const template = AD_STUDIO_TEMPLATES.find((entry) => entry.id === "meta-feed-018")!;
  const copy = {
    headline_number: "5",
    headline_main: "SMART FIRST STEPS",
    headline_sub: "Before Buying a Home",
    contact_handle: "@homeguide.example",
  };
  const feedQa = buildPrebuiltTemplateCloneQa(template, copy, "4:5");
  assert.ok(feedQa);
  assert.deepEqual(feedQa.copyValues, copy);
  const expectedRegionKeys = [
    ...template.inputs.text
      .filter((field) => Boolean(template.typography?.[field.key]?.sampleBox))
      .map((field) => field.key),
    ...template.inputs.images
      .filter((field) => Boolean(template.deterministicEditing?.imageBoxes[field.key]))
      .map((field) => field.key),
  ];
  assert.deepEqual(
    feedQa.regions.map((region) => region.key),
    expectedRegionKeys,
  );
  assert.ok(
    feedQa.regions
      .filter((region) => region.key !== "main_property_image")
      .every((region) => region.kind === "text"),
  );
  assert.equal(
    feedQa.regions.find((region) => region.key === "main_property_image")?.kind,
    "image",
  );
  const storyQa = buildPrebuiltTemplateCloneQa(template, copy, "9:16");
  assert.ok(storyQa);
  const sampleSubBox = template.typography?.headline_sub?.sampleBox;
  const storySubBox = storyQa.regions.find((region) => region.key === "headline_sub")?.box;
  assert.ok(sampleSubBox && storySubBox);
  assert.equal(storySubBox.x, sampleSubBox.x);
  assert.equal(storySubBox.width, sampleSubBox.width);
  assert.equal(storySubBox.y, (sampleSubBox.y * 1350 + 285) / 1920);
  assert.equal(storySubBox.height, (sampleSubBox.height * 1350) / 1920);
});

test("every released template persists one editable region for every declared customer input", () => {
  assert.ok(RESOLVABLE_AD_STUDIO_TEMPLATES.length > 0);
  for (const template of RESOLVABLE_AD_STUDIO_TEMPLATES) {
    const copy = Object.fromEntries(template.inputs.text.map((field) => [field.key, field.sample]));
    const expectedKeys = [
      ...template.inputs.text.map((field) => field.key),
      ...template.inputs.images.map((field) => field.key),
    ];
    for (const format of ["4:5", "9:16"] as const) {
      const qa = buildPrebuiltTemplateCloneQa(template, copy, format);
      assert.ok(qa, `${template.id} ${format} must have an editor map`);
      assert.deepEqual(
        qa.regions.map((region) => region.key),
        expectedKeys,
        `${template.id} ${format} must expose every input exactly once`,
      );
      assert.deepEqual(qa.copyValues, copy);
    }
  }
});

test("a migrated template carries its measured image hitboxes into both formats", () => {
  const base = AD_STUDIO_TEMPLATES.find((entry) => entry.id === "meta-feed-018")!;
  const template = {
    ...base,
    deterministicEditing: {
      status: "ready" as const,
      imageBoxes: {
        main_property_image: {
          x: 0.576172,
          y: 0.16875,
          width: 0.423828,
          height: 0.597656,
        },
      },
    },
  };
  const feed = buildPrebuiltTemplateCloneQa(template, {}, "4:5");
  const story = buildPrebuiltTemplateCloneQa(template, {}, "9:16");
  const feedImage = feed?.regions.find((region) => region.key === "main_property_image");
  const storyImage = story?.regions.find((region) => region.key === "main_property_image");

  assert.equal(feedImage?.kind, "image");
  assert.deepEqual(feedImage?.box, template.deterministicEditing.imageBoxes.main_property_image);
  assert.ok(storyImage);
  assert.equal(storyImage.kind, "image");
  assert.equal(storyImage.box.x, feedImage?.box.x);
  assert.equal(storyImage.box.width, feedImage?.box.width);
  assert.equal(storyImage.box.y, (feedImage!.box.y * 1350 + 285) / 1920);
  assert.equal(storyImage.box.height, (feedImage!.box.height * 1350) / 1920);
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

test("persistCloneRender retries a transient storage failure and surfaces the real error", async () => {
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  let attempts = 0;
  let stored = "";
  const supabase = {
    storage: {
      from(bucket: string) {
        assert.equal(bucket, "workspace-artifacts");
        return {
          async upload(path: string, _bytes: Uint8Array, _options: { contentType: string; upsert: boolean }) {
            attempts += 1;
            stored = path;
            if (attempts < 3) return { error: { message: "upstream connection reset" } };
            return { error: null };
          },
        };
      },
    },
  };

  const result = await persistCloneRender({
    supabase,
    workspaceId: "workspace_retry",
    assetUrl: tinyPng,
    fileNameSeed: "transient-clone",
  });
  assert.equal(attempts, 3, "should succeed on the third attempt");
  assert.equal(result, `/api/adstudio/media?path=${encodeURIComponent(stored)}`);

  // When every attempt fails, the real Supabase message is preserved (not swallowed).
  let failAttempts = 0;
  const failingSupabase = {
    storage: {
      from() {
        return {
          async upload() {
            failAttempts += 1;
            return { error: { message: "bucket quota exceeded" } };
          },
        };
      },
    },
  };
  await assert.rejects(
    () => persistCloneRender({
      supabase: failingSupabase,
      workspaceId: "workspace_retry",
      assetUrl: tinyPng,
      fileNameSeed: "doomed-clone",
    }),
    /bucket quota exceeded/,
  );
  assert.equal(failAttempts, 3, "should exhaust all retry attempts");
});

test("persistCloneRender treats a duplicate-object error as success", async () => {
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  let attempts = 0;
  const supabase = {
    storage: {
      from() {
        return {
          async upload() {
            attempts += 1;
            return { error: { message: "The resource already exists" } };
          },
        };
      },
    },
  };
  const result = await persistCloneRender({
    supabase,
    workspaceId: "workspace_dup",
    assetUrl: tinyPng,
    fileNameSeed: "dup-clone",
  });
  assert.equal(attempts, 1, "duplicate means a prior attempt landed; no further retries");
  assert.match(result, /^\/api\/adstudio\/media\?path=/);
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
    templateId: "template-test",
    providers,
    request: { prompt: "clone", referenceAssets: [], aspectRatio: "4:5", stylePreset: "test" },
    referenceImage: "data:image/png;base64,cmVmZXJlbmNl",
    expectedCopy: {},
    expectedAssetKeys: [],
    buildCorrectedRequest: () => ({ prompt: "corrected clone", referenceAssets: [], aspectRatio: "4:5", stylePreset: "test" }),
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

test("template campaign generation quality-gates the render before its prebuilt editor map", () => {
  const pipeline = readFileSync("src/lib/adstudio/generate-template-campaign.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/clone-generation.ts", "utf8");

  // The customer path is always professional quality. Internal draft work and
  // the final lane still share one registry-backed clone pipeline.
  assert.match(generation, /fast: "image_draft"/);
  assert.match(generation, /high: "image_final"/);
  assert.doesNotMatch(generation, /CloneTier|tier:/);
  assert.match(generation, /createImageProviderForCandidate/);
  assert.doesNotMatch(generation, /createOpenAiImageProvider\(\)/);
  assert.match(generation, /recordAdStudioProviderRun/);
  assert.match(generation, /output: result/);
  assert.match(pipeline, /const generationQuality = "high" as const/);
  assert.match(pipeline, /resolveCloneProviders\(generationQuality, input\.providerEnv\)/);
  assert.doesNotMatch(pipeline, /createFalImageProvider|fal-image-provider|FAL_KEY/);

  // A cheap subject-invariant vision gate blocks poor candidates before
  // persistence. Native-format editor regions still come from offline evidence.
  assert.match(pipeline, /buildPrebuiltTemplateCloneQa/);
  assert.match(pipeline, /prepareCloneCreativeTextLayers/);
  assert.doesNotMatch(pipeline, /detectCloneRegions/);
  assert.match(pipeline, /reviewCloneCandidate/);
  assert.match(pipeline, /cloneQualityPassed/);
  assert.match(pipeline, /TemplateCampaignQaError/);
  assert.match(pipeline, /buildCorrectedRequest/);
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
  const alertEvents: Array<Record<string, unknown>> = [];
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
    fallbackAlert: async (event) => {
      alertEvents.push(event as unknown as Record<string, unknown>);
      return { sent: true, deduped: false };
    },
  });

  assert.equal(result.provider, "fallback");
  assert.equal(fallbackCalls, 1);
  assert.equal(alertEvents[0]?.fromModel, "primary-model");
  assert.equal(alertEvents[0]?.toModel, "fallback-model");
  assert.equal(alertEvents[0]?.eventId, "depleted-primary-clone:adstudio.clone:1:4:5:provider:0");
});

test("plate construction has a distinct provider accounting identity from the finished clone", async () => {
  let mutationId = "";
  const imageProvider = accountedImageProvider("plate", async () => ({
    assetUrl: "data:image/png;base64,b2s=",
    seed: 1,
    model: "plate-model",
    usage: { imageUnits: 1, complete: true },
    providerMetadata: {},
  }));

  await generateCloneWithCascade({
    providers: [imageProvider],
    request: { prompt: "remove text", referenceAssets: [], aspectRatio: "4:5", stylePreset: "test" },
    workspaceId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    correlationId: "shared-campaign-correlation",
    attempt: 1,
    operation: "text-plate",
    accounting: {
      executeAttempt: async (input) => {
        mutationId = input.mutationId;
        return executeAttempt(input);
      },
      recordRun: async () => {},
    },
  });

  assert.equal(mutationId, "shared-campaign-correlation:adstudio.text-plate:1:4:5");
});

test("story starts only after Feed provider output is ready", async () => {
  const { startStoryAfterFeed } = await import("../src/lib/adstudio/generate-template-campaign.ts");
  const events: string[] = [];
  let resolveFeed!: () => void;
  const feedReady = new Promise<void>((resolve) => { resolveFeed = resolve; });
  const scheduled = startStoryAfterFeed({
    generateFeed: async () => {
      events.push("feed:start");
      await feedReady;
      events.push("feed:done");
      return "feed";
    },
    generateStory: async () => {
      events.push("story:start");
      return "story";
    },
  });
  await Promise.resolve();
  assert.deepEqual(events, ["feed:start"]);
  resolveFeed();
  const result = await scheduled;
  assert.deepEqual(events, ["feed:start", "feed:done", "story:start"]);
  assert.equal(result.feed, "feed");
  assert.equal(await result.storyTask, "story");
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

test("clone generation reaches the third paid provider after eligible transport failures", async () => {
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

  const result = await generateCloneWithCascade({
    providers: [failedProvider("primary"), failedProvider("fallback"), forbiddenThird],
    request: { prompt: "clone", referenceAssets: [], aspectRatio: "4:5", stylePreset: "test" },
    workspaceId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    correlationId: "bounded-clone",
    attempt: 1,
    accounting: { executeAttempt, recordRun: async () => {} },
  });

  assert.equal(result.provider, "third");
  assert.equal(thirdProviderCalls, 1);
});

test("final clone renders once when the blocking quality review passes", async () => {
  const render = await finalRenderFunction();
  let generateCalls = 0;
  let normalizedFrom = "";
  const audited: Array<Record<string, unknown>> = [];

  const result = await render({
    ...finalRenderInput([]),
    recordCandidate: async (candidate: Record<string, unknown>) => {
      audited.push(candidate);
    },
  }, {
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
    review: async () => ({
      schemaVersion: 1,
      templateId: "template-test",
      format: "4:5",
      attempt: 1,
      referenceHash: "a".repeat(64),
      candidateHash: "b".repeat(64),
      requestHash: "c".repeat(64),
      adSystemLikenessScore: 9.6,
      standaloneAdQualityScore: 9.2,
      excludedContentInfluencedScore: false,
      copyChecks: [],
      assetChecks: [],
      identityLeakage: [],
      defects: [],
      includedRationale: "matches",
      qualityRationale: "clean",
      suggestedCorrection: "",
    }),
  });

  assert.equal(generateCalls, 1);
  assert.equal(normalizedFrom, "data:image/png;base64,cmF3:4:5");
  assert.equal(result.assetUrl, "data:image/png;base64,ZXhhY3Q=");
  assert.equal(audited.length, 2);
  assert.equal(audited[0]?.accepted, false);
  assert.equal(audited[1]?.accepted, true);
  assert.equal(audited[0]?.candidateImage, "data:image/png;base64,ZXhhY3Q=");
});

test("every paid candidate is audited before a rejected render is corrected", async () => {
  const render = await finalRenderFunction();
  const prompts: string[] = [];
  const audited: Array<{ attempt: number; accepted: boolean }> = [];

  await render({
    ...finalRenderInput([]),
    recordCandidate: async (candidate: { attempt: number; accepted: boolean }) => {
      audited.push({ attempt: candidate.attempt, accepted: candidate.accepted });
    },
  }, {
    generate: async (input: { request: { prompt: string } }) => {
      prompts.push(input.request.prompt);
      return {
        assetUrl: `data:image/png;base64,${input.request.prompt === "clone" ? "MQ==" : "Mg=="}`,
        model: "image-model",
        provider: "primary",
        providerAttemptCount: 1,
      };
    },
    review: async (input: { attempt: number }) => ({
      schemaVersion: 1,
      templateId: "template-test",
      format: "4:5",
      attempt: input.attempt,
      referenceHash: "a".repeat(64),
      candidateHash: "b".repeat(64),
      requestHash: "c".repeat(64),
      adSystemLikenessScore: input.attempt === 1 ? 8.8 : 9.6,
      standaloneAdQualityScore: 9.4,
      excludedContentInfluencedScore: false,
      copyChecks: [],
      assetChecks: [],
      identityLeakage: [],
      defects: [],
      includedRationale: "reviewed",
      qualityRationale: "clean",
      suggestedCorrection: input.attempt === 1 ? "restore geometry" : "",
    }),
  });

  assert.deepEqual(prompts, ["clone", "corrected clone"]);
  assert.deepEqual(audited, [
    { attempt: 1, accepted: false },
    { attempt: 1, accepted: false },
    { attempt: 2, accepted: false },
    { attempt: 2, accepted: true },
  ]);
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

test("the persistence helper stores only renders already accepted by its caller", async () => {
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
  // A persisted edit is another finished customer-facing render: it must not
  // silently downgrade to the draft image lane.
  assert.match(route, /resolveCloneProviders\("high"\)/);
  assert.match(route, /modelProfile: "image_final"/);
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

test("template generation persists prebuilt editor regions with the finished render", () => {
  const builder = readFileSync("src/lib/adstudio/clone-campaign.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/generate-template-campaign.ts", "utf8");

  // The pack builder carries the prebuilt map supplied by generation.
  assert.match(builder, /cloneQa: input\.firstAd\.templateCloneQaByFormat\?\.\[format\]/);
  assert.match(generation, /templateCloneQaByFormat/);
  assert.match(generation, /TemplateCampaignQaError/);
  assert.match(generation, /buildPrebuiltTemplateCloneQa/);
  assert.doesNotMatch(generation, /detectCloneRegions/);
});

test("provided copy updates metadata without creating a second image-generation path", () => {
  const enrichment = readFileSync("src/lib/adstudio/campaign-copy-enrichment.ts", "utf8");
  const scoring = readFileSync("src/lib/adstudio/scoring.ts", "utf8");

  assert.match(enrichment, /creatives: pack\.creatives/);
  assert.doesNotMatch(enrichment, /generateAdStudioCopy|Promise\.allSettled/);
  assert.doesNotMatch(scoring, /Provider run persistence failed[\s\S]*console\.warn/);
  assert.match(scoring, /if \(error instanceof ProviderRunPersistenceError\) throw error/);
});
