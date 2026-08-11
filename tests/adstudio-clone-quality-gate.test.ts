import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RUNTIME_CLONE_CANDIDATES,
  MAX_RUNTIME_CLONE_QA_ATTEMPTS,
  TemplateCampaignQaError,
  cloneCorrectionForNextCandidate,
  cloneRequestHash,
  cloneQualityPassed,
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
      adSystemLikenessScore: input.attempt === 1 ? 9.1 : 9.6,
      suggestedCorrection: input.attempt === 1 ? "Use the supplied property photo faithfully." : "",
    }),
  });

  assert.equal(result.attempt, 2);
  assert.deepEqual(providerOrder, [["google", "openai"], ["openai", "google"]]);
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
      adSystemLikenessScore: input.attempt < 3 ? 9.4 : 9.6,
      suggestedCorrection: input.attempt < 3 ? "Restore the approved geometry." : "",
    }),
  });

  assert.equal(result.attempt, 3);
  assert.deepEqual(providerOrder, [
    ["gemini-flash", "gemini-pro", "gpt-image"],
    ["gemini-pro", "gpt-image", "gemini-flash"],
    ["gpt-image", "gemini-flash", "gemini-pro"],
  ]);
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
  const contactSheets: number[] = [];
  const provider = {
    providerName: "qa-test",
    providerType: "text_generation",
    capabilities: { visionInput: true },
    async generate() {
      providerCalls.push(1);
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
    contactSheet: async () => {
      contactSheets.push(1);
      return { imageUrl: "data:image/png;base64,AA==", referenceHash: "a".repeat(64), candidateHash: "b".repeat(64) };
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
  assert.equal(providerCalls.length, 2);
  assert.deepEqual(recordedAttempts, [2]);
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
    contactSheet: async () => ({ imageUrl: "data:image/png;base64,AA==", referenceHash: "a".repeat(64), candidateHash: "b".repeat(64) }),
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
