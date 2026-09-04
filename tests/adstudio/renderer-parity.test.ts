import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { AdTemplate, SupportedIconName } from "../../packages/ad-template-contract/src/types";
import { renderPlacement } from "../../packages/ad-template-renderer/src/renderer.ts";
import {
  effectiveTextFontSize,
  fabricCharSpacing,
  fabricIconPathData,
  fabricRectGeometry,
  resolveGeometry,
} from "../../src/components/adstudio/editor/layer-geometry.ts";

function iconTemplate(icon: SupportedIconName): AdTemplate {
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
          layerId: `semantic-${icon}-icon`,
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
      description: "Deterministic semantic icon fixture",
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
    const fontSize = effectiveTextFontSize({ fontSize: 96, sizeRatio: 0.05 }, geometry);
    const textbox = new Textbox("Parity", {
      ...fabricRectGeometry(geometry),
      width: geometry.width,
      fontSize,
      lineHeight: 1.1,
      charSpacing: fabricCharSpacing(1, fontSize),
      splitByGrapheme: true,
    });
    assert.ok(Math.abs(textbox.fontSize - 38.4) < 1e-9);
    assert.ok(Math.abs(textbox.charSpacing * textbox.fontSize / 1000 - 1) < 1e-9, "Fabric tracking must remain absolute across font sizes");
    assert.equal(textbox.left, geometry.x);
    assert.equal(textbox.top, geometry.y);
    assert.ok(textbox.getBoundingRect().width <= geometry.width + 1);
  });

  it("paints every semantic contact icon as a path instead of an empty ring", async () => {
    for (const icon of ["phone", "mail", "globe", "location"] as const) {
      const pathData = fabricIconPathData(icon, 100, 100);
      assert.ok(pathData);
      if (icon !== "globe") assert.notEqual(pathData, fabricIconPathData("globe", 100, 100), `${icon} must not collapse to a globe ring`);

      const output = await renderPlacement({
        template: iconTemplate(icon),
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
      const interiorPixels = ctx.getImageData(405, 505, 270, 340).data;
      let paintedInterior = 0;
      for (let index = 0; index < interiorPixels.length; index += 4) {
        if (interiorPixels[index] === 255 && interiorPixels[index + 1] === 0 && interiorPixels[index + 2] === 0) paintedInterior += 1;
      }
      assert.ok(paintedInterior > 0, `${icon} must paint inside its perimeter`);
    }
  });
});
