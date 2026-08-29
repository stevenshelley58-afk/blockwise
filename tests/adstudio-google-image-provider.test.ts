import assert from "node:assert/strict";
import test from "node:test";

import { createGoogleImageProvider } from "../src/lib/adstudio/google-image-provider.ts";
import { ProviderRequestError } from "../src/lib/adstudio/providers.ts";
import type { ImageProviderRequest, ProviderAccountingContext } from "../src/lib/adstudio/providers.ts";

const accounting: ProviderAccountingContext = {
  model: "gemini-3.1-flash-image",
  pricing: {
    inputUsdPerMillionTokens: 0.5,
    outputUsdPerMillionTokens: 3,
    imageUsdPerUnit: 0.04,
  },
};

const request: ImageProviderRequest = {
  prompt: "Clone the reference ad with the supplied property and portrait images.",
  referenceAssets: [
    "data:image/png;base64,aW1hZ2Utb25l",
    "data:image/jpeg;base64,aW1hZ2UtdHdv",
  ],
  aspectRatio: "4:5",
  stylePreset: "real_estate_clone",
  requiresReferenceAssets: true,
};

test("Google image provider requires its direct API key before dispatch", async () => {
  const provider = createGoogleImageProvider(accounting, { env: {} });
  await assert.rejects(() => provider.generate(request), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.requestSubmitted, false);
    assert.match(error.message, /GOOGLE_AI_API_KEY/);
    return true;
  });
});

test("Google image provider edits with multiple inline references through the direct API", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const provider = createGoogleImageProvider(accounting, {
    env: { GOOGLE_AI_API_KEY: "google-test-key" },
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({
        steps: [{
          type: "model_output",
          content: [{ type: "image", mime_type: "image/jpeg", data: "ZmluaXNoZWQtYWQ=" }],
        }],
        usage_metadata: { total_token_count: 321 },
      }));
    },
  });

  const output = await provider.generate(request);
  assert.equal(capturedUrl, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(new Headers(capturedInit?.headers).get("x-goog-api-key"), "google-test-key");
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.model, "gemini-3.1-flash-image");
  assert.deepEqual(body.input.slice(0, 2), [
    { type: "image", data: "aW1hZ2Utb25l", mime_type: "image/png" },
    { type: "image", data: "aW1hZ2UtdHdv", mime_type: "image/jpeg" },
  ]);
  assert.equal(body.input[2].type, "text");
  assert.match(body.input[2].text, /Clone the reference ad/);
  assert.deepEqual(body.response_modalities, ["text", "image"]);
  assert.deepEqual(body.response_format, {
    type: "image",
    aspect_ratio: "4:5",
    image_size: "1K",
  });
  assert.equal(output.assetUrl, "data:image/jpeg;base64,ZmluaXNoZWQtYWQ=");
  assert.equal(output.model, "gemini-3.1-flash-image");
  assert.equal(output.providerMetadata.provider, "google");
  assert.deepEqual(output.usage, { imageUnits: 1, complete: true });
});

test("Google direct API transient failures enter the existing provider fallback", async () => {
  const provider = createGoogleImageProvider(accounting, {
    env: { GOOGLE_AI_API_KEY: "google-test-key" },
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "quota busy" } }), { status: 429 }),
  });

  await assert.rejects(() => provider.generate(request), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.requestSubmitted, true);
    assert.equal(error.retryable, true);
    return true;
  });
});
