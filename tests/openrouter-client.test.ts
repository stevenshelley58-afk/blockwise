import assert from "node:assert/strict";
import test from "node:test";

import { fetchOpenRouterModelCatalog, testOpenRouterModel } from "../src/lib/model-control/openrouter-client.ts";

test("fetchOpenRouterModelCatalog maps OpenRouter model metadata to catalog options", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "openrouter/google/gemini-2.0-flash-001",
            name: "Google: Gemini 2.0 Flash",
            context_length: 1000000,
            pricing: {
              prompt: "0.0000001",
              completion: "0.0000004",
              image: "0",
            },
            architecture: {
              input_modalities: ["text", "image"],
              output_modalities: ["text"],
            },
            supported_parameters: ["response_format", "temperature"],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const options = await fetchOpenRouterModelCatalog({
    env: {
      OPENROUTER_API_KEY: "sk-or-v1-secret",
      NEXT_PUBLIC_APP_URL: "https://blockwise.example",
    },
    fetchImpl,
  });

  assert.deepEqual(options, [
    {
      provider: "openrouter",
      model: "google/gemini-2.0-flash-001",
      label: "Google: Gemini 2.0 Flash",
      inputUsdPerMillionTokens: 0.1,
      outputUsdPerMillionTokens: 0.4,
      imageUsdPerUnit: 0,
      maxContextTokens: 1_000_000,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
      supportsImageOutput: false,
    },
  ]);
});

test("testOpenRouterModel posts a safe prompt with attribution headers and provider constraints", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;

  const fetchImpl: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "OK" } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await testOpenRouterModel({
    model: "google/gemini-2.0-flash-001",
    requireParameters: true,
    env: {
      OPENROUTER_API_KEY: "sk-or-v1-secret",
      NEXT_PUBLIC_APP_URL: "https://blockwise.example",
    },
    fetchImpl,
  });

  const headers = new Headers(requestedInit?.headers);
  const body = JSON.parse(String(requestedInit?.body));

  assert.equal(result.content, "OK");
  assert.equal(requestedUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(requestedInit?.method, "POST");
  assert.equal(headers.get("Authorization"), "Bearer sk-or-v1-secret");
  assert.equal(headers.get("HTTP-Referer"), "https://blockwise.example");
  assert.equal(headers.get("X-Title"), "Blockwise");
  assert.equal(body.model, "google/gemini-2.0-flash-001");
  assert.equal(body.provider.require_parameters, true);
  assert.deepEqual(body.messages.at(-1), { role: "user", content: "Return OK" });
});

test("testOpenRouterModel fails closed when the OpenRouter key is missing", async () => {
  await assert.rejects(
    () =>
      testOpenRouterModel({
        model: "google/gemini-2.0-flash-001",
        env: {},
        fetchImpl: async () => new Response("{}"),
      }),
    /OPENROUTER_API_KEY is not configured/,
  );
});
