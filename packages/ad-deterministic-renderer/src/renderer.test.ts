import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderPlacement, renderBoth, RenderFitError } from "./renderer.ts";
import type { TemplatePack, Rect } from "@blockwise/ad-template-pack-contract";

// ---------------------------------------------------------------------------
// Test font: a real font from the Blockwise public corpus if present.
// Font-hash tests skip cleanly when the corpus is unavailable.
// ---------------------------------------------------------------------------

let fontBuf: Buffer | null = null;
let fontSha = "";
try {
  fontBuf = readFileSync(new URL(`../../../../public/fonts/adstudio/arimo-600.woff2`, import.meta.url));
  fontSha = createHash("sha256").update(fontBuf).digest("hex");
} catch {
  fontBuf = null;
}

// Minimal pack — single plate, no fonts needed by layers
const smokePack: TemplatePack = {
  schema: "blockwise.template-pack/v1",
  templateId: "smoke-001",
  version: 1,
  packId: "pack-smoke-001-v1",
  createdAt: "2026-08-12T00:00:00.000Z",
  builderVersion: "frank/0.1.0",
  rendererVersion: "renderer/0.1.0",
  classification: { label: "agent_intro_feed", modelVersion: "radar/v3", confidence: 0.94 },
  manifestSha256: "0".repeat(64),
  signature: "sig",
  feedLayout: {
    placement: "feed",
    layers: [
      { type: "plate", layerId: "bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: false },
    ],
    safeZones: [{ x: 0, y: 0, width: 1080, height: 1350 }],
  },
  storyLayout: {
    placement: "story",
    layers: [
      { type: "plate", layerId: "bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1920 }, protected: false },
    ],
    safeZones: [{ x: 0, y: 0, width: 1080, height: 1920 }],
  },
  imageInputs: [],
  textInputs: [],
  semanticColours: { background: "#FFFFFF", primary: "#1A56DB", secondary: "#6B7280", accent: "#F59E0B", mainText: "#111827", inverseText: "#FFFFFF" },
  assets: {},
  fonts: [],
  safePreviews: { feed: { sha256: "0".repeat(64) }, story: { sha256: "0".repeat(64) } },
  qaEvidence: { feedPassed: true, storyPassed: true, reviewerVersions: ["v1"], stressFixtureResults: {} },
};

function packWithText(overflow: "refuse" | "truncate" | "scale_down", fonts: TemplatePack["fonts"] = []): TemplatePack {
  const pack = structuredClone(smokePack);
  pack.fonts = fonts;
  pack.feedLayout.layers.push({
    type: "text", layerId: "headline", inputKey: "headline",
    font: { file: fonts[0]?.file ?? "Missing.woff2", sha256: fonts[0]?.sha256 ?? "0".repeat(64) },
    fontSize: 48, lineHeight: 1.2, tracking: 0, alignment: "left",
    maxCharacters: 60, maxLines: 2, colourRole: "mainText", overflowBehaviour: overflow,
    // Intentionally narrow box to force wrapping/refusal decisions
    geometry: { x: 40, y: 40, width: 400, height: 200 },
  } as TemplatePack["feedLayout"]["layers"][number]);
  return pack;
}

const input = (over: Partial<Parameters<typeof renderPlacement>[0]> = {}) => ({
  pack: smokePack, imageValues: {}, textValues: {}, colourMap: smokePack.semanticColours, ...over,
});

describe("Deterministic renderer", () => {
  it("renders feed placement at 1080×1350", async () => {
    const result = await renderPlacement(input(), "feed");
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1350);
    assert.ok(Buffer.isBuffer(result.png));
    assert.ok(result.png.length > 0);
    assert.equal(result.sha256.length, 64);
  });

  it("renders story placement at 1080×1920", async () => {
    const result = await renderPlacement(input(), "story");
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1920);
  });

  it("is deterministic — same inputs, byte-identical PNG", async () => {
    const a = await renderPlacement(input(), "feed");
    const b = await renderPlacement(input(), "feed");
    assert.equal(a.sha256, b.sha256);
    assert.deepEqual(a.png, b.png);
  });

  it("renderBoth returns [feed, story]", async () => {
    const [feed, story] = await renderBoth(input());
    assert.equal(feed.placement, "feed");
    assert.equal(story.placement, "story");
  });

  it("different colours produce different output", async () => {
    const a = await renderPlacement(input({ colourMap: { ...smokePack.semanticColours, background: "#FFFFFF" } }), "feed");
    const b = await renderPlacement(input({ colourMap: { ...smokePack.semanticColours, background: "#000000" } }), "feed");
    assert.notEqual(a.sha256, b.sha256);
  });

  it("rejects invalid crop coordinates with a stable error", async () => {
    const badCrop: Rect = { x: -0.2, y: 0, width: 1, height: 1 };
    // image_slot layer with a provided image and invalid crop
    const { createCanvas } = await import("@napi-rs/canvas");
    const c = createCanvas(200, 200);
    const ctx = c.getContext("2d");
    ctx.fillRect(0, 0, 200, 200);
    const png = Buffer.from(c.toBuffer("image/png"));

    const pack = structuredClone(smokePack);
    pack.imageInputs.push({ key: "photo", label: "Photo", acceptedTypes: ["image/png"] });
    pack.feedLayout.layers.push({
      type: "image_slot", layerId: "hero", inputKey: "photo",
      geometry: { x: 0, y: 0, width: 1080, height: 800 }, mask: "none",
      minSourceWidth: 100, minSourceHeight: 100,
      defaultCrop: { x: 0, y: 0, width: 1, height: 1 },
      allowedPlacementOverrides: ["crop"],
    } as TemplatePack["feedLayout"]["layers"][number]);

    await assert.rejects(
      renderPlacement(input({ pack, imageValues: { photo: png }, cropOverrides: { feed: { photo: badCrop } } }), "feed"),
      (err: unknown) => err instanceof RenderFitError && err.code === "invalid_crop",
    );
  });

  it("font hash mismatch is refused — never a silent fallback", async () => {
    if (!fontBuf) return; // corpus font unavailable in this env
    const fonts = [{ file: "arimo-600.woff2", sha256: "0".repeat(64) }]; // wrong hash on purpose
    const pack = packWithText("refuse", fonts);
    await assert.rejects(
      renderPlacement(input({ pack, textValues: { headline: "Hello" }, fonts: { "arimo-600.woff2": fontBuf } }), "feed"),
      (err: unknown) => err instanceof RenderFitError && err.code === "font_hash_mismatch",
    );
  });

  it("overflow refuse throws a stable text_overflow error (never silent drop)", async () => {
    if (!fontBuf) return;
    const fonts = [{ file: "arimo-600.woff2", sha256: fontSha }];
    const pack = packWithText("refuse", fonts);
    await assert.rejects(
      renderPlacement(input({ pack, textValues: { headline: "This headline is far too long to ever fit inside a 400 pixel box in two lines at 48px" }, fonts: { "arimo-600.woff2": fontBuf } }), "feed"),
      (err: unknown) => err instanceof RenderFitError && err.code === "text_overflow",
    );
  });

  it("overflow truncate renders without throwing on long text", async () => {
    if (!fontBuf) return;
    const fonts = [{ file: "arimo-600.woff2", sha256: fontSha }];
    const pack = packWithText("truncate", fonts);
    const result = await renderPlacement(input({ pack, textValues: { headline: "This headline is far too long to ever fit inside a 400 pixel box in two lines at 48px, and truncation keeps the output deterministic" }, fonts: { "arimo-600.woff2": fontBuf } }), "feed");
    assert.equal(result.width, 1080);
  });
});
