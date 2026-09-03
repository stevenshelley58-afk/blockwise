import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type { AdTemplate } from "../../packages/ad-template-contract/src/types";
import { renderPlacement } from "../../packages/ad-template-renderer/src/renderer.ts";

function iconTemplate(icon: string): AdTemplate {
  return {
    schema: "blockwise.ad-template",
    templateId: "renderer-parity",
    createdAt: "2026-09-03T00:00:00.000Z",
    feedLayout: {
      placement: "feed",
      layers: [{
        type: "icon",
        layerId: "fallback-icon",
        icon,
        colourRole: "accent",
        geometry: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      }],
      safeZones: [],
    },
    storyLayout: { placement: "story", layers: [], safeZones: [] },
    imageInputs: [],
    textInputs: [],
    semanticColours: {
      background: "#ffffff",
      primary: "#000000",
      secondary: "#000000",
      accent: "#ff0000",
      mainText: "#000000",
      inverseText: "#ffffff",
    },
    assets: {},
    fonts: [],
    metadata: {
      title: "Renderer parity fixture",
      description: "Deterministic icon fallback fixture",
      gallerySamples: {},
      metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" },
      aiWritingGuidance: { summary: "", fields: {} },
      publishRequirements: {
        objective: "OUTCOME_LEADS",
        specialAdCategory: null,
        instantForm: { required: false, dependency: null },
        destination: { required: false, kind: "none", dependency: null },
        requiredCtaTypes: [],
      },
      replacementAssets: [],
      realAssetRefs: [],
    },
  };
}

function pixelAlpha(ctx: SKRSContext2D, x: number, y: number): number {
  return ctx.getImageData(x, y, 1, 1).data[3] ?? 0;
}

describe("canonical renderer parity fixtures", () => {
  it("renders an unknown icon as a centred stroked circle in normalized geometry", async () => {
    const output = await renderPlacement({
      template: iconTemplate("future-icon"),
      imageValues: {},
      textValues: {},
      colourMap: {
        background: "#ffffff",
        primary: "#000000",
        secondary: "#000000",
        accent: "#ff0000",
        mainText: "#000000",
        inverseText: "#ffffff",
      },
    }, "feed");
    const image = await loadImage(output.png);
    const canvas = createCanvas(output.width, output.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);

    // The normalized box resolves to x=270..810, y=337.5..1012.5. The
    // fallback is a circle centred at (540, 675), not the old check path.
    assert.equal(pixelAlpha(ctx, 540, 675), 0, "fallback circle must not be filled");
    assert.ok(pixelAlpha(ctx, 724, 675) > 0, "fallback stroke should cross the right circumference");
    assert.ok(pixelAlpha(ctx, 540, 491) > 0, "fallback stroke should cross the top circumference");
  });
});
