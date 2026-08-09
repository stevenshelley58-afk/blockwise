import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RUNTIME_CLONE_CANDIDATES,
  TemplateCampaignQaError,
  cloneQualityPassed,
} from "../src/lib/adstudio/clone-quality-gate.ts";
import { generateFinalCloneRender } from "../src/lib/adstudio/generate-template-campaign.ts";
import type { ImageProviderRequest } from "../src/lib/adstudio/providers.ts";
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

test("runtime quality lock requires scores, exact copy, faithful assets, and clean output", () => {
  assert.equal(cloneQualityPassed({ review: review(), expectedCopy, expectedAssetKeys }), true);
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

test("no below-threshold candidate is released after the bounded quality loop", async () => {
  let generations = 0;
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
    review: async (input) => review({ attempt: input.attempt, adSystemLikenessScore: 9.4, suggestedCorrection: "Match the approved geometry." }),
  }), TemplateCampaignQaError);
  assert.equal(generations, MAX_RUNTIME_CLONE_CANDIDATES);
});
