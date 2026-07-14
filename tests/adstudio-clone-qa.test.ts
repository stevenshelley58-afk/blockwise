import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  cloneQaCorrectionPrompt,
  cloneQaMutationId,
  cloneQaPassed,
  cloneQaWarnings,
  normalizeRenderedText,
} from "../src/lib/adstudio/clone-qa.ts";
import {
  compositeCloneRegionEdit,
  createCloneRegionEditMask,
  generateCloneWithCascade,
  normalizeCloneRenderAspect,
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

test("parallel clone formats receive distinct QA mutation identities", () => {
  const correlationId = "11111111-1111-4111-8111-111111111111";
  assert.notEqual(
    cloneQaMutationId(correlationId, "4:5", 1),
    cloneQaMutationId(correlationId, "9:16", 1),
  );
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

function qualityGateInput(providers: ImageProviderAdapter[], maxAttempts = 99) {
  return {
    format: "4:5",
    providers,
    request: { prompt: "clone", referenceAssets: [], aspectRatio: "4:5", stylePreset: "test" },
    expectedCopy: { headline: "JUST LISTED" },
    workspaceId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    correlationId: "quality-gate",
    maxAttempts,
    deadline: Date.now() + 60_000,
  };
}

const passingQa = {
  passed: true,
  attempts: 1,
  checkedAt: "2026-07-13T00:00:00.000Z",
  copyChecks: [{ key: "headline", expected: "JUST LISTED", rendered: "JUST LISTED", exact: true }],
  defects: [],
  regions: [],
  model: "qa-model",
};

async function qualityGateFunction() {
  const module = await import("../src/lib/adstudio/generate-template-campaign.ts");
  const fn = (module as Record<string, unknown>).generateQaAcceptedClone;
  assert.equal(typeof fn, "function", "quality-attempt state machine must be directly testable");
  const gate = fn as (input: unknown, dependencies: Record<string, unknown>) => Promise<unknown>;
  return (input: unknown, dependencies: Record<string, unknown>) => gate(input, {
    normalize: async (assetUrl: string) => assetUrl,
    ...dependencies,
  });
}

async function verifiedPersistencePipelineFunction() {
  const module = await import("../src/lib/adstudio/generate-template-campaign.ts");
  const fn = (module as Record<string, unknown>).runVerifiedClonePersistencePipeline;
  assert.equal(typeof fn, "function", "verified clone persistence pipeline must be directly testable");
  return fn as (input: unknown) => Promise<unknown>;
}

test("normalizeRenderedText preserves case and punctuation", () => {
  assert.notEqual(
    normalizeRenderedText("Open Home — Saturday, 10:30am!"),
    normalizeRenderedText("open home — Saturday, 10:30am!"),
  );
  assert.notEqual(
    normalizeRenderedText("Open Home — Saturday, 10:30am!"),
    normalizeRenderedText("Open Home Saturday, 10:30am"),
  );
});

test("normalizeRenderedText only normalizes Unicode and layout whitespace", () => {
  assert.equal(
    normalizeRenderedText("Cafe\u0301\r\nOpen   Home"),
    normalizeRenderedText("Café Open Home"),
  );
  assert.notEqual(
    normalizeRenderedText("18 Smith St Scarborough"),
    normalizeRenderedText("18 Smyth St Scarborough"),
  );
});

test("cloneQaPassed requires every copy check exact and zero defects", () => {
  const good = {
    copyChecks: [
      { key: "headline", expected: "A", rendered: "A", exact: true },
      { key: "cta_text", expected: "B", rendered: "B", exact: true },
    ],
    defects: [],
  };
  assert.equal(cloneQaPassed(good), true);
  assert.equal(cloneQaPassed({ ...good, defects: ["warped roofline"] }), false);
  assert.equal(
    cloneQaPassed({
      ...good,
      copyChecks: [{ key: "headline", expected: "A", rendered: "typo", exact: false }],
    }),
    false,
  );
});

test("correction prompt names each mismatch with the exact expected string", () => {
  const prompt = cloneQaCorrectionPrompt({
    copyChecks: [
      { key: "headline", expected: "Scarborough open home", rendered: "Scarborough open home", exact: false },
      { key: "cta_text", expected: "Book now", rendered: "Book now", exact: true },
    ],
    defects: ["cut-off text at bottom edge"],
  });
  assert.match(prompt, /headline must read EXACTLY "Scarborough open home"/);
  assert.match(prompt, /previous attempt rendered "Scarborough open home"/);
  assert.match(prompt, /fix: cut-off text at bottom edge/);
  assert.doesNotMatch(prompt, /Book now.*EXACTLY/);
});

test("cloneQaWarnings formats copy mismatches as editable warnings", () => {
  assert.deepEqual(
    cloneQaWarnings({
      copyChecks: [
        { key: "headline", expected: "just isted", rendered: "JUST LISTED", exact: false },
        { key: "phone", expected: "0412 000 000", rendered: "", exact: false },
        { key: "address", expected: "18 Smith St", rendered: "18 Smith St", exact: true },
      ],
    }),
    [
      'You typed "just isted" - the ad shows "JUST LISTED". Click the text on the ad to change it.',
      '"Phone" may be missing from the ad - check the image.',
    ],
  );
});

test("template campaign generation runs cascade + QA and never ships an unverified clone silently", () => {
  const pipeline = readFileSync("src/lib/adstudio/generate-template-campaign.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/clone-generation.ts", "utf8");

  // One final-quality provider cascade from the model-profile registry, not a
  // draft/final split or a single hardcoded vendor.
  assert.match(generation, /CLONE_MODEL_PROFILE = "image_final"/);
  assert.doesNotMatch(generation, /image_draft|CloneTier|tier:/);
  assert.match(generation, /createImageProviderForCandidate/);
  assert.doesNotMatch(generation, /createOpenAiImageProvider\(\)/);
  assert.match(generation, /recordAdStudioProviderRun/);
  assert.match(generation, /output: result/);
  assert.match(pipeline, /resolveCloneProviders\(\)/);
  assert.doesNotMatch(pipeline, /createFalImageProvider|fal-image-provider|FAL_KEY/);

  // Every generation is QA'd; failures reroll with a correction, and a clone
  // that still fails returns 502 with the report instead of shipping.
  assert.match(pipeline, /runCloneQa/);
  assert.match(pipeline, /cloneQaCorrectionPrompt/);
  assert.match(pipeline, /TemplateCampaignQaError/);
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

test("template quality gate caps each format to the caller's QA budget", async () => {
  const gate = await qualityGateFunction();
  let providerCalls = 0;
  const failedProvider = (name: string) => accountedImageProvider(name, async () => {
    providerCalls += 1;
    throw submittedProviderFailure(`${name} unavailable`, true);
  });

  await assert.rejects(() => gate(
    qualityGateInput([failedProvider("primary"), failedProvider("fallback")], 1),
    {
      generate: (input: Parameters<typeof generateCloneWithCascade>[0]) => generateCloneWithCascade({
        ...input,
        accounting: { executeAttempt, recordRun: async () => {} },
      }),
      review: async () => passingQa,
    },
  ));

  assert.equal(providerCalls, 2);
});

test("provider failures do not consume the two QA-candidate attempts", async () => {
  const gate = await qualityGateFunction();
  let providerCalls = 0;
  let qaCalls = 0;
  const primary = accountedImageProvider("primary", async () => {
    providerCalls += 1;
    if (providerCalls === 1) throw submittedProviderFailure("primary unavailable", true);
    return {
      assetUrl: "data:image/png;base64,b2s=",
      seed: 2,
      model: "primary-model",
      usage: { imageUnits: 1, complete: true },
      providerMetadata: {},
    };
  });
  const fallback = accountedImageProvider("fallback", async () => {
    providerCalls += 1;
    throw submittedProviderFailure("fallback unavailable", true);
  });

  const result = await gate(qualityGateInput([primary, fallback], 2), {
    generate: (input: Parameters<typeof generateCloneWithCascade>[0]) => generateCloneWithCascade({
      ...input,
      accounting: { executeAttempt, recordRun: async () => {} },
    }),
    review: async (input: { attempt: number }) => {
      qaCalls += 1;
      assert.equal(input.attempt, 1);
      return passingQa;
    },
  });

  assert.ok(result);
  assert.equal(providerCalls, 3);
  assert.equal(qaCalls, 1);
});

test("the async budget leaves room for two QA candidates after one provider failure", async () => {
  const gate = await qualityGateFunction();
  let providerCalls = 0;
  let qaCalls = 0;
  const primary = accountedImageProvider("primary", async () => {
    providerCalls += 1;
    if (providerCalls === 1) {
      throw submittedProviderFailure("request rejected", false);
    }
    return {
      assetUrl: `data:image/png;base64,candidate-${providerCalls}`,
      seed: providerCalls,
      model: "primary-model",
      usage: { imageUnits: 1, complete: true },
      providerMetadata: {},
    };
  });
  let fallbackCalls = 0;
  const fallback = accountedImageProvider("fallback", async () => {
    fallbackCalls += 1;
    throw submittedProviderFailure("fallback unavailable", true);
  });

  const result = await gate(qualityGateInput([primary, fallback], 2), {
    generate: (input: Parameters<typeof generateCloneWithCascade>[0]) => generateCloneWithCascade({
      ...input,
      accounting: { executeAttempt, recordRun: async () => {} },
    }),
    review: async () => {
      qaCalls += 1;
      return qaCalls === 1
        ? { ...passingQa, passed: false, defects: ["copy drift"] }
        : passingQa;
    },
  });

  assert.ok(result);
  assert.equal(providerCalls, 3);
  assert.equal(fallbackCalls, 0);
  assert.equal(qaCalls, 2);
});

test("template quality gate evaluates at most two candidates and never persists failed or unavailable QA", async () => {
  const gate = await qualityGateFunction();
  let generateCalls = 0;
  let reviewCalls = 0;
  const failedQa = {
    ...passingQa,
    passed: false,
    copyChecks: [{ key: "headline", expected: "JUST LISTED", rendered: "Just Listed", exact: false }],
  };
  const generate = async () => {
    generateCalls += 1;
    return {
      assetUrl: "data:image/png;base64,b2s=",
      model: "image-model",
      provider: "primary",
      providerAttemptCount: 1,
    };
  };

  await assert.rejects(() => gate(qualityGateInput([]), {
    generate,
    review: async () => {
      reviewCalls += 1;
      return failedQa;
    },
  }), /did not pass verification/);
  assert.equal(generateCalls, 2);
  assert.equal(reviewCalls, 2);

  generateCalls = 0;
  reviewCalls = 0;
  await assert.rejects(() => gate(qualityGateInput([], 1), {
    generate,
    review: async () => {
      reviewCalls += 1;
      return failedQa;
    },
  }), /did not pass verification/);
  assert.equal(generateCalls, 1);
  assert.equal(reviewCalls, 1);

  generateCalls = 0;
  reviewCalls = 0;
  await assert.rejects(() => gate(qualityGateInput([]), {
    generate,
    review: async () => {
      reviewCalls += 1;
      throw new Error("QA offline");
    },
  }), /verification was unavailable/);
  assert.equal(generateCalls, 1);
  assert.equal(reviewCalls, 1);

});

test("failed or unavailable QA cannot reach clone or campaign persistence", async () => {
  const gate = await qualityGateFunction();
  const pipeline = await verifiedPersistencePipelineFunction();
  const failedQa = {
    ...passingQa,
    passed: false,
    copyChecks: [{ key: "headline", expected: "JUST LISTED", rendered: "Just Listed", exact: false }],
  };

  for (const unavailable of [false, true]) {
    let clonePersistenceCalls = 0;
    let campaignPersistenceCalls = 0;

    await assert.rejects(() => pipeline({
      formats: ["4:5", "9:16"],
      generateAccepted: (format: string) => gate(
        { ...qualityGateInput([]), format },
        {
          generate: async () => ({
            assetUrl: "data:image/png;base64,b2s=",
            model: "image-model",
            provider: "primary",
            providerAttemptCount: 1,
          }),
          review: async () => {
            if (unavailable) throw new Error("QA offline");
            return failedQa;
          },
        },
      ),
      persistClone: async () => {
        clonePersistenceCalls += 1;
        return {};
      },
      buildCampaign: () => ({}),
      persistCampaign: async () => {
        campaignPersistenceCalls += 1;
      },
    }), unavailable ? /verification was unavailable/ : /did not pass verification/);

    assert.equal(clonePersistenceCalls, 0);
    assert.equal(campaignPersistenceCalls, 0);
  }
});

test("post-commit audit failure is contained after durable accounting", async () => {
  let calls = 0;
  await runAuditAfterDurableAccounting(async () => {
    calls += 1;
    throw new Error("audit transport failed");
  });
  assert.equal(calls, 1);
});

test("targeted edit endpoint anchors on the current image and re-verifies the whole ad", () => {
  const route = readFileSync("src/app/api/adstudio/creatives/[id]/edit/route.ts", "utf8");
  const builder = readFileSync("src/lib/adstudio/reference-clone.ts", "utf8");

  // The anchor is the CURRENT creative image, never the template sample.
  assert.match(builder, /buildTargetedEditRequest/);
  assert.match(builder, /Keep every other pixel unchanged/);
  assert.match(route, /buildTargetedEditRequest/);
  assert.match(route, /resolveCloneProviders\(\)/);
  assert.match(route, /maxDuration = 300/);

  // Expected copy carries forward from the last verdict with the edited field
  // overridden, so unrelated drift fails QA too.
  assert.match(route, /canvas\.cloneQa\?\.copyChecks/);
  assert.match(route, /expectedCopy\[fieldKey\] = newValue/);
  assert.match(route, /createCloneRegionEditMask/);
  assert.match(route, /compositeCloneRegionEdit/);
  assert.match(route, /renderExactCloneTextEdit/);
  assert.match(route, /capabilities\.inpainting/);

  // Undo history and a real failure mode.
  assert.match(route, /renderHistory/);
  assert.match(route, /status: 502/);
});

test("template generation accepts only QA-passing clone renders", () => {
  const generator = readFileSync("src/lib/adstudio/generator.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/generate-template-campaign.ts", "utf8");

  assert.match(generator, /cloneQa: input\.cloneQa/);
  assert.match(generator, /templateCloneQaByFormat: input\.firstAd\?\.templateCloneQaByFormat/);
  // Generation may persist only after every format receives a passing verdict.
  assert.match(generation, /templateCloneQa: primaryClone\.qa \?\? undefined/);
  assert.match(generation, /templateCloneQaByFormat/);
  assert.match(generation, /cloneQaCorrectionPrompt/);
  assert.match(generation, /if \(qa\.passed\)/);
  assert.match(generation, /throw new TemplateCampaignQaError/);
  assert.match(generation, /error instanceof ProviderRunPersistenceError\) throw error/);
  assert.doesNotMatch(generation, /shipping clone without QA annotation/);
  assert.doesNotMatch(generation, /QA annotates each result but never blocks shipping/);
});

test("clone QA derives exactness from rendered copy instead of trusting the model flag", () => {
  const source = readFileSync("src/lib/adstudio/clone-qa.ts", "utf8");
  assert.doesNotMatch(source, /reported\?\.exact === true\s*\|\|/);
  assert.match(source, /normalizeRenderedText\(rendered\) === normalizeRenderedText\(expected\)/);
});

test("campaign enrichment cannot ship partial copy after accounting persistence fails", () => {
  const enrichment = readFileSync("src/lib/adstudio/campaign-copy-enrichment.ts", "utf8");
  const scoring = readFileSync("src/lib/adstudio/scoring.ts", "utf8");

  assert.match(enrichment, /result\.reason instanceof ProviderRunPersistenceError/);
  assert.match(enrichment, /if \(accountingError\) throw accountingError/);
  assert.doesNotMatch(scoring, /Provider run persistence failed[\s\S]*console\.warn/);
  assert.match(scoring, /if \(error instanceof ProviderRunPersistenceError\) throw error/);
});
