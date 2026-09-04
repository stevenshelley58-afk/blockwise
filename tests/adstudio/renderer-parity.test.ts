import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type { AdTemplate } from "../../packages/ad-template-contract/src/types";
import { renderPlacement } from "../../packages/ad-template-renderer/src/renderer.ts";
import {
  effectiveTextFontSize,
  fabricIconCircleGeometry,
  fabricRectGeometry,
  resolveGeometry,
} from "../../src/components/adstudio/editor/layer-geometry.ts";

function iconTemplate(icon: string): AdTemplate {
  return {
    schema: "blockwise.ad-template",
    templateId: "renderer-parity",
    createdAt: "2026-09-03T00:00:00.000Z",
    feedLayout: {
      placement: "feed",
      layers: [
        {
          type: "plate",
          layerId: "feed-background",
          colourRole: "background",
          geometry: { x: 0, y: 0, width: 1, height: 1 },
          protected: true,
        },
        {
          type: "icon",
          layerId: "fallback-icon",
          icon,
          colourRole: "accent",
          geometry: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
        },
      ],
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

function pixelColour(ctx: SKRSContext2D, x: number, y: number): [number, number, number, number] {
  const pixel = ctx.getImageData(x, y, 1, 1).data;
  return [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0, pixel[3] ?? 0];
}

describe("canonical renderer parity fixtures", () => {
  it("sets the effective sizeRatio on an actual Fabric Textbox", async () => {
    const { Textbox, getEnv } = await import("fabric/node");
    const document = getEnv().document;
    const createElement = document.createElement.bind(document);
    document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName.toLowerCase() === "canvas") {
        const measuringCanvas = createCanvas(1, 1);
        Object.defineProperty(element, "getContext", { configurable: true, value: () => measuringCanvas.getContext("2d") });
      }
      return element;
    }) as typeof document.createElement;

    const authored = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
    const geometry = resolveGeometry(authored, { width: 1080, height: 1920 });
    const textbox = new Textbox("Parity", {
      ...fabricRectGeometry(geometry),
      width: geometry.width,
      fontSize: effectiveTextFontSize({ fontSize: 96, sizeRatio: 0.05 }, geometry),
      lineHeight: 1.1,
      splitByGrapheme: true,
    });
    assert.ok(Math.abs(textbox.fontSize - 38.4) < 1e-9);
    assert.equal(textbox.left, geometry.x);
    assert.equal(textbox.top, geometry.y);
    assert.ok(textbox.getBoundingRect().width <= geometry.width + 1);
  });

  it("keeps an actual Fabric unknown-icon fallback centred with a stroked bound", async () => {
    const { Circle } = await import("fabric/node");
    const geometry = resolveGeometry({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, { width: 1080, height: 1350 });
    const strokeWidth = Math.max(2, Math.min(geometry.width, geometry.height) * 0.1);
    const circle = new Circle({
      ...fabricIconCircleGeometry(geometry),
      fill: "",
      stroke: "#ff0000",
      strokeWidth,
    });
    const bounds = circle.getBoundingRect();
    assert.equal(circle.fill, "");
    assert.equal(circle.strokeWidth, strokeWidth);
    assert.ok(Math.abs(circle.getCenterPoint().x - (geometry.x + geometry.width / 2)) < 1e-9);
    assert.ok(Math.abs(circle.getCenterPoint().y - (geometry.y + geometry.height / 2)) < 1e-9);
    assert.ok(Math.abs(bounds.width - (circle.radius * 2 + strokeWidth)) < 1e-9);
  });

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
    assert.deepEqual(pixelColour(ctx, 540, 675), [255, 255, 255, 255], "fallback circle must not be filled");
    assert.deepEqual(pixelColour(ctx, 724, 675), [255, 0, 0, 255], "fallback stroke should cross the right circumference");
    assert.deepEqual(pixelColour(ctx, 540, 491), [255, 0, 0, 255], "fallback stroke should cross the top circumference");
  });
});
