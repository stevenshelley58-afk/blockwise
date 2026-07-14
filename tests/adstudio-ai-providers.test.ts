import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createImageProviderForCandidate,
  createTextProviderForCandidate,
  resolveAzureOpenAiChatUrl,
  resolveOpenAiImageEditsUrl,
} from "../src/lib/adstudio/ai-providers.ts";
import { ProviderRequestError, validateProviderJsonOutput } from "../src/lib/adstudio/providers.ts";
import { buildProviderRunAttempt } from "../src/lib/operator/prompts/redact-prompt-run.ts";
import type { ModelCandidate, ModelProvider } from "../src/lib/ai/model-registry.ts";

function candidate(provider: ModelProvider, model: string): ModelCandidate {
  return {
    provider,
    model,
    modelProfileVersionId: "11111111-1111-4111-8111-111111111111",
    pricingSnapshotId: "11111111-1111-4111-8111-111111111111",
    pricingSource: "persisted",
    inputUsdPerMillionTokens: 0.3,
    outputUsdPerMillionTokens: 2.5,
    imageUsdPerUnit: 0.039,
    supportsStructuredOutput: true,
    maxContextTokens: 65_536,
    maxLatencyMs: 30_000,
  };
}

test("template analysis uses its own strict provider schema", () => {
  const valid = validateProviderJsonOutput({
    schemaName: "adStudioTemplateAnalysis",
    rawText: JSON.stringify({
      name: "Seller Tips",
      goal: "seller_leads",
      offerId: "seller-tips",
      audienceIntent: "Homeowners preparing to sell",
      category: "education",
      tags: ["seller"],
      inputs: {
        images: [{
          key: "background_photo",
          label: "Background photo",
          required: true,
          aspect: "landscape",
          description: "Customer property image",
        }],
        text: [{
          key: "headline",
          label: "Headline",
          maxLength: 40,
          sample: "Five steps for a smoother sale",
          required: true,
        }],
      },
      classification: {
        ad_type: "social_post",
        primary_intent: "educational_content",
        property_or_agent_focus: "property",
      },
    }),
  });
  assert.equal(valid.ok, true);

  const invalid = validateProviderJsonOutput({
    schemaName: "adStudioTemplateAnalysis",
    rawText: JSON.stringify({ name: "Incomplete" }),
  });
  assert.equal(invalid.ok, false);
});

test("production exports expose only explicitly priced provider candidates", () => {
  const adapters = readFileSync("src/lib/adstudio/ai-providers.ts", "utf8");
  const publicApi = readFileSync("src/lib/adstudio/index.ts", "utf8");
  const falAdapter = readFileSync("src/lib/adstudio/fal-image-provider.ts", "utf8");
  const styleProfile = readFileSync("src/lib/adstudio/style-profile.ts", "utf8");

  assert.doesNotMatch(adapters, /export function create(?:OpenAi|OpenRouter|AzureOpenAi|GoogleAi|Fal)(?:Text|Image|Vision)Provider/);
  assert.doesNotMatch(publicApi, /createOpenAi(?:Text|Image|Vision)Provider|createOpenRouter(?:Text|Image)Provider/);
  assert.match(falAdapter, /createFalImageProvider\(\s*accounting: ProviderAccountingContext/);
  assert.doesNotMatch(styleProfile, /\.generate\(/);
});

test("candidate adapters retain exact runtime version, price, currency, and billing basis", () => {
  const provider = createImageProviderForCandidate({
    provider: "openrouter",
    model: "google/gemini-2.5-flash-image",
    modelProfileVersionId: "11111111-1111-4111-8111-111111111111",
    pricingSnapshotId: "11111111-1111-4111-8111-111111111111",
    pricingSource: "persisted",
    inputUsdPerMillionTokens: 0.3,
    outputUsdPerMillionTokens: 2.5,
    imageUsdPerUnit: 0.039,
    supportsStructuredOutput: false,
    maxContextTokens: 65_536,
    maxLatencyMs: 30_000,
  });

  assert.equal(provider.accounting?.pricingSnapshotId, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(provider.accounting?.pricing, {
    inputUsdPerMillionTokens: 0.3,
    outputUsdPerMillionTokens: 2.5,
    imageUsdPerUnit: 0.039,
    currency: "USD",
    inputTokenBasis: "per_million_tokens",
    outputTokenBasis: "per_million_tokens",
    imageBasis: "per_output_image",
    source: "persisted",
    snapshotId: "11111111-1111-4111-8111-111111111111",
  });
});

test("candidate adapters reject missing or invalid explicit pricing before dispatch", () => {
  assert.throws(
    () => createImageProviderForCandidate({ ...candidate("openai", "gpt-image-2"), imageUsdPerUnit: -1 }),
    /non-negative imageUsdPerUnit/,
  );
  assert.throws(
    () => createImageProviderForCandidate(candidate("openai", "   ")),
    /must declare a model/,
  );
});

test("priced OpenRouter candidate posts structured prompts and parses JSON responses", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createTextProviderForCandidate(candidate("openrouter", "openai/gpt-5.5"), {
    env: {
      OPENROUTER_API_KEY: "or_test",
      NEXT_PUBLIC_APP_URL: "https://app.blockwise.test",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ platform: "meta", primaryText: ["ok"] }) } }],
          usage: { prompt_tokens: 12, completion_tokens: 4, cost: 0.000321 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const output = await provider.generate({
    system: "Return JSON",
    messages: [{ role: "user", content: "Build copy" }],
    schemaName: "metaLeadAdPack",
  });

  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer or_test");
  assert.deepEqual(output.json, { platform: "meta", primaryText: ["ok"] });
  assert.equal(output.usage.inputTokens, 12);
  assert.equal(output.usage.actualCostUsd, 0.000321);
  assert.equal(output.providerMetadata.model, "openai/gpt-5.5");
});

test("priced Azure candidate posts structured multimodal prompts to the deployment endpoint", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createTextProviderForCandidate(candidate("azure", "gpt-4.1-mini-vision"), {
    env: {
      AZURE_OPENAI_API_KEY: "az_test",
      AZURE_OPENAI_ENDPOINT: "https://blockwise-openai.openai.azure.com/",
      AZURE_OPENAI_DEPLOYMENT: "gpt-4.1-mini-vision",
      AZURE_OPENAI_API_VERSION: "2024-10-21",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ design: { ok: true } }) } }],
          usage: { prompt_tokens: 18, completion_tokens: 7 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const output = await provider.generate({
    system: "Return JSON",
    messages: [{ role: "user", content: "Extract this ad" }],
    imageUrl: "data:image/png;base64,aW1hZ2U=",
    schemaName: "metaLeadAdPack",
  });

  assert.equal(
    calls[0].url,
    "https://blockwise-openai.openai.azure.com/openai/deployments/gpt-4.1-mini-vision/chat/completions?api-version=2024-10-21",
  );
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["api-key"], "az_test");
  assert.equal(headers.Authorization, undefined);

  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, undefined);
  assert.equal(body.response_format.type, "json_object");
  assert.equal(body.messages[1].content[0].text, "Extract this ad");
  assert.equal(body.messages[1].content[1].image_url.url, "data:image/png;base64,aW1hZ2U=");
  assert.deepEqual(output.json, { design: { ok: true } });
  assert.equal(output.providerMetadata.model, "gpt-4.1-mini-vision");
});

test("resolveAzureOpenAiChatUrl supports explicit URLs and deployment URLs", () => {
  assert.equal(
    resolveAzureOpenAiChatUrl(
      {
        AZURE_OPENAI_ENDPOINT: "https://resource.openai.azure.com",
        AZURE_OPENAI_API_VERSION: "2024-10-21",
      },
      "vision deploy",
    ),
    "https://resource.openai.azure.com/openai/deployments/vision%20deploy/chat/completions?api-version=2024-10-21",
  );
  assert.equal(
    resolveAzureOpenAiChatUrl(
      {
        AZURE_OPENAI_CHAT_COMPLETIONS_URL: "https://custom.azure.test/chat",
      },
      "",
    ),
    "https://custom.azure.test/chat",
  );
});

test("priced OpenRouter image candidate uses the native image API with explicit references and quality", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createImageProviderForCandidate(candidate("openrouter", "google/gemini-2.5-flash-image"), {
    env: {
      OPENROUTER_API_KEY: "or_test",
      NEXT_PUBLIC_APP_URL: "https://app.blockwise.test",
    },
    model: "google/gemini-2.5-flash-image",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });

      return new Response(
        JSON.stringify({
          data: [{ b64_json: "b3V0" }],
          usage: { prompt_tokens: 900, completion_tokens: 1, cost: 0.039 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const references = [
    "data:image/png;base64,cmVmZXJlbmNl",
    "data:image/jpeg;base64,cGhvdG8=",
  ];
  const output = await provider.generate({
    prompt: "Clone the reference ad with the supplied photo",
    referenceAssets: references,
    aspectRatio: "4:5",
    stylePreset: "real_estate_clone",
    requiresReferenceAssets: true,
  });

  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/images");
  assert.equal(body.aspect_ratio, "4:5");
  assert.equal(body.quality, "high");
  assert.equal(body.output_format, "png");
  // A data URL inside the text prompt is tokenized as text and blows the
  // image model's context window — references belong in input_references only.
  assert.doesNotMatch(String(body.prompt), /data:image/);
  assert.deepEqual(
    body.input_references.map((part: { image_url: { url: string } }) => part.image_url.url),
    references,
  );
  assert.equal(output.assetUrl, "data:image/png;base64,b3V0");
  assert.equal(output.usage.imageUnits, 1);
  assert.equal(output.usage.actualCostUsd, 0.039);
});

test("priced OpenAI image candidate uses GPT Image 2", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"), {
    env: {
      OPENAI_API_KEY: "oa_test",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });

      return new Response(
        JSON.stringify({
          data: [{ b64_json: "aW1hZ2U=" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const output = await provider.generate({
    prompt: "Premium local real estate appraisal creative",
    referenceAssets: [],
    aspectRatio: "1:1",
    stylePreset: "real_estate_photography",
  });
  const body = JSON.parse(String(calls[0].init.body));

  assert.equal(calls[0].url, "https://api.openai.com/v1/images/generations");
  assert.equal(body.model, "gpt-image-2");
  assert.equal(body.quality, "high");
  assert.equal(output.model, "gpt-image-2");
  assert.equal(output.usage?.complete, false);
  assert.equal(output.usage?.inputTokens, undefined);
});

test("OpenAI 2xx response without an image preserves submitted billing evidence", async () => {
  const provider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"), {
    env: { OPENAI_API_KEY: "oa_test" },
    fetchImpl: async () => new Response(JSON.stringify({
      id: "oa-image-request-1",
      data: [],
      usage: { input_tokens: 800, output_tokens: 20, cost: 0.047 },
    }), { status: 200 }),
  });

  let caught: unknown;
  try {
    await provider.generate({
      prompt: "Premium local real estate appraisal creative",
      referenceAssets: [],
      aspectRatio: "1:1",
      stylePreset: "real_estate_photography",
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof ProviderRequestError);
  assert.equal(caught.requestSubmitted, true);
  assert.equal(caught.retryable, false);
  assert.equal(caught.providerRequestId, "oa-image-request-1");
  assert.deepEqual(caught.usage, {
    imageUnits: 0,
    providerRequestId: "oa-image-request-1",
    complete: true,
    inputTokens: 800,
    outputTokens: 20,
    actualCostUsd: 0.047,
  });

  const attempt = buildProviderRunAttempt({
    attemptIndex: 0,
    provider,
    modelProfile: "image_final",
    status: "failed",
    error: caught,
  });
  assert.equal(attempt.providerRequestId, "oa-image-request-1");
  assert.equal(attempt.billingStatus, "actual");
  assert.equal(attempt.actualCostUsd, 0.047);
});

test("OpenRouter 2xx response without an image preserves submitted billing evidence", async () => {
  const provider = createImageProviderForCandidate(candidate("openrouter", "google/gemini-2.5-flash-image"), {
    env: { OPENROUTER_API_KEY: "or_test" },
    fetchImpl: async () => new Response(JSON.stringify({
      id: "or-image-request-1",
      choices: [{ message: { content: "No image generated" } }],
      usage: { prompt_tokens: 700, completion_tokens: 15, cost: 0.039 },
    }), { status: 200 }),
  });

  let caught: unknown;
  try {
    await provider.generate({
      prompt: "Premium local real estate appraisal creative",
      referenceAssets: [],
      aspectRatio: "1:1",
      stylePreset: "real_estate_photography",
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof ProviderRequestError);
  assert.equal(caught.requestSubmitted, true);
  assert.equal(caught.retryable, false);
  assert.equal(caught.providerRequestId, "or-image-request-1");
  assert.deepEqual(caught.usage, {
    imageUnits: 0,
    providerRequestId: "or-image-request-1",
    complete: true,
    inputTokens: 700,
    outputTokens: 15,
    actualCostUsd: 0.039,
  });

  const attempt = buildProviderRunAttempt({
    attemptIndex: 0,
    provider,
    modelProfile: "image_final",
    status: "failed",
    error: caught,
  });
  assert.equal(attempt.providerRequestId, "or-image-request-1");
  assert.equal(attempt.billingStatus, "actual");
  assert.equal(attempt.actualCostUsd, 0.039);
});

test("provider HTTP errors are retryable only for explicitly transient statuses", async () => {
  for (const [status, retryable] of [[400, false], [401, false], [408, true], [409, true], [425, true], [429, true], [500, true]] as const) {
    const provider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"), {
      env: { OPENAI_API_KEY: "oa_test" },
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: `status ${status}` } }), { status }),
    });

    await assert.rejects(() => provider.generate({
      prompt: "Premium local real estate appraisal creative",
      referenceAssets: [],
      aspectRatio: "1:1",
      stylePreset: "real_estate_photography",
    }), (error: unknown) => {
      assert.ok(error instanceof ProviderRequestError);
      assert.equal(error.requestSubmitted, true);
      assert.equal(error.retryable, retryable, `status ${status}`);
      return true;
    });
  }

  const nonJsonProvider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"), {
    env: { OPENAI_API_KEY: "oa_test" },
    fetchImpl: async () => new Response("overloaded", { status: 503 }),
  });
  await assert.rejects(() => nonJsonProvider.generate({
    prompt: "Premium local real estate appraisal creative",
    referenceAssets: [],
    aspectRatio: "1:1",
    stylePreset: "real_estate_photography",
  }), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.requestSubmitted, true);
    assert.equal(error.retryable, true);
    return true;
  });
});

test("provider transport failures preserve ambiguous submission evidence and aborts never retry", async () => {
  const transportProvider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"), {
    env: { OPENAI_API_KEY: "oa_test" },
    fetchImpl: async () => {
      throw new TypeError("connection reset");
    },
  });

  await assert.rejects(() => transportProvider.generate({
    prompt: "Premium local real estate appraisal creative",
    referenceAssets: [],
    aspectRatio: "1:1",
    stylePreset: "real_estate_photography",
  }), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.requestSubmitted, true);
    assert.equal(error.retryable, true);
    assert.deepEqual(error.usage, { complete: false });
    return true;
  });

  const abortController = new AbortController();
  const abortedProvider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"), {
    env: { OPENAI_API_KEY: "oa_test" },
    fetchImpl: async () => {
      throw new DOMException("cancelled", "AbortError");
    },
  });
  await assert.rejects(() => abortedProvider.generate({
    prompt: "Premium local real estate appraisal creative",
    referenceAssets: [],
    aspectRatio: "1:1",
    stylePreset: "real_estate_photography",
    signal: abortController.signal,
  }), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.requestSubmitted, true);
    assert.equal(error.retryable, false);
    return true;
  });
});

test("a pre-aborted provider signal never dispatches", async () => {
  let calls = 0;
  const abortController = new AbortController();
  abortController.abort();
  const provider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"), {
    env: { OPENAI_API_KEY: "oa_test" },
    fetchImpl: async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    },
  });

  await assert.rejects(() => provider.generate({
    prompt: "Premium local real estate appraisal creative",
    referenceAssets: [],
    aspectRatio: "1:1",
    stylePreset: "real_estate_photography",
    signal: abortController.signal,
  }), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.requestSubmitted, false);
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(calls, 0);
});

test("reference acquisition failures remain unsubmitted and non-retryable", async () => {
  let calls = 0;
  const provider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"), {
    env: { OPENAI_API_KEY: "oa_test" },
    fetchImpl: async () => {
      calls += 1;
      return new Response("missing", { status: 404 });
    },
  });

  await assert.rejects(() => provider.generate({
    prompt: "Prepare this listing photo",
    referenceAssets: ["https://assets.example/missing.png"],
    aspectRatio: "4:5",
    stylePreset: "locked_template_photo_prep",
    requiresReferenceAssets: true,
  }), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.requestSubmitted, false);
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(calls, 1);
});

test("priced OpenAI image candidate does not hide a second billable retry", async () => {
  let calls = 0;
  const provider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"), {
    env: { OPENAI_API_KEY: "oa_test" },
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "invalid size" } }), { status: 400 });
    },
  });

  await assert.rejects(() => provider.generate({
    prompt: "Prepare this listing photo",
    referenceAssets: ["data:image/png;base64,aW1hZ2U="],
    aspectRatio: "4:5",
    stylePreset: "locked_template_photo_prep",
    requiresReferenceAssets: true,
  }), /invalid size/);
  assert.equal(calls, 1);
});

test("priced OpenAI image candidate exposes reference-capable image capabilities", () => {
  const provider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"), {
    env: { OPENAI_API_KEY: "oa_test" },
  });

  assert.equal(provider.capabilities.imageToImage, true);
  assert.equal(provider.capabilities.inpainting, true);
  assert.equal(provider.capabilities.multiReference, true);
});

test("priced OpenAI image candidate sends locked-template reference work to images/edits", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const abortController = new AbortController();
  const provider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"), {
    env: { OPENAI_API_KEY: "oa_test" },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });

      return new Response(JSON.stringify({ data: [{ b64_json: "ZWRpdGVk" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const output = await provider.generate({
    prompt: "Prepare this listing photo for a locked template frame",
    referenceAssets: ["data:image/png;base64,aW1hZ2U="],
    aspectRatio: "1:1",
    stylePreset: "locked_template_photo_prep",
    requiresReferenceAssets: true,
    signal: abortController.signal,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/images/edits");
  assert.equal(calls[0].init.signal, abortController.signal);
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer oa_test");
  assert.equal(headers["Content-Type"], undefined);

  const body = calls[0].init.body as FormData;
  assert.equal(body.get("model"), "gpt-image-2");
  assert.equal(body.get("size"), "1024x1024");
  assert.equal(body.get("quality"), "high");
  assert.equal(body.get("n"), "1");
  assert.ok(body.get("image") instanceof Blob);
  assert.equal(body.has("mask"), false);
  assert.doesNotMatch(String(body.get("prompt")), /data:image/);

  assert.equal(output.assetUrl, "data:image/png;base64,ZWRpdGVk");
  assert.equal(output.model, "gpt-image-2");
  assert.equal(output.providerMetadata.mode, "edit");
});

test("priced OpenAI image candidate attaches a mask when one is supplied", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"), {
    env: { OPENAI_API_KEY: "oa_test" },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: [{ b64_json: "bWFza2Vk" }] }), { status: 200 });
    },
  });

  await provider.generate({
    prompt: "Extend to story frame",
    referenceAssets: ["data:image/png;base64,aW1hZ2U="],
    maskImage: "data:image/png;base64,bWFzaw==",
    aspectRatio: "9:16",
    stylePreset: "truth_preserving_real_estate_repair",
    requiresReferenceAssets: true,
  });

  const body = calls[0].init.body as FormData;
  assert.ok(body.get("mask"), "mask must be attached when provided");
  assert.equal(body.get("size"), "1024x1536");
});

test("priced OpenAI image candidate honours quality tier and the Cloudflare gateway for edits", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"), {
    env: {
      OPENAI_API_KEY: "oa_test",
      BLOCKWISE_OPENAI_IMAGE_QUALITY: "medium",
      CLOUDFLARE_AI_GATEWAY_URL: "https://gateway.example/v1/acct/gw/openai/images/generations",
      CLOUDFLARE_AI_GATEWAY_TOKEN: "cf_test",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: [{ b64_json: "Zm9v" }] }), { status: 200 });
    },
  });

  await provider.generate({
    prompt: "Prepare this listing photo",
    referenceAssets: ["data:image/png;base64,aW1hZ2U="],
    aspectRatio: "1:1",
    stylePreset: "locked_template_photo_prep",
    requiresReferenceAssets: true,
  });

  assert.equal(calls[0].url, "https://gateway.example/v1/acct/gw/openai/images/edits");
  assert.equal((calls[0].init.headers as Record<string, string>)["cf-aig-authorization"], "Bearer cf_test");
  assert.equal((calls[0].init.body as FormData).get("quality"), "medium");
});

test("resolveOpenAiImageEditsUrl derives the edits endpoint from a gateway URL", () => {
  assert.equal(resolveOpenAiImageEditsUrl({}), "https://api.openai.com/v1/images/edits");
  assert.equal(
    resolveOpenAiImageEditsUrl({ CLOUDFLARE_AI_GATEWAY_URL: "https://gw/openai/images/generations" }),
    "https://gw/openai/images/edits",
  );
  assert.equal(
    resolveOpenAiImageEditsUrl({ CLOUDFLARE_AI_GATEWAY_URL: "https://gw/openai/generations" }),
    "https://gw/openai/edits",
  );
});
