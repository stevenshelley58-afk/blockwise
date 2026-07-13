import assert from "node:assert/strict";
import test from "node:test";

import { clampOptionCount, generateCreativeOptions } from "../src/lib/adstudio/creative-options.ts";
import {
  ProviderRequestError,
  type ImageProviderAdapter,
  type ImageProviderRequest,
  type ImageProviderResponse,
} from "../src/lib/adstudio/providers.ts";
import {
  buildProviderRunAttempt,
  type executeAdStudioProviderAttempt,
} from "../src/lib/operator/prompts/redact-prompt-run.ts";

function imageProvider(
  name: string,
  behavior: (seed: number) => Omit<ImageProviderResponse, "usage"> & Partial<Pick<ImageProviderResponse, "usage">>,
): ImageProviderAdapter {
  return {
    providerName: name,
    providerType: "image_generation",
    capabilities: { textToImage: true, imageToImage: true, multiReference: true },
    async generate(input: ImageProviderRequest): Promise<ImageProviderResponse> {
      const output = behavior(input.seed ?? 0);
      return { ...output, usage: output.usage ?? { imageUnits: 1, complete: true } };
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
const executionContext = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  mutationId: "creative-options-test",
  executeAttempt,
};

function submittedProviderFailure(message: string, retryable: boolean): ProviderRequestError {
  return new ProviderRequestError(message, { requestSubmitted: true, retryable });
}

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
    ...executionContext,
  });

  assert.equal(result.options.length, 3);
  assert.deepEqual([...result.options.map((o) => o.seed)].sort((a, b) => a - b), [1, 2, 3]);
  assert.ok(result.options.every((o) => o.provider === "openai"));
  assert.equal(result.compliance.pass, true);
});

test("generateCreativeOptions cascades to the next provider when one fails", async () => {
  const failing = imageProvider("openai", () => {
    throw submittedProviderFailure("rate limited", true);
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
    ...executionContext,
  });

  assert.equal(result.options.length, 2);
  assert.ok(result.options.every((o) => o.provider === "openrouter"));
  assert.ok(result.attempts.some((a) => a.provider === "openai" && a.status === "failed"));
  assert.ok(result.attempts.some((a) => a.provider === "openrouter" && a.status === "completed"));
});

test("generateCreativeOptions does not fallback after a non-retryable provider failure", async () => {
  let fallbackCalls = 0;
  const failing = imageProvider("openai", () => {
    throw submittedProviderFailure("invalid request", false);
  });
  const fallback = imageProvider("openrouter", (seed) => {
    fallbackCalls += 1;
    return { assetUrl: "data:image/png;base64,ok", seed, model: "fallback", providerMetadata: {} };
  });

  const result = await generateCreativeOptions({
    providers: [failing, fallback],
    imageInput: baseInput,
    copyText: "clean copy",
    count: 1,
    ...executionContext,
  });

  assert.equal(fallbackCalls, 0);
  assert.equal(result.options.length, 0);
  assert.equal(result.attempts.length, 1);
});

test("generateCreativeOptions never invokes a second fallback candidate", async () => {
  let thirdProviderCalls = 0;
  const first = imageProvider("primary", () => {
    throw submittedProviderFailure("primary unavailable", true);
  });
  const fallback = imageProvider("fallback", () => {
    throw submittedProviderFailure("fallback unavailable", true);
  });
  const forbiddenThird = imageProvider("third", (seed) => {
    thirdProviderCalls += 1;
    return { assetUrl: "data:image/png;base64,unexpected", seed, model: "third", providerMetadata: {} };
  });

  const result = await generateCreativeOptions({
    providers: [first, fallback, forbiddenThird],
    imageInput: baseInput,
    copyText: "clean copy",
    count: 1,
    ...executionContext,
  });

  assert.equal(thirdProviderCalls, 0);
  assert.equal(result.options.length, 0);
  assert.equal(result.attempts.length, 2);
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
    ...executionContext,
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
    ...executionContext,
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
    ...executionContext,
  });

  assert.equal(result.options.length, 1, "image still generates");
  assert.equal(result.compliance.pass, false, "but compliance flags the banned copy");
  assert.ok(result.compliance.issues.some((issue) => issue.code === "guaranteed_price"));
  assert.ok(result.compliance.issues.some((issue) => issue.code === "fake_scarcity"));
});

test("generateCreativeOptions never dispatches when durable reservation fails", async () => {
  let providerCalls = 0;
  const provider = imageProvider("openai", (seed) => {
    providerCalls += 1;
    return { assetUrl: "data:image/png;base64,ok", seed, model: "gpt-image-2", providerMetadata: {} };
  });

  const result = await generateCreativeOptions({
    providers: [provider],
    imageInput: baseInput,
    copyText: "clean copy",
    count: 1,
    ...executionContext,
    executeAttempt: async () => {
      throw new Error("reservation unavailable");
    },
  });
  assert.equal(result.fatalErrors.length, 1);
  assert.match(String(result.fatalErrors[0]), /reservation unavailable/);
  assert.equal(providerCalls, 0);
});

test("generateCreativeOptions waits for sibling lanes and preserves their attempts after one fatal lifecycle error", async () => {
  let siblingCompleted = false;
  const provider = imageProvider("openai", (seed) => ({
    assetUrl: `data:image/png;base64,${seed}`,
    seed,
    model: "gpt-image-2",
    providerMetadata: {},
  }));

  const result = await generateCreativeOptions({
    providers: [provider],
    imageInput: baseInput,
    copyText: "clean copy",
    count: 2,
    ...executionContext,
    executeAttempt: (async (input) => {
      if (input.attemptIndex === 0) throw new Error("first lane reservation unavailable");
      await new Promise((resolve) => setTimeout(resolve, 20));
      const execution = await executeAttempt(input);
      siblingCompleted = true;
      return execution;
    }) as typeof executeAdStudioProviderAttempt,
  });

  assert.equal(siblingCompleted, true);
  assert.equal(result.fatalErrors.length, 1);
  assert.equal(result.options.length, 1);
  assert.equal(result.attempts.length, 1);
});

test("generateCreativeOptions preserves an earlier paid failure when the next reservation fails", async () => {
  let fallbackCalls = 0;
  const submittedFailure = imageProvider("openai", () => {
    throw submittedProviderFailure("provider rejected submitted request", true);
  });
  const fallback = imageProvider("openrouter", (seed) => {
    fallbackCalls += 1;
    return { assetUrl: "data:image/png;base64,ok", seed, model: "image-model", providerMetadata: {} };
  });

  const result = await generateCreativeOptions({
    providers: [submittedFailure, fallback],
    imageInput: baseInput,
    copyText: "clean copy",
    count: 1,
    ...executionContext,
    executeAttempt: (async (input) => {
      if (input.attemptIndex === 1) throw new Error("fallback reservation unavailable");
      return executeAttempt(input);
    }) as typeof executeAdStudioProviderAttempt,
  });

  assert.equal(fallbackCalls, 0);
  assert.equal(result.fatalErrors.length, 1);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].status, "failed");
  assert.equal(result.attempts[0].provider, "openai");
});
