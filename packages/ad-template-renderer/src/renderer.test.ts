import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ICON_NAMES, type AdTemplate, type IconName } from "@blockwise/ad-template-contract";
import { renderPlacement } from "./renderer.ts";

const colours = {
  background: "#ffffff", primary: "#111111", secondary: "#777777",
  accent: "#ff5500", mainText: "#111111", inverseText: "#ffffff",
};

function templateWithIcon(icon: IconName): AdTemplate {
  return {
    schema: "blockwise.ad-template",
    templateId: `renderer-icon-${icon}`,
    createdAt: "2026-08-30T00:00:00.000Z",
    feedLayout: {
      placement: "feed",
      layers: [
        { type: "plate", layerId: `feed-bg-${icon}`, colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: true },
        { type: "icon", layerId: `feed-icon-${icon}`, icon, colourRole: "mainText", geometry: { x: 440, y: 575, width: 200, height: 200 } },
      ],
      safeZones: [],
    },
    storyLayout: {
      placement: "story",
      layers: [{ type: "plate", layerId: `story-bg-${icon}`, colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1920 }, protected: true }],
      safeZones: [],
    },
    imageInputs: [], textInputs: [], semanticColours: colours, assets: {}, fonts: [],
    metadata: {
      title: `Renderer icon ${icon}`, description: "Deterministic vector icon fixture", gallerySamples: {},
      metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" },
      aiWritingGuidance: { summary: "", fields: {} },
      publishRequirements: {
        objective: "OUTCOME_LEADS", specialAdCategory: null,
        instantForm: { required: false, dependency: null },
        destination: { required: false, kind: "none", dependency: null },
        requiredCtaTypes: [],
      },
      replacementAssets: [], realAssetRefs: [],
    },
  };
}

test("every supported icon renders a distinct deterministic vector", async () => {
  const blank = templateWithIcon("arrow");
  blank.feedLayout.layers = blank.feedLayout.layers.filter((layer) => layer.type !== "icon");
  const blankRender = await renderPlacement({ template: blank, imageValues: {}, textValues: {}, colourMap: colours }, "feed");
  const blankHash = createHash("sha256").update(blankRender.png).digest("hex");
  const hashes = new Set<string>();
  for (const icon of ICON_NAMES) {
    const template = templateWithIcon(icon);
    const first = await renderPlacement({ template, imageValues: {}, textValues: {}, colourMap: colours }, "feed");
    const second = await renderPlacement({ template, imageValues: {}, textValues: {}, colourMap: colours }, "feed");
    assert.deepEqual(first.png, second.png, `${icon} must render deterministically`);
    const hash = createHash("sha256").update(first.png).digest("hex");
    assert.notEqual(hash, blankHash, `${icon} must render visible geometry`);
    hashes.add(hash);
  }
  assert.equal(hashes.size, ICON_NAMES.length, "every supported icon must have distinct visible geometry");
});
