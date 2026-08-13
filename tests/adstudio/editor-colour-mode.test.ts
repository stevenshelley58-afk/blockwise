import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAdDocument,
  brandPackColoursToRoleMap,
  resolveColourMap,
  type EditorState,
  type BrandPackColours,
} from "../../src/components/adstudio/editor/use-editor-state.ts";
import type { TemplatePack } from "../../packages/ad-template-pack-contract/src/types.ts";

// ---------------------------------------------------------------------------
// Colour mode (BW-K) — template palette vs workspace Brand Pack colours.
// The Brand Pack colours block maps onto template roles (text → mainText;
// no inverseText field exists), and roles missing from the brand kit fall
// back to the template value — never invent a palette. The Save document
// records colourMode + resolvedColourMap so renders use the chosen palette.
// ---------------------------------------------------------------------------

const FIXTURE_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "fixtures",
  "template-pack",
  "minimal-feed-story.json",
);

function loadPack(): TemplatePack {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as TemplatePack;
}

const PACK: TemplatePack = loadPack();

const BRAND_COLOURS: BrandPackColours = {
  primary: "#B91C1C",
  secondary: "#7F1D1D",
  accent: "#F59E0B",
  background: "#FEF2F2",
  text: "#450A0A",
};

describe("brandPackColoursToRoleMap", () => {
  it("maps brand colour fields onto template colour roles", () => {
    assert.deepEqual(brandPackColoursToRoleMap(BRAND_COLOURS), {
      primary: "#B91C1C",
      secondary: "#7F1D1D",
      accent: "#F59E0B",
      background: "#FEF2F2",
      mainText: "#450A0A",
    });
  });

  it("has no inverseText entry — the brand kit has no inverse-text colour", () => {
    const map = brandPackColoursToRoleMap(BRAND_COLOURS);
    assert.ok(!("inverseText" in map), "brand kit must not claim an inverseText colour");
  });

  it("drops empty or non-hex values instead of inventing colours", () => {
    const map = brandPackColoursToRoleMap({
      primary: "",
      secondary: "rgb(1, 2, 3)",
      accent: "not-a-colour",
      background: "#AABBCC",
      text: "#123",
    });
    assert.deepEqual(map, { background: "#AABBCC", mainText: "#123" });
  });

  it("returns an empty map for a missing kit", () => {
    assert.deepEqual(brandPackColoursToRoleMap(null), {});
    assert.deepEqual(brandPackColoursToRoleMap(undefined), {});
  });
});

describe("resolveColourMap", () => {
  it("template mode resolves to the template palette untouched", () => {
    const resolved = resolveColourMap(PACK.semanticColours, "template", brandPackColoursToRoleMap(BRAND_COLOURS));
    assert.deepEqual(resolved, PACK.semanticColours);
  });

  it("brand pack overrides mapped roles and keeps template fallbacks for missing ones", () => {
    const resolved = resolveColourMap(PACK.semanticColours, "brand_pack", brandPackColoursToRoleMap(BRAND_COLOURS));
    assert.equal(resolved.primary, "#B91C1C");
    assert.equal(resolved.background, "#FEF2F2");
    assert.equal(resolved.mainText, "#450A0A");
    // No brand inverse-text colour → template value stays.
    assert.equal(resolved.inverseText, PACK.semanticColours.inverseText);
    assert.equal(resolved.inverseText, "#FFFFFF");
  });

  it("brand pack with no brand map resolves to the template palette", () => {
    const resolved = resolveColourMap(PACK.semanticColours, "brand_pack", null);
    assert.deepEqual(resolved, PACK.semanticColours);
  });
});

describe("buildAdDocument colour mode", () => {
  function makeState(overrides: Partial<EditorState> = {}): EditorState {
    return {
      pack: PACK,
      activePlacement: "feed",
      imageValues: [],
      textValues: {},
      colourMode: "template",
      resolvedColourMap: { ...PACK.semanticColours },
      selectedLayerId: null,
      isDirty: true,
      isSaving: false,
      lastSavedRevision: null,
      error: null,
      ...overrides,
    };
  }

  it("records template colour mode with the template palette by default", async () => {
    const doc = await buildAdDocument(makeState());
    assert.equal(doc.colourMode, "template");
    assert.deepEqual(doc.resolvedColourMap, PACK.semanticColours);
  });

  it("records brand_pack mode with the resolved brand-over-template palette", async () => {
    const resolved = resolveColourMap(PACK.semanticColours, "brand_pack", brandPackColoursToRoleMap(BRAND_COLOURS));
    const doc = await buildAdDocument(
      makeState({ colourMode: "brand_pack", resolvedColourMap: { ...resolved } }),
    );
    assert.equal(doc.colourMode, "brand_pack");
    assert.equal(doc.resolvedColourMap.primary, "#B91C1C");
    assert.equal(doc.resolvedColourMap.inverseText, PACK.semanticColours.inverseText);
  });

  it("hashes the colour mode into the document hash", async () => {
    const template = await buildAdDocument(makeState());
    const brand = await buildAdDocument(
      makeState({
        colourMode: "brand_pack",
        resolvedColourMap: resolveColourMap(PACK.semanticColours, "brand_pack", brandPackColoursToRoleMap(BRAND_COLOURS)),
      }),
    );
    assert.notEqual(template.documentHash, brand.documentHash);
  });
});
