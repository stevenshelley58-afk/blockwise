import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createTextProviderForCandidate } from "../../src/lib/adstudio/ai-providers.ts";
import { resolveModelProfile } from "../../src/lib/ai/model-registry.ts";

test("Ad Studio copy uses cheap_draft_text for resolution, reservations, and run persistence", () => {
  const source = readFileSync("src/lib/adstudio/copy-generation.ts", "utf8");

  assert.match(source, /const ADSTUDIO_COPY_MODEL_PROFILE = "cheap_draft_text" as const/);
  assert.match(source, /resolveRuntimeModelProfile\(ADSTUDIO_COPY_MODEL_PROFILE\)/);
  assert.match(source, /executeAdStudioProviderAttempt<TextProviderResponse>\(\{[\s\S]*?modelProfile: ADSTUDIO_COPY_MODEL_PROFILE/);
  assert.equal(
    (source.match(/modelProfile: ADSTUDIO_COPY_MODEL_PROFILE/g) ?? []).length,
    5,
    "both copy flows must persist completed/failed runs and reserve attempts against the same profile",
  );
  assert.doesNotMatch(source, /structured_json/);
});

test("the cheap draft DeepSeek candidate returns every template and Meta copy field as structured JSON", async () => {
  const candidate = resolveModelProfile("cheap_draft_text").primary;
  assert.equal(candidate.provider, "deepseek");
  assert.equal(candidate.supportsStructuredOutput, true);

  const expected = {
    onImage: {
      headline: "Open home this Saturday",
      address: "18 Smith Street, Scarborough",
      supporting: "Three bedrooms · Two bathrooms",
    },
    primaryText: "A bright Scarborough home, open this Saturday.\nExplore the spaces and request the property guide.",
    headline: "See 18 Smith Street",
    description: "Request the property guide and inspection details.",
    cta: "LEARN_MORE",
    altHeadlines: ["Scarborough open home"],
    altPrimaryTexts: ["Explore this Scarborough home and request the guide."],
  };
  let requestBody: Record<string, unknown> | undefined;
  const provider = createTextProviderForCandidate(candidate, {
    env: { DEEPSEEK_API_KEY: "deepseek_test" },
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "deepseek-copy-request",
        choices: [{ message: { content: JSON.stringify(expected) } }],
        usage: { prompt_tokens: 80, completion_tokens: 55 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const output = await provider.generate({
    system: "Return the complete ad copy as JSON.",
    messages: [{ role: "user", content: "Write all on-image and Meta fields for this property brief." }],
    schemaName: "metaLeadAdPack",
  });

  assert.equal(requestBody?.model, "deepseek-chat");
  assert.deepEqual(requestBody?.response_format, { type: "json_object" });
  assert.deepEqual(output.json, expected);
  assert.deepEqual(Object.keys((output.json as typeof expected).onImage), ["headline", "address", "supporting"]);
  for (const field of ["primaryText", "headline", "description", "cta"] as const) {
    assert.ok((output.json as typeof expected)[field].length > 0, `${field} must be populated`);
  }
});
