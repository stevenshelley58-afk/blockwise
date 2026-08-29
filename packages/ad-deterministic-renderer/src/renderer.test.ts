import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPlacement, renderBoth } from "./renderer.js";
import type { TemplatePack } from "@blockwise/ad-template-pack-contract";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BARLOW = readFileSync(join(REPO_ROOT, "public", "fonts", "adstudio", "barlow-600.woff2"));
const CORMORANT = readFileSync(join(REPO_ROOT, "public", "fonts", "adstudio", "cormorant-garamond-700.woff2"));

async function inkBounds(png: Buffer): Promise<{ left: number; top: number; right: number; bottom: number; pixels: number }> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  let pixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const alpha = info.channels === 4 ? data[offset + 3]! : 255;
      const dark = data[offset]! < 245 || data[offset + 1]! < 245 || data[offset + 2]! < 245;
      if (alpha > 0 && dark) {
        pixels += 1;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return { left, top, right, bottom, pixels };
}

function textPack(options: { file: string; sha: string; geometry: { x: number; y: number; width: number; height: number }; inputKey?: string; sizeRatio?: number; fontSize?: number; maxLines?: number; overflow?: "refuse" | "truncate" | "scale_down" }): TemplatePack {
  const pack = structuredClone(smokePack);
  pack.fonts.push({ file: options.file, sha256: options.sha });
  const layer = {
    type: "text" as const,
    layerId: "headline",
    inputKey: options.inputKey ?? "headline",
    font: { file: options.file, sha256: options.sha },
    fontSize: options.fontSize ?? 12,
    lineHeight: 1.05,
    tracking: -0.02,
    alignment: "left" as const,
    maxCharacters: 200,
    maxLines: options.maxLines ?? 2,
    colourRole: "mainText" as const,
    overflowBehaviour: options.overflow ?? "scale_down",
    geometry: options.geometry,
    ...(options.sizeRatio === undefined ? {} : { sizeRatio: options.sizeRatio }),
  };
  pack.feedLayout.layers.push(layer as unknown as (typeof pack.feedLayout.layers)[number]);
  return pack;
}

// Minimal pack for smoke test — reuses the contract golden fixture shape
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

describe("Deterministic renderer", () => {
  it("renders feed placement at 1080×1350", async () => {
    const result = await renderPlacement(
      { pack: smokePack, imageValues: {}, textValues: {}, colourMap: smokePack.semanticColours },
      "feed",
    );
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1350);
    assert.ok(Buffer.isBuffer(result.png));
    assert.ok(result.png.length > 0);
    assert.equal(result.sha256.length, 64);
  });

  it("renders story placement at 1080×1920", async () => {
    const result = await renderPlacement(
      { pack: smokePack, imageValues: {}, textValues: {}, colourMap: smokePack.semanticColours },
      "story",
    );
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1920);
  });

  it("is deterministic — same inputs, byte-identical PNG", async () => {
    const a = await renderPlacement(
      { pack: smokePack, imageValues: {}, textValues: {}, colourMap: smokePack.semanticColours },
      "feed",
    );
    const b = await renderPlacement(
      { pack: smokePack, imageValues: {}, textValues: {}, colourMap: smokePack.semanticColours },
      "feed",
    );
    assert.equal(a.sha256, b.sha256);
    assert.deepEqual(a.png, b.png);
  });

  it("renderBoth returns [feed, story]", async () => {
    const [feed, story] = await renderBoth({ pack: smokePack, imageValues: {}, textValues: {}, colourMap: smokePack.semanticColours });
    assert.equal(feed.placement, "feed");
    assert.equal(story.placement, "story");
  });

  it("different colours produce different output", async () => {
    const a = await renderPlacement(
      { pack: smokePack, imageValues: {}, textValues: {}, colourMap: { ...smokePack.semanticColours, background: "#FFFFFF" } },
      "feed",
    );
    const b = await renderPlacement(
      { pack: smokePack, imageValues: {}, textValues: {}, colourMap: { ...smokePack.semanticColours, background: "#000000" } },
      "feed",
    );
    assert.notEqual(a.sha256, b.sha256);
  });

  it("renders the immutable plate asset declared by a v2 pack", async () => {
    const pack = structuredClone(smokePack);
    pack.feedLayout.layers[0] = { ...pack.feedLayout.layers[0], assetKey: "feed-plate" };
    const plate = await sharp({ create: { width: 16, height: 16, channels: 4, background: "#1f7a4d" } }).png().toBuffer();
    const rendered = await renderPlacement(
      { pack, imageValues: { "feed-plate": plate }, textValues: {}, colourMap: pack.semanticColours },
      "feed",
    );
    const fallback = await renderPlacement(
      { pack: smokePack, imageValues: {}, textValues: {}, colourMap: smokePack.semanticColours },
      "feed",
    );
    assert.notEqual(rendered.sha256, fallback.sha256);
  });

  it("applies Feed crop overrides to the customer image", async () => {
    const pack = structuredClone(smokePack);
    pack.feedLayout.layers.push({
      type: "image_slot", layerId: "customer", inputKey: "customer_photo",
      geometry: { x: 0, y: 0, width: 1080, height: 1350 }, mask: "none",
      minSourceWidth: 2, minSourceHeight: 1,
      defaultCrop: { x: 0, y: 0, width: 1, height: 1 }, allowedPlacementOverrides: ["crop"],
    });
    const source = await sharp(Buffer.from('<svg width="2" height="1"><rect width="1" height="1" fill="red"/><rect x="1" width="1" height="1" fill="blue"/></svg>')).png().toBuffer();
    const left = await renderPlacement(
      { pack, imageValues: { customer_photo: source }, textValues: {}, colourMap: pack.semanticColours, cropOverrides: { customer_photo: { x: 0, y: 0, width: 0.5, height: 1 } } },
      "feed",
    );
    const right = await renderPlacement(
      { pack, imageValues: { customer_photo: source }, textValues: {}, colourMap: pack.semanticColours, cropOverrides: { customer_photo: { x: 0.5, y: 0, width: 0.5, height: 1 } } },
      "feed",
    );
    assert.notEqual(left.sha256, right.sha256);
  });

  it("renders editable vector and icon layers deterministically", async () => {
    const pack = structuredClone(smokePack);
    pack.feedLayout.layers.push(
      { type: "vector", layerId: "notch", geometry: { x: 40, y: 40, width: 400, height: 120 }, shape: "notched", colourRole: "accent", opacity: 1 },
      { type: "vector", layerId: "wave", geometry: { x: 40, y: 220, width: 400, height: 30 }, shape: "wave", colourRole: "secondary", opacity: 1 },
      { type: "icon", layerId: "amenity", geometry: { x: 500, y: 40, width: 80, height: 80 }, icon: "check", colourRole: "mainText" },
    );
    const first = await renderPlacement({ pack, imageValues: {}, textValues: {}, colourMap: pack.semanticColours }, "feed");
    const second = await renderPlacement({ pack, imageValues: {}, textValues: {}, colourMap: pack.semanticColours }, "feed");
    assert.equal(first.sha256, second.sha256);
    assert.notEqual(first.sha256, (await renderPlacement({ pack: smokePack, imageValues: {}, textValues: {}, colourMap: smokePack.semanticColours }, "feed")).sha256);
  });

  it("uses authored sizeRatio for normalized text boxes instead of the stale pixel fallback", async () => {
    const ratioPack = textPack({
      file: "barlow-600.woff2", sha: "ratio-font", geometry: { x: 0.1, y: 0.2, width: 0.8, height: 0.2 }, sizeRatio: 0.78,
    });
    const tinyPack = textPack({
      file: "barlow-600.woff2", sha: "ratio-font", geometry: { x: 0.1, y: 0.2, width: 0.8, height: 0.2 }, fontSize: 8,
    });
    const input = { imageValues: {}, textValues: { headline: "A CLEARER NEXT CHAPTER" }, colourMap: ratioPack.semanticColours, fontValues: { "barlow-600.woff2": BARLOW } };
    const large = await renderPlacement({ ...input, pack: ratioPack }, "feed");
    const tiny = await renderPlacement({ ...input, pack: tinyPack }, "feed");
    const largeBounds = await inkBounds(large.png);
    const tinyBounds = await inkBounds(tiny.png);
    assert.ok(largeBounds.bottom - largeBounds.top > (tinyBounds.bottom - tinyBounds.top) * 2, "authored ratio should materially occupy its box");
    assert.ok(largeBounds.top >= 260 && largeBounds.bottom <= 550, "ratio text stays within its normalized authored box");
  });

  it("keeps headline, supporting, and fact copy visibly occupied", async () => {
    const cases = [
      { inputKey: "headline", text: "A CLEARER NEXT CHAPTER", geometry: { x: 0.1, y: 0.1, width: 0.8, height: 0.14 }, sizeRatio: 0.72 },
      { inputKey: "supporting", text: "Simple support that stays readable", geometry: { x: 0.1, y: 0.42, width: 0.8, height: 0.07 }, sizeRatio: 0.56 },
      { inputKey: "fact", text: "FROM $49 / MONTH", geometry: { x: 0.1, y: 0.62, width: 0.8, height: 0.08 }, sizeRatio: 0.68 },
    ] as const;
    for (const item of cases) {
      const pack = textPack({ ...item, file: "barlow-600.woff2", sha: "occupancy-font", maxLines: 2 });
      const rendered = await renderPlacement({
        pack,
        imageValues: {},
        textValues: { [item.inputKey]: item.text },
        colourMap: pack.semanticColours,
        fontValues: { "barlow-600.woff2": BARLOW },
      }, "feed");
      const bounds = await inkBounds(rendered.png);
      assert.ok(bounds.pixels > 30, `${item.inputKey} should contribute visible ink`);
    }
  });

  it("maps normalized authoring geometry to the same pixels as editor geometry", async () => {
    const normalized = textPack({
      file: "barlow-600.woff2", sha: "parity-font", geometry: { x: 0.1, y: 0.2, width: 0.8, height: 0.2 }, sizeRatio: 0.42,
    });
    const pixel = textPack({
      file: "barlow-600.woff2", sha: "parity-font", geometry: { x: 108, y: 270, width: 864, height: 270 }, fontSize: 113.4,
    });
    const input = {
      imageValues: {}, textValues: { headline: "SAME EDITOR COPY" }, colourMap: normalized.semanticColours,
      fontValues: { "barlow-600.woff2": BARLOW },
    };
    const normalizedOutput = await renderPlacement({ ...input, pack: normalized }, "feed");
    const pixelOutput = await renderPlacement({ ...input, pack: pixel }, "feed");
    assert.equal(normalizedOutput.sha256, pixelOutput.sha256, "normalized and pixel editor boxes should rasterize identically");
  });

  it("fits long multiline copy by measured ink and preserves the declared line budget", async () => {
    const pack = textPack({
      file: "barlow-600.woff2", sha: "fit-font", geometry: { x: 0.1, y: 0.1, width: 0.25, height: 0.12 }, sizeRatio: 0.9, maxLines: 2,
    });
    const rendered = await renderPlacement({
      pack, imageValues: {}, textValues: { headline: "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW" }, colourMap: pack.semanticColours, fontValues: { "barlow-600.woff2": BARLOW },
    }, "feed");
    const bounds = await inkBounds(rendered.png);
    assert.ok(bounds.pixels > 0, "long copy remains visible");
    assert.ok(bounds.left >= 108 && bounds.right <= 380, "wrapped copy remains within the authored width");
    assert.ok(bounds.top >= 135 && bounds.bottom <= 315, "multiline copy remains within the authored height");
  });

  it("keeps serif descenders in the painted box", async () => {
    const pack = textPack({
      file: "cormorant-garamond-700.woff2", sha: "serif-font", geometry: { x: 0.1, y: 0.2, width: 0.8, height: 0.12 }, sizeRatio: 0.72, maxLines: 1,
    });
    const rendered = await renderPlacement({
      pack, imageValues: {}, textValues: { headline: "gypsy" }, colourMap: pack.semanticColours, fontValues: { "cormorant-garamond-700.woff2": CORMORANT },
    }, "feed");
    const bounds = await inkBounds(rendered.png);
    assert.ok(bounds.bottom > 310, "the y/g/p descenders are not clipped at the em box midpoint");
    assert.ok(bounds.bottom <= 432, "serif descenders remain inside the authored box");
  });
});
