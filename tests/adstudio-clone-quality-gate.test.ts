import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RUNTIME_CLONE_CANDIDATES,
  MAX_RUNTIME_CLONE_QA_ATTEMPTS,
  TemplateCampaignQaError,
  buildCloneQualityContactSheet,
  cloneCorrectionForNextCandidate,
  cloneRequestHash,
  cloneQualityPassed,
  cloneQualityNeedsIndependentConfirmation,
  cloneQualityWarrantsSameTierRetry,
  reviewCloneCandidate,
} from "../src/lib/adstudio/clone-quality-gate.ts";
import { createTextProviderForCandidate } from "../src/lib/adstudio/ai-providers.ts";
import { generateFinalCloneRender } from "../src/lib/adstudio/generate-template-campaign.ts";
import { ProviderRequestError, type ImageProviderAdapter, type ImageProviderRequest } from "../src/lib/adstudio/providers.ts";
import type { AdStudioCloneQualityReview } from "../src/lib/adstudio/types.ts";

const expectedCopy = { headline: "Exact headline" };
const expectedAssetKeys = ["property_photo", "agency_logo"];

function review(changes: Partial<AdStudioCloneQualityReview> = {}): AdStudioCloneQualityReview {
  return {
    schemaVersion: 1,
    templateId: "template-1",
    format: "4:5",
    attempt: 1,
    referenceHash: "a".repeat(64),
    candidateHash: "b".repeat(64),
    requestHash: "c".repeat(64),
    adSystemLikenessScore: 9.6,
    standaloneAdQualityScore: 9.2,
    excludedContentInfluencedScore: false,
    copyChecks: [{ key: "headline", expected: "Exact headline", rendered: "Exact headline", exact: true }],
    assetChecks: expectedAssetKeys.map((key) => ({ key, used: true, faithful: true })),
    identityLeakage: [],
    defects: [],
    includedRationale: "system matches",
    qualityRationale: "polished",
    suggestedCorrection: "",
    ...changes,
  };
}

function request(prompt = "clone"): ImageProviderRequest {
  return {
    prompt,
    referenceAssets: ["approved-sample", "photo", "logo"],
    aspectRatio: "4:5",
    stylePreset: "real_estate_clone",
    requiresReferenceAssets: true,
    seed: 0,
  };
}

function provider(providerName: string): ImageProviderAdapter {
  return {
    providerName,
    providerType: "image_generation",
    capabilities: { textToImage: true, imageToImage: true, multiReference: true },
    async generate() {
      throw new Error("The test generation dependency owns dispatch.");
    },
  };
}

test("clone QA contact sheet includes every labelled customer asset", async () => {
  const { default: sharp } = await import("sharp");
  const image = async (red: number, green: number, blue: number) => {
    const png = await sharp({
      create: { width: 10, height: 12, channels: 3, background: { r: red, g: green, b: blue } },
    }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  };
  const contact = await buildCloneQualityContactSheet(
    await image(10, 20, 30),
    await image(40, 50, 60),
    [
      { key: "property_photo", image: await image(70, 80, 90) },
      { key: "agency_logo", image: await image(100, 110, 120) },
    ],
  );
  const contactBytes = Buffer.from(contact.imageUrl.split(",")[1]!, "base64");
  const metadata = await sharp(contactBytes).metadata();

  assert.deepEqual(contact.assetReferences.map((asset) => asset.key), ["property_photo", "agency_logo"]);
  assert.ok(contact.assetReferences.every((asset) => /^[a-f0-9]{64}$/u.test(asset.contentHash)));
  assert.equal(metadata.width, 20);
  // Customer assets occupy a labelled thumbnail strip without enlarging the
  // expensive full-resolution design comparison into another full-size row.
  assert.equal(metadata.height, 112);
});

test("runtime quality lock requires scores, exact copy, faithful assets, and clean output", () => {
  assert.equal(cloneQualityPassed({ review: review(), expectedCopy, expectedAssetKeys }), true);
  assert.equal(cloneQualityPassed({
    review: review({ copyChecks: [{ key: "headline", expected: "Exact headline", rendered: "Exact\nheadline", exact: false }] }),
    expectedCopy,
    expectedAssetKeys,
  }), true);
  assert.equal(cloneQualityPassed({ review: review({ adSystemLikenessScore: 9.4 }), expectedCopy, expectedAssetKeys }), false);
  assert.equal(cloneQualityPassed({ review: review({ defects: ["warped logo"] }), expectedCopy, expectedAssetKeys }), false);
  assert.equal(cloneQualityPassed({
    review: review({ copyChecks: [{ key: "headline", expected: "Exact headline", rendered: "Wrong headline", exact: true }] }),
    expectedCopy,
    expectedAssetKeys,
  }), false);
  assert.equal(cloneQualityPassed({
    review: review({ assetChecks: [{ key: "property_photo", used: true, faithful: true }, { key: "agency_logo", used: true, faithful: false }] }),
    expectedCopy,
    expectedAssetKeys,
  }), false);
});

test("only a clean 9+ candidate warrants a corrected same-tier retry", () => {
  assert.equal(cloneQualityWarrantsSameTierRetry({
    review: review({ adSystemLikenessScore: 9.2 }),
    expectedCopy,
    expectedAssetKeys,
  }), true);
  assert.equal(cloneQualityWarrantsSameTierRetry({
    review: review({ adSystemLikenessScore: 8.9 }),
    expectedCopy,
    expectedAssetKeys,
  }), false);
  assert.equal(cloneQualityWarrantsSameTierRetry({
    review: review({ adSystemLikenessScore: 9.2, defects: ["warped photo"] }),
    expectedCopy,
    expectedAssetKeys,
  }), false);
});

test("only an internally inconsistent clean near-pass needs independent vision confirmation", () => {
  assert.equal(cloneQualityNeedsIndependentConfirmation({
    review: review({ adSystemLikenessScore: 9.1, suggestedCorrection: "" }),
    expectedCopy,
    expectedAssetKeys,
  }), true);
  assert.equal(cloneQualityNeedsIndependentConfirmation({
    review: review({ adSystemLikenessScore: 9.8, standaloneAdQualityScore: 9.8, excludedContentInfluencedScore: true }),
    expectedCopy,
    expectedAssetKeys,
  }), true);
  assert.equal(cloneQualityNeedsIndependentConfirmation({
    review: review({ adSystemLikenessScore: 9.1, suggestedCorrection: "Move the image boundary up." }),
    expectedCopy,
    expectedAssetKeys,
  }), false);
  assert.equal(cloneQualityNeedsIndependentConfirmation({
    review: review({ adSystemLikenessScore: 8.9, suggestedCorrection: "" }),
    expectedCopy,
    expectedAssetKeys,
  }), false);
  assert.equal(cloneQualityNeedsIndependentConfirmation({
    review: review({ adSystemLikenessScore: 9.1, defects: ["warped text"], suggestedCorrection: "" }),
    expectedCopy,
    expectedAssetKeys,
  }), false);
});

test("a sub-threshold image-model review cannot end correction early with an empty suggestion", async () => {
  const generatedPrompts: string[] = [];
  const result = await generateFinalCloneRender({
    format: "4:5",
    templateId: "template-1",
    providers: [],
    request: request(),
    referenceImage: "approved-sample",
    expectedCopy,
    expectedAssetKeys,
    buildCorrectedRequest: (correction) => request(`clone | correction: ${correction}`),
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "run-empty-correction",
  }, {
    generate: async (input) => {
      generatedPrompts.push(input.request.prompt);
      return { assetUrl: `candidate-${generatedPrompts.length}`, model: "image", provider: "test", providerAttemptCount: 1 };
    },
    normalize: async (assetUrl) => assetUrl,
    review: async (input) => review({
      attempt: input.attempt,
      adSystemLikenessScore: input.attempt < 3 ? 8 : 9.6,
      qualityRationale: "The photo fade is too tall and pushes the headline below its reference anchor.",
      includedRationale: "The border, body copy, and logo already match.",
      suggestedCorrection: "",
    }),
  });

  assert.equal(result.attempt, 3);
  assert.equal(generatedPrompts.length, 3);
  assert.match(generatedPrompts[1]!, /photo fade is too tall/);
  assert.match(generatedPrompts[1]!, /Preserve everything.*border, body copy, and logo already match/i);
});

test("fallback correction is composed only from the image-model review", () => {
  const correction = cloneCorrectionForNextCandidate(review({
    adSystemLikenessScore: 8,
    qualityRationale: "Headline block is lower than the approved sample.",
    includedRationale: "Rounded card and logo anchor match.",
    suggestedCorrection: "",
  }));
  assert.match(correction, /Headline block is lower/);
  assert.match(correction, /Rounded card and logo anchor match/);
});

test("explicit image-model corrections are bounded before the next paid request", () => {
  const correction = cloneCorrectionForNextCandidate(review({
    suggestedCorrection: `Keep the border. ${"move the headline slightly. ".repeat(200)}`,
  }));
  assert.equal(correction.length, 2_400);
  assert.match(correction, /^Keep the border\./u);
});

test("a failed candidate feeds only its image-model correction through the same request builder", async () => {
  const generatedPrompts: string[] = [];
  const reviewScores = [9.1, 9.6];
  const result = await generateFinalCloneRender({
    format: "4:5",
    templateId: "template-1",
    providers: [],
    request: request(),
    referenceImage: "approved-sample",
    expectedCopy,
    expectedAssetKeys,
    buildCorrectedRequest: (correction) => request(`clone | correction: ${correction}`),
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "run-1",
  }, {
    generate: async (input) => {
      generatedPrompts.push(input.request.prompt);
      return { assetUrl: `candidate-${generatedPrompts.length}`, model: "image", provider: "test", providerAttemptCount: 1 };
    },
    normalize: async (assetUrl) => assetUrl,
    review: async (input) => review({
      attempt: input.attempt,
      adSystemLikenessScore: reviewScores[input.attempt - 1]!,
      suggestedCorrection: input.attempt === 1 ? "Restore the exact logo footprint." : "",
    }),
  });
  assert.equal(result.attempt, 2);
  assert.deepEqual(generatedPrompts, ["clone", "clone | correction: Restore the exact logo footprint."]);
});

test("a visual QA failure advances the corrected clone to the next paid model", async () => {
  const providerOrder: string[][] = [];
  const result = await generateFinalCloneRender({
    format: "4:5",
    templateId: "template-1",
    providers: [provider("google"), provider("openai")],
    request: request(),
    referenceImage: "approved-sample",
    expectedCopy,
    expectedAssetKeys,
    buildCorrectedRequest: (correction) => request(`clone | correction: ${correction}`),
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "run-cross-model",
  }, {
    generate: async (input) => {
      providerOrder.push(input.providers.map((candidate) => candidate.providerName));
      return { assetUrl: `candidate-${providerOrder.length}`, model: "image", provider: "test", providerAttemptCount: 1 };
    },
    normalize: async (assetUrl) => assetUrl,
    review: async (input) => review({
      attempt: input.attempt,
      adSystemLikenessScore: input.attempt === 1 ? 8.9 : 9.6,
      suggestedCorrection: input.attempt === 1 ? "Use the supplied property photo faithfully." : "",
    }),
  });

  assert.equal(result.attempt, 2);
  assert.deepEqual(providerOrder, [["google", "openai"], ["openai"]]);
});

test("quality rejections advance Flash to Pro to GPT Image without releasing a bad candidate", async () => {
  const providerOrder: string[][] = [];
  const result = await generateFinalCloneRender({
    format: "4:5",
    templateId: "template-1",
    providers: [provider("gemini-flash"), provider("gemini-pro"), provider("gpt-image")],
    request: request(),
    referenceImage: "approved-sample",
    expectedCopy,
    expectedAssetKeys,
    buildCorrectedRequest: (correction) => request(`clone | correction: ${correction}`),
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "run-three-tier",
  }, {
    generate: async (input) => {
      providerOrder.push(input.providers.map((candidate) => candidate.providerName));
      return { assetUrl: `candidate-${providerOrder.length}`, model: "image", provider: "test", providerAttemptCount: 1 };
    },
    normalize: async (assetUrl) => assetUrl,
    review: async (input) => review({
      attempt: input.attempt,
      adSystemLikenessScore: input.attempt < 3 ? 8.9 : 9.6,
      suggestedCorrection: input.attempt < 3 ? "Restore the approved geometry." : "",
    }),
  });

  assert.equal(result.attempt, 3);
  assert.deepEqual(providerOrder, [
    ["gemini-flash", "gemini-pro", "gpt-image"],
    ["gemini-pro", "gpt-image"],
    ["gpt-image"],
  ]);
});

test("one clean near-pass retries the corrected request on the same cheaper tier", async () => {
  const providerOrder: string[][] = [];
  const scores = [8.8, 9.2, 9.6];
  const result = await generateFinalCloneRender({
    format: "4:5",
    templateId: "template-1",
    providers: [provider("gemini-flash"), provider("gemini-pro"), provider("gpt-image")],
    request: request(),
    referenceImage: "approved-sample",
    expectedCopy,
    expectedAssetKeys,
    buildCorrectedRequest: (correction) => request(`clone | correction: ${correction}`),
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "run-near-pass-retry",
  }, {
    generate: async (input) => {
      providerOrder.push(input.providers.map((candidate) => candidate.providerName));
      return { assetUrl: `candidate-${providerOrder.length}`, model: "image", provider: "test", providerAttemptCount: 1 };
    },
    normalize: async (assetUrl) => assetUrl,
    review: async (input) => review({
      attempt: input.attempt,
      adSystemLikenessScore: scores[input.attempt - 1]!,
      suggestedCorrection: input.attempt < 3 ? "Restore the approved geometry." : "",
    }),
  });

  assert.equal(result.attempt, 3);
  assert.deepEqual(providerOrder, [
    ["gemini-flash", "gemini-pro", "gpt-image"],
    ["gemini-pro", "gpt-image"],
    ["gemini-pro", "gpt-image"],
  ]);
});

test("the final quality tier gets one corrected retry before failure", async () => {
  const providerOrder: string[][] = [];
  const scores = [8.8, 8.8, 9.2, 9.6];
  const result = await generateFinalCloneRender({
    format: "4:5",
    templateId: "template-1",
    providers: [provider("gemini-flash"), provider("gemini-pro"), provider("gpt-image")],
    request: request(),
    referenceImage: "approved-sample",
    expectedCopy,
    expectedAssetKeys,
    buildCorrectedRequest: (correction) => request(`clone | correction: ${correction}`),
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "run-final-retry",
  }, {
    generate: async (input) => {
      providerOrder.push(input.providers.map((candidate) => candidate.providerName));
      return { assetUrl: `candidate-${providerOrder.length}`, model: "image", provider: "test", providerAttemptCount: 1 };
    },
    normalize: async (assetUrl) => assetUrl,
    review: async (input) => review({
      attempt: input.attempt,
      adSystemLikenessScore: scores[input.attempt - 1]!,
      suggestedCorrection: input.attempt < 4 ? "Restore the approved geometry." : "",
    }),
  });

  assert.equal(result.attempt, 4);
  assert.deepEqual(providerOrder, [
    ["gemini-flash", "gemini-pro", "gpt-image"],
    ["gemini-pro", "gpt-image"],
    ["gpt-image"],
    ["gpt-image"],
  ]);
});

test("a missing later credential cannot cycle a quality-rejected provider", async () => {
  const providerOrder: string[][] = [];
  await assert.rejects(() => generateFinalCloneRender({
    format: "4:5",
    templateId: "template-1",
    providers: [provider("gemini-flash"), provider("gemini-pro")],
    request: request(),
    referenceImage: "approved-sample",
    expectedCopy,
    expectedAssetKeys,
    buildCorrectedRequest: (correction) => request(`clone | correction: ${correction}`),
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "run-no-cycle",
  }, {
    generate: async (input) => {
      providerOrder.push(input.providers.map((candidate) => candidate.providerName));
      return { assetUrl: `candidate-${providerOrder.length}`, model: "image", provider: "test", providerAttemptCount: 1 };
    },
    normalize: async (assetUrl) => assetUrl,
    review: async (input) => review({
      attempt: input.attempt,
      adSystemLikenessScore: 8.9,
      suggestedCorrection: "Restore the approved geometry.",
    }),
  }), TemplateCampaignQaError);
  assert.deepEqual(providerOrder, [
    ["gemini-flash", "gemini-pro"],
    ["gemini-pro"],
    ["gemini-pro"],
  ]);
});

test("Google preflight failures followed by a QA-rejected GPT candidate use only the bounded final retry", async () => {
  let gptPaidCalls = 0;
  let reviewCalls = 0;
  const accountedProvider = (
    providerName: "google" | "openai",
    model: string,
    generate: ImageProviderAdapter["generate"],
  ): ImageProviderAdapter => ({
    providerName,
    providerType: "image_generation",
    capabilities: { imageToImage: true, multiReference: true },
    accounting: {
      model,
      pricing: {
        inputUsdPerMillionTokens: 0,
        outputUsdPerMillionTokens: 0,
        imageUsdPerUnit: 0.1,
      },
    },
    generate,
  });
  const unavailableGoogle = (model: string) => accountedProvider("google", model, async () => {
    throw new ProviderRequestError("GOOGLE_AI_API_KEY is not configured.", {
      requestSubmitted: false,
      retryable: false,
      fallbackEligible: true,
    });
  });
  const gpt = accountedProvider("openai", "gpt-image-2", async () => {
    gptPaidCalls += 1;
    return {
      assetUrl: "data:image/png;base64,R1BU",
      seed: 1,
      model: "gpt-image-2",
      usage: { imageUnits: 1, complete: true },
      providerMetadata: {},
    };
  });

  await assert.rejects(() => generateFinalCloneRender({
    format: "4:5",
    templateId: "template-1",
    providers: [
      unavailableGoogle("gemini-3.1-flash-image"),
      unavailableGoogle("gemini-3-pro-image"),
      gpt,
    ],
    request: request(),
    referenceImage: "approved-sample",
    expectedCopy,
    expectedAssetKeys,
    buildCorrectedRequest: (correction) => request(`clone | correction: ${correction}`),
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "run-google-down-gpt-rejected",
  }, {
    generate: async (generationInput) => {
      let providerAttemptCount = 0;
      for (const candidate of generationInput.providers) {
        providerAttemptCount += 1;
        try {
          const output = await candidate.generate(generationInput.request);
          return {
            assetUrl: output.assetUrl,
            model: output.model,
            provider: candidate.providerName,
            providerAttemptCount,
          };
        } catch (error) {
          if (error instanceof ProviderRequestError && error.fallbackEligible) continue;
          throw error;
        }
      }
      throw new Error("No configured image provider succeeded.");
    },
    normalize: async (assetUrl) => assetUrl,
    review: async (input) => {
      reviewCalls += 1;
      return review({
        attempt: input.attempt,
        adSystemLikenessScore: 9.4,
        suggestedCorrection: "Restore the approved geometry.",
      });
    },
  }), TemplateCampaignQaError);

  assert.equal(gptPaidCalls, 2);
  assert.equal(reviewCalls, 2);
});

test("no below-threshold candidate is released after the bounded quality loop", async () => {
  let generations = 0;
  let reviewCalls = 0;
  await assert.rejects(() => generateFinalCloneRender({
    format: "4:5",
    templateId: "template-1",
    providers: [],
    request: request(),
    referenceImage: "approved-sample",
    expectedCopy,
    expectedAssetKeys,
    buildCorrectedRequest: (correction) => request(`clone | correction: ${correction}`),
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "run-2",
  }, {
    generate: async () => {
      generations += 1;
      return { assetUrl: `candidate-${generations}`, model: "image", provider: "test", providerAttemptCount: 1 };
    },
    normalize: async (assetUrl) => assetUrl,
    review: async (input) => {
      reviewCalls += 1;
      return review({ attempt: input.attempt, adSystemLikenessScore: 9.4, suggestedCorrection: "Match the approved geometry." });
    },
  }), TemplateCampaignQaError);
  assert.equal(generations, MAX_RUNTIME_CLONE_CANDIDATES);
  assert.equal(reviewCalls, MAX_RUNTIME_CLONE_CANDIDATES);
});

test("non-JSON clone QA retries the same contact sheet and candidate before accepting it", async () => {
  const providerCalls: number[] = [];
  const providerSystemPrompts: string[] = [];
  const contactSheets: Array<Array<{ key: string; image: string }>> = [];
  const provider = {
    providerName: "qa-test",
    providerType: "text_generation",
    capabilities: { visionInput: true },
    async generate(input: { system: string }) {
      providerCalls.push(1);
      providerSystemPrompts.push(input.system);
      return providerCalls.length === 1
        ? { json: "not JSON", rawText: "not JSON", usage: { complete: true }, providerMetadata: { model: "qa-test" } }
        : {
          json: review({
            referenceHash: "a".repeat(64),
            candidateHash: "b".repeat(64),
            requestHash: cloneRequestHash(request()),
          }),
          rawText: "{}",
          usage: { complete: true },
          providerMetadata: { model: "qa-test" },
        };
    },
  } as const;
  const recordedAttempts: number[] = [];

  const result = await reviewCloneCandidate({
    templateId: "template-1",
    format: "4:5",
    attempt: 1,
    referenceImage: "approved-sample",
    candidateImage: "paid-candidate",
    request: request(),
    expectedCopy,
    expectedAssetKeys,
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "same-candidate",
  }, {
    contactSheet: async (_referenceImage, _candidateImage, assets) => {
      contactSheets.push(assets);
      return {
        imageUrl: "data:image/png;base64,AA==",
        referenceHash: "a".repeat(64),
        candidateHash: "b".repeat(64),
        assetReferences: assets.map((asset, index) => ({ key: asset.key, contentHash: String(index + 1).repeat(64) })),
      };
    },
    getPromptSection: async () => ({ body: "QA", key: "adstudio.clone_qa", version: 1, id: null, source: "fallback" }) as never,
    resolveProfile: async () => ({
      primary: { provider: "openai", model: "qa-test" },
      fallbacks: [],
    }) as never,
    createProvider: () => provider as never,
    executeProviderAttempt: async ({ execute, attemptIndex }) => ({
      ok: true,
      output: await execute(),
      attempt: { attemptIndex },
    }) as never,
    recordProviderRun: async (input) => { recordedAttempts.push(input.attempts?.length ?? 0); },
  });

  assert.equal(result.adSystemLikenessScore, 9.6);
  assert.equal(contactSheets.length, 1);
  assert.deepEqual(contactSheets[0], [
    { key: "property_photo", image: "photo" },
    { key: "agency_logo", image: "logo" },
  ]);
  assert.equal(providerCalls.length, 2);
  assert.ok(providerSystemPrompts.every((prompt) => prompt.includes("CUSTOMER ASSET panel")));
  assert.ok(providerSystemPrompts.every((prompt) => prompt.includes('"property_photo"')));
  assert.ok(providerSystemPrompts.every((prompt) => prompt.includes('"agency_logo"')));
  assert.ok(providerSystemPrompts.every((prompt) => prompt.includes("without substitution, fabrication, repainting")));
  assert.ok(providerSystemPrompts.every((prompt) => prompt.includes("excludedContentInfluencedScore MUST be false")));
  assert.deepEqual(recordedAttempts, [2]);
});

test("a clean near-pass with no correction is re-reviewed before another image is bought", async () => {
  const providerSystemPrompts: string[] = [];
  let providerCalls = 0;
  const provider = {
    providerName: "qa-test",
    providerType: "text_generation",
    capabilities: { visionInput: true },
    async generate(input: { system: string }) {
      providerCalls += 1;
      providerSystemPrompts.push(input.system);
      return {
        json: review({
          referenceHash: "a".repeat(64),
          candidateHash: "b".repeat(64),
          requestHash: cloneRequestHash(request()),
          adSystemLikenessScore: providerCalls === 1 ? 9.1 : 9.6,
          suggestedCorrection: "",
        }),
        rawText: "{}",
        usage: { complete: true },
        providerMetadata: { model: "qa-test" },
      };
    },
  } as const;
  const recorded: Array<Record<string, unknown>> = [];

  const result = await reviewCloneCandidate({
    templateId: "template-1",
    format: "4:5",
    attempt: 1,
    referenceImage: "approved-sample",
    candidateImage: "paid-candidate",
    request: request(),
    expectedCopy,
    expectedAssetKeys,
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "confirm-near-pass",
  }, {
    contactSheet: async (_referenceImage, _candidateImage, assets) => ({
      imageUrl: "data:image/png;base64,AA==",
      referenceHash: "a".repeat(64),
      candidateHash: "b".repeat(64),
      assetReferences: assets.map((asset, index) => ({ key: asset.key, contentHash: String(index + 1).repeat(64) })),
    }),
    getPromptSection: async () => ({ body: "QA", key: "adstudio.clone_qa", version: 1, id: null, source: "fallback" }) as never,
    resolveProfile: async () => ({ primary: { provider: "openai", model: "qa-test" }, fallbacks: [] }) as never,
    createProvider: () => provider as never,
    executeProviderAttempt: async ({ execute, attemptIndex }) => ({
      ok: true,
      output: await execute(),
      attempt: { attemptIndex },
    }) as never,
    recordProviderRun: async (input) => { recorded.push(input.input as Record<string, unknown>); },
  });

  assert.equal(result.adSystemLikenessScore, 9.6);
  assert.equal(providerCalls, 2);
  assert.equal(providerSystemPrompts[0]?.includes("INDEPENDENT VISION CONFIRMATION"), false);
  assert.equal(providerSystemPrompts[1]?.includes("INDEPENDENT VISION CONFIRMATION"), true);
  assert.equal(recorded[0]?.independentConfirmationRequested, true);
});

test("provider parseJson failure retries the same candidate and records its submitted usage", async () => {
  const providerRequestIds: Array<string | null> = [];
  const recordedAttempts: Array<Array<Record<string, unknown>>> = [];
  let fetchCalls = 0;
  const candidate = {
    provider: "openai",
    model: "gpt-5.5",
    inputUsdPerMillionTokens: 5,
    outputUsdPerMillionTokens: 30,
    imageUsdPerUnit: 0,
    supportsStructuredOutput: true,
    maxContextTokens: 1_000_000,
    maxLatencyMs: 16_000,
  };

  await reviewCloneCandidate({
    templateId: "template-1",
    format: "4:5",
    attempt: 1,
    referenceImage: "approved-sample",
    candidateImage: "paid-candidate",
    request: request(),
    expectedCopy,
    expectedAssetKeys,
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "parse-json-retry",
  }, {
    contactSheet: async (_referenceImage, _candidateImage, assets) => ({
      imageUrl: "data:image/png;base64,AA==",
      referenceHash: "a".repeat(64),
      candidateHash: "b".repeat(64),
      assetReferences: assets.map((asset, index) => ({ key: asset.key, contentHash: String(index + 1).repeat(64) })),
    }),
    getPromptSection: async () => ({ body: "QA", key: "adstudio.clone_qa", version: 1, id: null, source: "fallback" }) as never,
    resolveProfile: async () => ({ primary: candidate, fallbacks: [] }) as never,
    createProvider: (modelCandidate) => createTextProviderForCandidate(modelCandidate, {
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: async () => {
        fetchCalls += 1;
        const content = fetchCalls === 1
          ? "This is not JSON."
          : JSON.stringify(review({
            referenceHash: "a".repeat(64),
            candidateHash: "b".repeat(64),
            requestHash: cloneRequestHash(request()),
          }));
        return new Response(JSON.stringify({
          id: `qa-request-${fetchCalls}`,
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        }), { status: 200 });
      },
    }),
    executeProviderAttempt: async ({ execute, attemptIndex, provider: textProvider }) => {
      try {
        const output = await execute();
        return {
          ok: true,
          output,
          attempt: { attemptIndex, status: "completed", providerRequestId: output.usage.providerRequestId },
        } as never;
      } catch (error) {
        assert.ok(error instanceof ProviderRequestError);
        providerRequestIds.push(error.providerRequestId ?? null);
        return {
          ok: false,
          error,
          attempt: {
            attemptIndex,
            provider: textProvider.providerName,
            status: "failed",
            requestSubmitted: error.requestSubmitted,
            providerRequestId: error.providerRequestId,
            usage: error.usage,
          },
        } as never;
      }
    },
    recordProviderRun: async (input) => { recordedAttempts.push((input.attempts ?? []) as Array<Record<string, unknown>>); },
  });

  assert.equal(fetchCalls, 2);
  assert.deepEqual(providerRequestIds, ["qa-request-1"]);
  assert.equal(recordedAttempts[0]?.[0]?.requestSubmitted, true);
  assert.equal(recordedAttempts[0]?.[0]?.providerRequestId, "qa-request-1");
  assert.equal((recordedAttempts[0]?.[0]?.usage as { inputTokens?: number }).inputTokens, 11);
});

test("clone QA rejects missing canonical customer assets before provider dispatch", async () => {
  let contactSheetCalls = 0;
  let providerCalls = 0;
  await assert.rejects(() => reviewCloneCandidate({
    templateId: "template-1",
    format: "4:5",
    attempt: 1,
    referenceImage: "approved-sample",
    candidateImage: "paid-candidate",
    request: { ...request(), referenceAssets: ["approved-sample"] },
    expectedCopy,
    expectedAssetKeys,
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "missing-customer-assets",
  }, {
    contactSheet: async () => {
      contactSheetCalls += 1;
      throw new Error("must not build an incomplete contact sheet");
    },
    createProvider: () => {
      providerCalls += 1;
      throw new Error("must not dispatch QA without customer assets");
    },
  }), /one exact labelled customer asset for every expected asset region/u);
  assert.equal(contactSheetCalls, 0);
  assert.equal(providerCalls, 0);
});

test("clone QA cannot accept faithfulness when contact-sheet asset comparison is absent", async () => {
  let providerCalls = 0;
  await assert.rejects(() => reviewCloneCandidate({
    templateId: "template-1",
    format: "4:5",
    attempt: 1,
    referenceImage: "approved-sample",
    candidateImage: "paid-candidate",
    request: request(),
    expectedCopy,
    expectedAssetKeys,
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "missing-asset-comparison",
  }, {
    contactSheet: async () => ({
      imageUrl: "data:image/png;base64,AA==",
      referenceHash: "a".repeat(64),
      candidateHash: "b".repeat(64),
      assetReferences: [],
    }),
    createProvider: () => {
      providerCalls += 1;
      throw new Error("must not dispatch QA without comparison evidence");
    },
  }), /cannot claim customer asset faithfulness without exact labelled asset comparisons/u);
  assert.equal(providerCalls, 0);
});

test("technical clone QA exhaustion never creates another image candidate", async () => {
  let generations = 0;
  const audits: Array<{ review?: AdStudioCloneQualityReview; qaStatus?: string; qaError?: string }> = [];
  await assert.rejects(() => generateFinalCloneRender({
    format: "4:5",
    templateId: "template-1",
    providers: [],
    request: request(),
    referenceImage: "approved-sample",
    expectedCopy,
    expectedAssetKeys,
    buildCorrectedRequest: (correction) => request(`clone | correction: ${correction}`),
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "qa-exhaustion",
    recordCandidate: async (candidate) => { audits.push(candidate); },
  }, {
    generate: async () => {
      generations += 1;
      return { assetUrl: "candidate-1", model: "image", provider: "test", providerAttemptCount: 1 };
    },
    normalize: async (assetUrl) => assetUrl,
    review: async () => { throw new TemplateCampaignQaError("invalid QA schema"); },
  }), /invalid QA schema/);

  assert.equal(generations, 1);
  assert.deepEqual(audits.map((audit) => audit.qaStatus ?? "pending"), ["pending", "technical_failed"]);
  assert.match(audits[1]?.qaError ?? "", /invalid QA schema/);
});

test("aborted clone QA is not retried or turned into another image candidate", async () => {
  let generations = 0;
  let reviewCalls = 0;
  const controller = new AbortController();
  const audits: Array<{ qaStatus?: string }> = [];
  await assert.rejects(() => generateFinalCloneRender({
    format: "4:5",
    templateId: "template-1",
    providers: [],
    request: request(),
    referenceImage: "approved-sample",
    expectedCopy,
    expectedAssetKeys,
    buildCorrectedRequest: (correction) => request(`clone | correction: ${correction}`),
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "qa-aborted",
    signal: controller.signal,
    recordCandidate: async (candidate) => { audits.push(candidate); },
  }, {
    generate: async () => {
      generations += 1;
      return { assetUrl: "candidate-1", model: "image", provider: "test", providerAttemptCount: 1 };
    },
    normalize: async (assetUrl) => assetUrl,
    review: async () => {
      reviewCalls += 1;
      throw new DOMException("cancelled", "AbortError");
    },
  }), /cancelled/);

  assert.equal(generations, 1);
  assert.equal(reviewCalls, 1);
  assert.deepEqual(audits.map((audit) => audit.qaStatus ?? "pending"), ["pending", "aborted"]);
  assert.ok(MAX_RUNTIME_CLONE_QA_ATTEMPTS >= 2);
});

test("contact-sheet and binding QA failures both finalize paid evidence as technical failures", async () => {
  for (const failure of [
    new Error("Clone QA candidate dimensions could not be read."),
    new TemplateCampaignQaError("Clone quality review was not bound to this exact candidate."),
  ]) {
    const audits: Array<{ qaStatus?: string; qaError?: string }> = [];
    await assert.rejects(() => generateFinalCloneRender({
      format: "4:5",
      templateId: "template-1",
      providers: [],
      request: request(),
      referenceImage: "approved-sample",
      expectedCopy,
      expectedAssetKeys,
      buildCorrectedRequest: (correction) => request(`clone | correction: ${correction}`),
      workspaceId: "workspace-1",
      userId: "user-1",
      correlationId: `terminal-${failure.message}`,
      recordCandidate: async (candidate) => { audits.push(candidate); },
    }, {
      generate: async () => ({ assetUrl: "candidate-1", model: "image", provider: "test", providerAttemptCount: 1 }),
      normalize: async (assetUrl) => assetUrl,
      review: async () => { throw failure; },
    }), new RegExp(failure.message.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
    assert.deepEqual(audits.map((audit) => audit.qaStatus), ["pending", "technical_failed"]);
    assert.equal(audits[1]?.qaError, failure.message);
  }
});

test("a post-dispatch signal abort finalizes the retained candidate as aborted", async () => {
  const controller = new AbortController();
  const audits: Array<{ qaStatus?: string; qaError?: string }> = [];
  await assert.rejects(() => generateFinalCloneRender({
    format: "4:5",
    templateId: "template-1",
    providers: [],
    request: request(),
    referenceImage: "approved-sample",
    expectedCopy,
    expectedAssetKeys,
    buildCorrectedRequest: (correction) => request(`clone | correction: ${correction}`),
    workspaceId: "workspace-1",
    userId: "user-1",
    correlationId: "post-dispatch-abort",
    signal: controller.signal,
    recordCandidate: async (candidate) => { audits.push(candidate); },
  }, {
    generate: async () => ({ assetUrl: "candidate-1", model: "image", provider: "test", providerAttemptCount: 1 }),
    normalize: async (assetUrl) => assetUrl,
    review: async () => {
      controller.abort(new DOMException("cancelled after dispatch", "AbortError"));
      throw new ProviderRequestError("Provider request was cancelled after dispatch.", {
        requestSubmitted: true,
        retryable: false,
      });
    },
  }), /cancelled after dispatch/);
  assert.deepEqual(audits.map((audit) => audit.qaStatus), ["pending", "aborted"]);
  assert.match(audits[1]?.qaError ?? "", /cancelled after dispatch/);
});
