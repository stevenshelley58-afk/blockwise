import assert from "node:assert/strict";
import test from "node:test";

import {
  createAzureOpenAiTextProvider,
  createOpenAiImageProvider,
  createOpenRouterTextProvider,
  resolveAzureOpenAiChatUrl,
  resolveOpenAiImageEditsUrl,
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

test("createAzureOpenAiTextProvider posts structured multimodal prompts to the deployment endpoint", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createAzureOpenAiTextProvider({
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

test("createOpenAiImageProvider exposes reference-capable image capabilities", () => {
  const provider = createOpenAiImageProvider({ env: { OPENAI_API_KEY: "oa_test" } });

  assert.equal(provider.capabilities.imageToImage, true);
  assert.equal(provider.capabilities.inpainting, true);
  assert.equal(provider.capabilities.multiReference, true);
});

test("createOpenAiImageProvider sends locked-template reference work to images/edits", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const abortController = new AbortController();
  const provider = createOpenAiImageProvider({
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

