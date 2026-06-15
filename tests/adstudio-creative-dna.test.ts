import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  extractCreativeSkeletonForAd,
  parseCreativeSkeletonResponse,
  SKELETON_PROMPT_KEYS,
} from "../src/lib/ad-template-library/creative-dna.ts";
import { getActivePromptBundle } from "../src/lib/operator/prompts/prompt-registry.ts";
import { assembleSkeletonExtractionPrompt } from "../src/lib/operator/prompts/assemble-prompt.ts";
import { validateProviderJsonOutput, type TextProviderAdapter } from "../src/lib/adstudio/providers.ts";
import { creativeSkeletonSchema } from "../src/lib/ad-template-library/skeleton.ts";

const fixture = JSON.parse(readFileSync("tests/fixtures/adstudio-template-engine-foundation.json", "utf8")) as {
  creativeSkeletons: unknown[];
};

const observedAd = {
  observedAdId: "11111111-1111-4111-8111-111111111111",
  adCreativeId: "22222222-2222-4222-8222-222222222222",
  imageUrl: "https://cdn.example/ad.jpg",
  headline: "Maylands market snapshot",
  body: "See what recent buyer demand means for your next move.",
  cta: "Get the report",
  adType: "market_update",
  primaryIntent: "seller_leads",
  format: "4:5",
  advertiserName: "Northstar Realty",
};

test("skeleton extraction prompt assembles with schema and observed ad metadata", async () => {
  const bundle = await getActivePromptBundle(SKELETON_PROMPT_KEYS, undefined, null);
  const prompt = assembleSkeletonExtractionPrompt({ bundle, observedAd });

  assert.match(prompt.system, /CreativeSkeleton schema/);
  assert.match(prompt.user, /Extraction rules:/);
  assert.match(prompt.user, /Headline: Maylands market snapshot/);
  assert.match(prompt.user, /Image URL: https:\/\/cdn\.example\/ad\.jpg/);
  assert.equal(prompt.promptVersions.length, 4);
  assert.equal(prompt.fallbackPromptUsed, true);
});

test("creativeSkeleton provider schema validates fixture output", () => {
  const result = validateProviderJsonOutput({
    rawText: JSON.stringify(fixture.creativeSkeletons[0]),
    schemaName: "creativeSkeleton",
  });

  assert.equal(result.ok, true);
  assert.equal(creativeSkeletonSchema.parse(result.value).archetype, "listing_hero");
});

test("extractCreativeSkeletonForAd parses provider output and attaches image input", async () => {
  const calls: Array<{ imageUrl?: string; schemaName: string }> = [];
  const provider: TextProviderAdapter = {
    providerName: "test",
    providerType: "text_generation",
    capabilities: { structuredJson: true, visionInput: true },
    async generate(input) {
      calls.push({ imageUrl: input.imageUrl, schemaName: input.schemaName });
      return {
        json: fixture.creativeSkeletons[1],
        rawText: JSON.stringify(fixture.creativeSkeletons[1]),
        usage: { inputTokens: 10, outputTokens: 20 },
        providerMetadata: { model: "vision-test" },
      };
    },
  };

  const bundle = await getActivePromptBundle(SKELETON_PROMPT_KEYS, undefined, null);
  const result = await extractCreativeSkeletonForAd({ ad: observedAd, provider, bundle });

  assert.equal(calls[0]?.schemaName, "creativeSkeleton");
  assert.equal(calls[0]?.imageUrl, observedAd.imageUrl);
  assert.equal(result.skeleton.archetype, "market_stat");
  assert.equal(result.providerMetadata.model, "vision-test");
});

test("creative skeleton response rejects malformed model output before persistence", () => {
  assert.throws(
    () =>
      parseCreativeSkeletonResponse({
        json: { archetype: "made_up" },
        rawText: "{\"archetype\":\"made_up\"}",
        usage: {},
        providerMetadata: {},
      }),
    /failed schema validation/i,
  );
});
