// Track E (§6): deterministic generation contract. No image model on the
// path; over-limit copy and undersized photos are honest 400s, never silent
// truncation or slop; renders carry the canonical media paths.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import sharp from "sharp";

import {
  generateV2Campaign,
  V2GenerationError,
} from "../../src/lib/adstudio/v2/generate.ts";
import type { AdStudioBrandKit } from "../../src/lib/adstudio/types.ts";

const root = resolve(process.cwd());
const fixtures = join(root, "tests", "fixtures", "adstudio-v2");
const fixtureId = "meta-fixture-story";
const template = JSON.parse(readFileSync(join(fixtures, fixtureId, "template.json"), "utf8"));

const uploads: string[] = [];
const supabaseStub = {
  storage: {
    from: () => ({
      download: async () => ({ data: null, error: { message: "unused" } }),
      upload: async (path: string) => {
        uploads.push(path);
        return { error: null };
      },
    }),
  },
} as never;

const brandKit = {
  brandKitId: "bk_test",
  workspaceId: "workspace_demo",
  source: { type: "manual", url: "", lastExtractedAt: "", pagesScanned: [] },
  identity: { businessName: "Harness Realty", marketCountry: "AU", marketRegion: "WA" },
  logos: {},
  colours: {},
  reviewStatus: "approved",
} as unknown as AdStudioBrandKit;

async function photoPng(width: number, height: number): Promise<string> {
  const bytes = await sharp({
    create: { width, height, channels: 3, background: { r: 90, g: 120, b: 160 } },
  }).png().toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

const renderOptions = {
  repoRoot: fixtures,
  fontsDir: join(root, "public", "fonts", "adstudio"),
};

function baseInput(imageDataUrl: string, text?: Record<string, string>) {
  return {
    workspaceId: "workspace_demo",
    userId: "user_1",
    template,
    brandKit,
    firstAd: {
      source: "gallery" as const,
      templateId: fixtureId,
      description: "Open home Saturday in Scarborough.",
      imageDataUrl,
      formats: ["9:16", "4:5"] as ["9:16", "4:5"],
    },
    text,
    supabase: supabaseStub,
    renderOptions,
  };
}

test("happy path: inline renders feed + story, instance docs canonical, warnings empty", async () => {
  const photo = await photoPng(1400, 1750);
  // Customer copy verbatim: the text-AI assist only runs for missing fields,
  // and the tests never exercise the AI path (it needs server env).
  const result = await generateV2Campaign(baseInput(photo, { headline: "Fresh homes in Scarborough" }));

  assert.equal(result.warnings.length, 0);
  assert.ok(result.renderMs < 10_000, `renders took ${result.renderMs}ms`);
  assert.equal(result.pack.creatives.length, 2, "feed + story creatives");
  for (const creative of result.pack.creatives) {
    const canvas = creative.canvas as { schema?: string; renders?: Record<string, string> };
    assert.equal(canvas.schema, "adstudio.instance.v2");
    assert.ok(canvas.renders?.feed, "canonical feed render persisted");
    assert.ok(canvas.renders?.story, "canonical story render persisted");
  }
  assert.ok(uploads.some((path) => path.includes("/adstudio/renders/")), "renders land under adstudio/renders");
  // Publish defaults prefilled from the template's publish block.
  assert.equal(result.pack.copyPacks[0].meta.cta, template.publish.cta);
  assert.equal(result.pack.campaign.templateKey, fixtureId);
});

test("over-limit copy is a 400 with guidance — never truncated", async () => {
  const photo = await photoPng(1400, 1750);
  const limit = template.inputs.text[0].maxLength as number;
  await assert.rejects(
    generateV2Campaign(baseInput(photo, { headline: "x".repeat(limit + 30) })),
    (error: unknown) => {
      assert.ok(error instanceof V2GenerationError);
      assert.equal(error.status, 400);
      assert.match(error.message, /Shorten/);
      return true;
    },
  );
});

test("a photo below half the slot's minimum is a 400, not slop", async () => {
  const slot = template.formats.feed.layers.find((layer: { type: string }) => layer.type === "image_slot");
  const tiny = await photoPng(Math.max(8, Math.round(slot.box.width * 1080 * 0.3)), Math.max(8, Math.round(slot.box.height * 1350 * 0.3)));
  await assert.rejects(
    generateV2Campaign(baseInput(tiny, { headline: "Fresh homes in Scarborough" })),
    (error: unknown) => {
      assert.ok(error instanceof V2GenerationError);
      assert.equal(error.status, 400);
      assert.match(error.message, /too small/i);
      return true;
    },
  );
});

test("a photo below the slot's ideal resolution warns but renders", async () => {
  const slot = template.formats.feed.layers.find((layer: { type: string }) => layer.type === "image_slot");
  // 0.7x the slot's ideal pixels: above the 0.5x hard floor, below 1.0x.
  const soft = await photoPng(Math.round(slot.box.width * 1080 * 0.7), Math.round(slot.box.height * 1350 * 0.7));
  const result = await generateV2Campaign(baseInput(soft, { headline: "Fresh homes in Scarborough" }));
  assert.ok(result.warnings.length >= 1, "soft-resolution warning surfaced");
});
