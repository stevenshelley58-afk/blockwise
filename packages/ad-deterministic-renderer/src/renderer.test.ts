import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderPlacement, renderBoth } from "./renderer.js";
import type { TemplatePack } from "@blockwise/ad-template-pack-contract";

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
  it("renders feed placement at 1080×1350", () => {
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

  it("renders story placement at 1080×1920", () => {
    const result = await renderPlacement(
      { pack: smokePack, imageValues: {}, textValues: {}, colourMap: smokePack.semanticColours },
      "story",
    );
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1920);
  });

  it("is deterministic — same inputs, byte-identical PNG", () => {
    const a = renderPlacement(
      { pack: smokePack, imageValues: {}, textValues: {}, colourMap: smokePack.semanticColours },
      "feed",
    );
    const b = renderPlacement(
      { pack: smokePack, imageValues: {}, textValues: {}, colourMap: smokePack.semanticColours },
      "feed",
    );
    assert.equal(a.sha256, b.sha256);
    assert.deepEqual(a.png, b.png);
  });

  it("renderBoth returns [feed, story]", () => {
    const [feed, story] = await renderBoth({ pack: smokePack, imageValues: {}, textValues: {}, colourMap: smokePack.semanticColours });
    assert.equal(feed.placement, "feed");
    assert.equal(story.placement, "story");
  });

  it("different colours produce different output", () => {
    const a = renderPlacement(
      { pack: smokePack, imageValues: {}, textValues: {}, colourMap: { ...smokePack.semanticColours, background: "#FFFFFF" } },
      "feed",
    );
    const b = renderPlacement(
      { pack: smokePack, imageValues: {}, textValues: {}, colourMap: { ...smokePack.semanticColours, background: "#000000" } },
      "feed",
    );
    assert.notEqual(a.sha256, b.sha256);
  });
});
