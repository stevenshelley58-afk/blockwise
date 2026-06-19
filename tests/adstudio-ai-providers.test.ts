import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAiImageProvider,
  createOpenRouterTextProvider,
  generateMixedImageVariantsInParallel,
  resolveOpenAiImageEditsUrl,
} from "../src/lib/adstudio/ai-providers.ts";
import {
  generateTruthPreservingRepair,
  supportsTruthPreservingRepair,
} from "../src/lib/adstudio/image-repair.ts";
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

test("createOpenAiImageProvider satisfies the truth-preserving repair capability gate", () => {
  const provider = createOpenAiImageProvider({ env: { OPENAI_API_KEY: "oa_test" } });

  assert.equal(provider.capabilities.imageToImage, true);
  assert.equal(provider.capabilities.inpainting, true);
  assert.equal(provider.capabilities.multiReference, true);
  assert.equal(supportsTruthPreservingRepair(provider), true);
});

test("createOpenAiImageProvider sends reference-image fit to the images/edits endpoint", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createOpenAiImageProvider({
    env: { OPENAI_API_KEY: "oa_test" },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });

      return new Response(JSON.stringify({ data: [{ b64_json: "cmVwYWlyZWQ=" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const output = await provider.generate({
    prompt: "Repair this listing photo",
    referenceAssets: ["data:image/png;base64,aW1hZ2U="],
    aspectRatio: "9:16",
    stylePreset: "truth_preserving_real_estate_repair",
    requiresReferenceAssets: true,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/images/edits");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer oa_test");
  // multipart boundary must be set by fetch itself, never application/json
  assert.equal(headers["Content-Type"], undefined);

  const body = calls[0].init.body as FormData;
  assert.equal(body.get("model"), "gpt-image-2");
  assert.equal(body.get("size"), "1024x1792");
  assert.equal(body.get("quality"), "high");
  assert.equal(body.get("n"), "1");
  assert.ok(body.get("image"), "reference image must be attached");
  assert.equal(body.has("mask"), false);
  // data: URL must not be dumped into the prompt text
  assert.doesNotMatch(String(body.get("prompt")), /data:image/);

  assert.equal(output.assetUrl, "data:image/png;base64,cmVwYWlyZWQ=");
  assert.equal(output.model, "gpt-image-2");
  assert.equal(output.providerMetadata.mode, "edit");
});

test("createOpenAiImageProvider attaches a mask when one is supplied", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createOpenAiImageProvider({
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
});

test("createOpenAiImageProvider honours quality tier and the Cloudflare gateway for edits", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createOpenAiImageProvider({
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
    prompt: "Repair this listing photo",
    referenceAssets: ["data:image/png;base64,aW1hZ2U="],
    aspectRatio: "1:1",
    stylePreset: "truth_preserving_real_estate_repair",
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
