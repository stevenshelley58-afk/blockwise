import assert from "node:assert/strict";
import test from "node:test";

import { createFalImageProvider, falImageSizeForAspect } from "../src/lib/adstudio/fal-image-provider.ts";
import { buildProviderRunAttempt } from "../src/lib/operator/prompts/redact-prompt-run.ts";
import { ProviderRequestError } from "../src/lib/adstudio/providers.ts";
import type { ImageProviderRequest, ProviderAccountingContext } from "../src/lib/adstudio/providers.ts";

const accounting: ProviderAccountingContext = {
  model: "openai/gpt-image-2/edit",
  modelProfileVersionId: "11111111-1111-4111-8111-111111111111",
  pricingSnapshotId: "11111111-1111-4111-8111-111111111111",
  pricing: {
    inputUsdPerMillionTokens: 0,
    outputUsdPerMillionTokens: 0,
    imageUsdPerUnit: 0.04,
    currency: "USD",
    inputTokenBasis: "per_million_tokens",
    outputTokenBasis: "per_million_tokens",
    imageBasis: "per_output_image",
    source: "persisted",
    snapshotId: "11111111-1111-4111-8111-111111111111",
  },
};

const request: ImageProviderRequest = {
  prompt: "x",
  referenceAssets: ["https://example.com/a.png"],
  aspectRatio: "4:5",
  stylePreset: "real_estate_clone",
  requiresReferenceAssets: true,
};

function falFetchWithResult(result: Record<string, unknown>): typeof fetch {
  return async (url) => {
    if (String(url).startsWith("https://queue.fal.run/")) {
      return new Response(JSON.stringify({
        request_id: "fal-request-1",
        status_url: "https://fal.test/status",
        response_url: "https://fal.test/result",
      }));
    }
    if (String(url) === "https://fal.test/status") {
      return new Response(JSON.stringify({ status: "COMPLETED" }));
    }
    return new Response(JSON.stringify(result));
  };
}

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

test("fal Gemini edits use the native aspect and 1K request contract", async () => {
  const submittedBodies: Array<Record<string, unknown>> = [];
  const provider = createFalImageProvider(accounting, {
    env: { FAL_KEY: "test-key" },
    model: "fal-ai/gemini-3.1-flash-image-preview/edit",
    fetchImpl: async (_input, init) => {
      submittedBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ detail: "stop after submit" }), { status: 400 });
    },
  });

  await assert.rejects(() => provider.generate(request));
  const submittedBody = submittedBodies[0] ?? {};
  assert.equal(submittedBody?.aspect_ratio, "4:5");
  assert.equal(submittedBody?.resolution, "1K");
  assert.equal("image_size" in (submittedBody ?? {}), false);
  assert.equal("quality" in (submittedBody ?? {}), false);
});

test("generate throws a clear error when FAL_KEY is missing", async () => {
  const provider = createFalImageProvider(accounting, { env: {} });
  await assert.rejects(() => provider.generate(request), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.match(error.message, /FAL_KEY is not configured/);
    assert.equal(error.requestSubmitted, false);
    assert.equal(error.retryable, false);
    return true;
  });
});

test("generate requires at least one reference image", async () => {
  const provider = createFalImageProvider(accounting, { env: { FAL_KEY: "test-key" } });
  const req: ImageProviderRequest = {
    prompt: "x",
    referenceAssets: [],
    aspectRatio: "4:5",
    stylePreset: "real_estate_clone",
    requiresReferenceAssets: true,
  };
  await assert.rejects(() => provider.generate(req), /at least one reference image/);
});

test("exhausted Fal balance allows the configured fallback provider to run", async () => {
  const provider = createFalImageProvider(accounting, {
    env: { FAL_KEY: "test-key" },
    fetchImpl: async () => new Response(JSON.stringify({
      detail: "User is locked. Reason: Exhausted balance.",
    }), { status: 403 }),
  });

  await assert.rejects(() => provider.generate(request), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.requestSubmitted, true);
    assert.equal(error.retryable, true);
    return true;
  });
});

test("successful Fal image without provider cost produces an exact estimated attempt", async () => {
  const provider = createFalImageProvider(accounting, {
    env: { FAL_KEY: "test-key" },
    fetchImpl: falFetchWithResult({ images: [{ url: "https://fal.test/image.png" }] }),
    pollMs: 0,
  });

  const output = await provider.generate(request);
  const attempt = buildProviderRunAttempt({
    attemptIndex: 0,
    provider,
    modelProfile: "image_final",
    status: "completed",
    output,
  });

  assert.deepEqual(output.usage, {
    imageUnits: 1,
    providerRequestId: "fal-request-1",
    complete: true,
  });
  assert.equal(attempt.usage.imageUnits, 1);
  assert.equal(attempt.billingStatus, "estimated");
  assert.equal(attempt.estimatedCostUsd, accounting.pricing.imageUsdPerUnit);
  assert.equal(attempt.actualCostUsd, null);
});

test("Fal provider actual cost wins over the per-image estimate", async () => {
  const provider = createFalImageProvider(accounting, {
    env: { FAL_KEY: "test-key" },
    fetchImpl: falFetchWithResult({
      images: [{ url: "https://fal.test/image.png" }],
      usage: { cost: 0.061 },
    }),
    pollMs: 0,
  });

  const output = await provider.generate(request);
  const attempt = buildProviderRunAttempt({
    attemptIndex: 0,
    provider,
    modelProfile: "image_final",
    status: "completed",
    output,
  });

  assert.equal(attempt.estimatedCostUsd, accounting.pricing.imageUsdPerUnit);
  assert.equal(attempt.actualCostUsd, 0.061);
  assert.equal(attempt.billingStatus, "actual");
});

test("Fal timeout is retryable but malformed successful output is not", async () => {
  const timedOutProvider = createFalImageProvider(accounting, {
    env: { FAL_KEY: "test-key" },
    fetchImpl: falFetchWithResult({ images: [{ url: "https://fal.test/image.png" }] }),
    timeoutMs: -1,
    pollMs: 0,
  });
  await assert.rejects(() => timedOutProvider.generate(request), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.retryable, true);
    return true;
  });

  const emptyProvider = createFalImageProvider(accounting, {
    env: { FAL_KEY: "test-key" },
    fetchImpl: falFetchWithResult({ images: [], usage: { cost: 0.061 } }),
    pollMs: 0,
  });
  let caught: unknown;
  try {
    await emptyProvider.generate(request);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ProviderRequestError);
  assert.equal(caught.retryable, false);
  assert.equal(caught.providerRequestId, "fal-request-1");
  assert.equal(caught.usage?.actualCostUsd, 0.061);

  const attempt = buildProviderRunAttempt({
    attemptIndex: 0,
    provider: emptyProvider,
    modelProfile: "image_final",
    status: "failed",
    error: caught,
  });
  assert.equal(attempt.providerRequestId, "fal-request-1");
  assert.equal(attempt.actualCostUsd, 0.061);
  assert.equal(attempt.billingStatus, "actual");
});

test("Fal HTTP errors are retryable only for explicitly transient statuses", async () => {
  for (const [status, retryable] of [[400, false], [429, true], [503, true]] as const) {
    const provider = createFalImageProvider(accounting, {
      env: { FAL_KEY: "test-key" },
      fetchImpl: async () => new Response(JSON.stringify({
        request_id: `fal-${status}`,
        detail: `status ${status}`,
      }), { status }),
    });

    await assert.rejects(() => provider.generate(request), (error: unknown) => {
      assert.ok(error instanceof ProviderRequestError);
      assert.equal(error.requestSubmitted, true);
      assert.equal(error.retryable, retryable, `status ${status}`);
      return true;
    });
  }

  const nonJsonProvider = createFalImageProvider(accounting, {
    env: { FAL_KEY: "test-key" },
    fetchImpl: async () => new Response("overloaded", { status: 503 }),
  });
  await assert.rejects(() => nonJsonProvider.generate(request), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.requestSubmitted, true);
    assert.equal(error.retryable, true);
    return true;
  });
});
