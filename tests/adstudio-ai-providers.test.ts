import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAiImageProvider,
  createOpenRouterTextProvider,
  generateMixedImageVariantsInParallel,
} from "../src/lib/adstudio/ai-providers.ts";
import { generateTruthPreservingRepair } from "../src/lib/adstudio/image-repair.ts";
import type { ImageProviderAdapter } from "../src/lib/adstudio/providers.ts";

test("createOpenRouterTextProvider posts structured prompts and parses JSON responses", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createOpenRouterTextProvider({
    env: {
      OPENROUTER_API_KEY: "or_test",
      NEXT_PUBLIC_APP_URL: "https://app.blockwise.test",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ platform: "meta", primaryText: ["ok"] }) } }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
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
  assert.equal(output.providerMetadata.model, "openai/gpt-5.5");
});

test("createOpenAiImageProvider defaults client creative generation to GPT Image 2", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createOpenAiImageProvider({
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
});

test("createOpenAiImageProvider refuses reference-image repair without calling text-only generation", async () => {
  let called = false;
  const provider = createOpenAiImageProvider({
    env: {
      OPENAI_API_KEY: "oa_test",
    },
    fetchImpl: async () => {
      called = true;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
  });

  await assert.rejects(
    () =>
      provider.generate({
        prompt: "Repair this listing photo",
        referenceAssets: ["data:image/png;base64,aW1hZ2U="],
        aspectRatio: "1:1",
        stylePreset: "truth_preserving_real_estate_repair",
        requiresReferenceAssets: true,
      }),
    /not configured for auto fit/,
  );
  assert.equal(called, false);
});

test("truth-preserving repair skips unsupported providers and uses reference-capable provider", async () => {
  let unsupportedCalled = false;
  let supportedCalled = false;
  const unsupported: ImageProviderAdapter = {
    providerName: "openai",
    providerType: "image_generation",
    capabilities: { textToImage: true },
    async generate() {
      unsupportedCalled = true;
      throw new Error("Should not be called");
    },
  };
  const supported: ImageProviderAdapter = {
    providerName: "openrouter",
    providerType: "image_generation",
    capabilities: { textToImage: true, imageToImage: true, multiReference: true },
    async generate(input) {
      supportedCalled = true;
      assert.equal(input.requiresReferenceAssets, true);
      assert.deepEqual(input.referenceAssets, ["data:image/png;base64,aW1hZ2U="]);
      return {
        assetUrl: "data:image/png;base64,cmVwYWlyZWQ=",
        seed: 1,
        model: "reference-model",
        providerMetadata: { provider: "openrouter" },
      };
    },
  };

  const result = await generateTruthPreservingRepair({
    imageInput: {
      prompt: "Repair this listing photo",
      referenceAssets: ["data:image/png;base64,aW1hZ2U="],
      aspectRatio: "1:1",
      stylePreset: "truth_preserving_real_estate_repair",
    },
    providers: [unsupported, supported],
  });

  assert.equal(unsupportedCalled, false);
  assert.equal(supportedCalled, true);
  assert.equal(result.providerName, "openrouter");
  assert.equal(result.result.assetUrl, "data:image/png;base64,cmVwYWlyZWQ=");
  assert.equal(result.attempts[0]?.status, "failed");
  assert.equal(result.attempts[1]?.status, "completed");
});

test("generateMixedImageVariantsInParallel fans out two GPT Image and two Nano Banana jobs", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  const variants = await generateMixedImageVariantsInParallel(
    {
      prompt: "Premium local real estate appraisal creative",
      referenceAssets: [],
      aspectRatio: "1:1",
      stylePreset: "real_estate_photography",
    },
    {
      env: {
        OPENAI_API_KEY: "oa_test",
        OPENROUTER_API_KEY: "or_test",
        NEXT_PUBLIC_APP_URL: "https://app.blockwise.test",
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });

        if (String(url).includes("openrouter.ai")) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    images: [{ image_url: { url: "data:image/png;base64,bmFubw==" } }],
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            data: [{ b64_json: "Y2hhdGdwdA==" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );

  assert.equal(calls.length, 4);
  assert.equal(calls.filter((call) => call.url.includes("api.openai.com")).length, 2);
  assert.equal(calls.filter((call) => call.url.includes("openrouter.ai")).length, 2);
  assert.deepEqual(
    calls.map((call) => JSON.parse(String(call.init.body)).model),
    ["gpt-image-2", "gpt-image-2", "google/gemini-3.1-flash-image-preview", "google/gemini-3.1-flash-image-preview"],
  );
  assert.equal(variants.length, 4);
  assert.equal(variants[0]?.assetUrl, "data:image/png;base64,Y2hhdGdwdA==");
  assert.equal(variants[2]?.assetUrl, "data:image/png;base64,bmFubw==");
});
