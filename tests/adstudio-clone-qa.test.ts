import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  cloneQaCorrectionPrompt,
  cloneQaPassed,
  cloneQaWarnings,
  normalizeRenderedText,
} from "../src/lib/adstudio/clone-qa.ts";
import { generateCloneWithCascade } from "../src/lib/adstudio/clone-generation.ts";
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

test("normalizeRenderedText is lenient on case/punctuation but not words", () => {
  assert.equal(
    normalizeRenderedText("Open Home — Saturday, 10:30am!"),
    normalizeRenderedText("open home saturday 10:30am"),
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

test("clone route runs cascade + QA reroll and never ships an unverified clone silently", () => {
  const route = readFileSync("src/app/api/adstudio/generate-clone/route.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/clone-generation.ts", "utf8");

  // Provider cascade from the model-profile registry, not a single hardcoded vendor.
  assert.match(generation, /tier === "preview" \? "image_draft" : "image_final"/);
  assert.match(generation, /createImageProviderForCandidate/);
  assert.doesNotMatch(generation, /createOpenAiImageProvider\(\)/);
  assert.match(generation, /recordAdStudioProviderRun/);
  assert.match(generation, /output: result/);
  assert.match(route, /resolveCloneProviders\(tier\)/);
  assert.doesNotMatch(route, /createFalImageProvider|fal-image-provider|FAL_KEY/);

  // Every generation is QA'd; failures reroll with a correction, and a clone
  // that still fails returns 502 with the report instead of shipping.
  assert.match(route, /runCloneQa/);
  assert.match(route, /cloneQaCorrectionPrompt/);
  assert.match(route, /status: 502/);
  assert.match(route, /runComplianceGate/);
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
      tier: "preview",
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
    tier: "preview",
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
    tier: "preview",
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
    tier: "preview",
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
    tier: "preview",
    attempt: 1,
    accounting: { executeAttempt, recordRun: async () => {} },
  }), /fallback unavailable/);

  assert.equal(thirdProviderCalls, 0);
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
  assert.match(builder, /exactly identical to reference image 1/);
  assert.match(route, /buildTargetedEditRequest/);
  assert.match(route, /resolveCloneProviders\("preview"\)/);

  // Expected copy carries forward from the last verdict with the edited field
  // overridden, so unrelated drift fails QA too.
  assert.match(route, /canvas\.cloneQa\?\.copyChecks/);
  assert.match(route, /expectedCopy\[fieldKey\] = newValue/);

  // Undo history and a real failure mode.
  assert.match(route, /renderHistory/);
  assert.match(route, /status: 502/);
});

test("clone QA verdict and regions persist on the clone creative", () => {
  const generator = readFileSync("src/lib/adstudio/generator.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/generate-template-campaign.ts", "utf8");

  assert.match(generator, /cloneQa: input\.cloneQa/);
  assert.match(generator, /templateCloneQaByFormat: input\.firstAd\?\.templateCloneQaByFormat/);
  // The server pipeline feeds advisory QA into the pack build and never throws
  // when the verdict is failed.
  assert.match(generation, /templateCloneQa: primaryClone\.qa \?\? undefined/);
  assert.match(generation, /templateCloneQaByFormat/);
  assert.match(generation, /annotateCloneQa/);
  assert.match(generation, /catch \(error\)[\s\S]*return null;/);
  assert.match(generation, /error instanceof ProviderRunPersistenceError\) throw error/);
  assert.match(generation, /for \(let attempt[\s\S]*ProviderRunPersistenceError\) throw error/);
  assert.doesNotMatch(generation, /qa && !qa\.passed[\s\S]*throw/);
  assert.doesNotMatch(generation, new RegExp("TemplateCampaignQa" + "Error"));
  assert.doesNotMatch(generation, /cloneQaCorrectionPrompt/);
});

test("campaign enrichment cannot ship partial copy after accounting persistence fails", () => {
  const enrichment = readFileSync("src/lib/adstudio/campaign-copy-enrichment.ts", "utf8");
  const scoring = readFileSync("src/lib/adstudio/scoring.ts", "utf8");

  assert.match(enrichment, /result\.reason instanceof ProviderRunPersistenceError/);
  assert.match(enrichment, /if \(accountingError\) throw accountingError/);
  assert.doesNotMatch(scoring, /Provider run persistence failed[\s\S]*console\.warn/);
  assert.match(scoring, /if \(error instanceof ProviderRunPersistenceError\) throw error/);
});
