import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAiImageProvider,
  createOpenRouterTextProvider,
  generateMixedImageVariantsInParallel,
} from "../src/lib/adstudio/ai-providers.ts";

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

test("createOpenAiImageProvider sends reference-image jobs to images edits", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createOpenAiImageProvider({
    env: {
      OPENAI_API_KEY: "oa_test",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: [{ b64_json: "ZWRpdGVk" }] }), { status: 200 });
    },
  });

  const output = await provider.generate({
    prompt: "Prepare this listing photo for a locked template frame",
    referenceAssets: ["data:image/png;base64,aW1hZ2U="],
    aspectRatio: "1:1",
    stylePreset: "locked_template_photo_prep",
    requiresReferenceAssets: true,
  });
  const form = calls[0]?.init.body as FormData;

  assert.equal(calls[0]?.url, "https://api.openai.com/v1/images/edits");
  assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, "Bearer oa_test");
  assert.equal(form.get("model"), "gpt-image-2");
  assert.equal(form.get("quality"), "high");
  assert.equal(form.get("size"), "1024x1024");
  assert.ok(form.get("image") instanceof Blob);
  assert.equal(output.assetUrl, "data:image/png;base64,ZWRpdGVk");
  assert.equal(output.providerMetadata.endpoint, "images.edit");
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
