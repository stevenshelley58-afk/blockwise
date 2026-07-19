import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createImageProviderForCandidate,
  createTextProviderForCandidate,
  resolveOpenAiImageEditsUrl,
} from "../src/lib/adstudio/ai-providers.ts";
import { ProviderRequestError } from "../src/lib/adstudio/providers.ts";
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

test("active adapters contain only direct OpenAI and Gemini endpoints", () => {
  const source = readFileSync("src/lib/adstudio/ai-providers.ts", "utf8");
  assert.match(source, /https:\/\/api\.openai\.com\/v1\/chat\/completions/);
  assert.match(source, /https:\/\/generativelanguage\.googleapis\.com\/v1beta\/openai\/chat\/completions/);
  assert.doesNotMatch(source, /openrouter|azure|CLOUDFLARE_AI_GATEWAY/iu);
});

test("direct OpenAI text adapter posts structured JSON requests", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createTextProviderForCandidate(candidate("openai", "gpt-5.5"), {
    env: { OPENAI_API_KEY: "oa_test" },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ status: "OK" }) } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }), { status: 200 });
    },
  });
  const output = await provider.generate({
    system: "Return JSON",
    messages: [{ role: "user", content: "Check" }],
    schemaName: "metaLeadAdPack",
  });
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer oa_test");
  assert.deepEqual(output.json, { status: "OK" });
});

test("direct Gemini text adapter uses the Google endpoint and key", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createTextProviderForCandidate(candidate("google", "gemini-2.5-flash-lite"), {
    env: { GOOGLE_AI_API_KEY: "google_test" },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"status\":\"OK\"}" } }] }), { status: 200 });
    },
  });
  await provider.generate({ system: "JSON", messages: [{ role: "user", content: "Check" }], schemaName: "metaLeadAdPack" });
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer google_test");
});

test("direct adapters fail before dispatch when their one credential is missing", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response("{}"); };
  await assert.rejects(
    () => createTextProviderForCandidate(candidate("openai", "gpt-5.5"), { env: {}, fetchImpl }).generate({
      system: "JSON", messages: [{ role: "user", content: "Check" }], schemaName: "metaLeadAdPack",
    }),
    /OPENAI_API_KEY/,
  );
  await assert.rejects(
    () => createTextProviderForCandidate(candidate("google", "gemini-2.5-flash-lite"), { env: {}, fetchImpl }).generate({
      system: "JSON", messages: [{ role: "user", content: "Check" }], schemaName: "metaLeadAdPack",
    }),
    /GOOGLE_AI_API_KEY/,
  );
  assert.equal(calls, 0);
});

test("candidate adapters retain exact runtime pricing", () => {
  const provider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"));
  assert.equal(provider.accounting?.pricingSnapshotId, "11111111-1111-4111-8111-111111111111");
  assert.equal(provider.accounting?.pricing.imageUsdPerUnit, 0.039);
  assert.equal(provider.accounting?.pricing.currency, "USD");
});

test("GPT Image 2 generation and edits always use direct OpenAI endpoints", async () => {
  const calls: string[] = [];
  const provider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"), {
    env: { OPENAI_API_KEY: "oa_test" },
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ data: [{ b64_json: "aW1hZ2U=" }] }), { status: 200 });
    },
  });
  await provider.generate({ prompt: "Create", referenceAssets: [], aspectRatio: "1:1", stylePreset: "minimal" });
  await provider.generate({
    prompt: "Edit", referenceAssets: ["data:image/png;base64,aW1hZ2U="], aspectRatio: "1:1",
    stylePreset: "minimal", requiresReferenceAssets: true,
  });
  assert.deepEqual(calls, [
    "https://api.openai.com/v1/images/generations",
    "https://api.openai.com/v1/images/edits",
  ]);
  assert.equal(resolveOpenAiImageEditsUrl({ CLOUDFLARE_AI_GATEWAY_URL: "https://ignored.example" }), "https://api.openai.com/v1/images/edits");
});

test("Gemini image generation uses the direct interactions endpoint", async () => {
  const calls: string[] = [];
  const provider = createImageProviderForCandidate(candidate("google", "gemini-3.1-flash-image"), {
    env: { GOOGLE_AI_API_KEY: "google_test" },
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({
        id: "google-request",
        steps: [{ type: "model_output", content: [{ type: "image", data: "aW1hZ2U=", mime_type: "image/png" }] }],
      }), { status: 200 });
    },
  });
  const output = await provider.generate({
    prompt: "Clone", referenceAssets: ["data:image/png;base64,aW1hZ2U="], aspectRatio: "4:5", stylePreset: "clone",
  });
  assert.deepEqual(calls, ["https://generativelanguage.googleapis.com/v1beta/interactions"]);
  assert.equal(output.assetUrl, "data:image/png;base64,aW1hZ2U=");
});

test("provider errors retain retryability without dispatching another provider", async () => {
  let calls = 0;
  const provider = createImageProviderForCandidate(candidate("openai", "gpt-image-2"), {
    env: { OPENAI_API_KEY: "oa_test" },
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 });
    },
  });
  await assert.rejects(() => provider.generate({
    prompt: "Create", referenceAssets: [], aspectRatio: "1:1", stylePreset: "minimal",
  }), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(calls, 1);
});
