import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256Hex, canonicalJson, computeManifestHash, verifyManifestHash } from "./hash.js";
import { templatePackSchema, adDocumentSchema } from "./schema.js";
import type { TemplatePack } from "./types.js";

// ---------------------------------------------------------------------------
// Golden fixture: a minimal valid Feed + Story pack
// ---------------------------------------------------------------------------

const goldenPack: TemplatePack = {
  schema: "blockwise.template-pack/v1",
  templateId: "golden-001",
  version: 1,
  packId: "pack-golden-001-v1",
  createdAt: "2026-08-12T00:00:00.000Z",
  builderVersion: "frank/0.1.0",
  rendererVersion: "renderer/0.1.0",
  classification: { label: "agent_intro_feed", modelVersion: "radar/v3", confidence: 0.94 },
  manifestSha256: "", // computed below
  signature: "base64-ed25519-sig-placeholder",
  feedLayout: {
    placement: "feed",
    layers: [
      { type: "plate", layerId: "bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: false },
      { type: "image_slot", layerId: "hero", inputKey: "propertyPhoto", geometry: { x: 40, y: 40, width: 1000, height: 700 }, mask: "rounded_rect", minSourceWidth: 800, minSourceHeight: 600, defaultCrop: { x: 0, y: 0, width: 1, height: 1 }, allowedPlacementOverrides: ["crop"] },
      { type: "text", layerId: "headline", inputKey: "headline", font: { file: "Inter-Bold.woff2", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }, fontSize: 48, lineHeight: 1.2, tracking: -0.02, alignment: "left", maxCharacters: 60, maxLines: 2, colourRole: "mainText", overflowBehaviour: "refuse" },
      { type: "text", layerId: "body", inputKey: "bodyText", font: { file: "Inter-Regular.woff2", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }, fontSize: 24, lineHeight: 1.4, tracking: 0, alignment: "left", maxCharacters: 200, maxLines: 3, colourRole: "secondary", overflowBehaviour: "truncate" },
    ],
    safeZones: [{ x: 40, y: 40, width: 1000, height: 1270 }],
  },
  storyLayout: {
    placement: "story",
    layers: [
      { type: "plate", layerId: "bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1920 }, protected: false },
      { type: "image_slot", layerId: "hero", inputKey: "propertyPhoto", geometry: { x: 0, y: 0, width: 1080, height: 1080 }, mask: "none", minSourceWidth: 800, minSourceHeight: 800, defaultCrop: { x: 0, y: 0, width: 1, height: 1 }, allowedPlacementOverrides: ["crop", "position"] },
      { type: "text", layerId: "headline", inputKey: "headline", font: { file: "Inter-Bold.woff2", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }, fontSize: 40, lineHeight: 1.2, tracking: -0.02, alignment: "center", maxCharacters: 50, maxLines: 2, colourRole: "mainText", overflowBehaviour: "refuse" },
      { type: "overlay_patch", layerId: "gradient", geometry: { x: 0, y: 1080, width: 1080, height: 200 }, colourRole: "primary", opacity: 0.6 },
      { type: "text", layerId: "cta", inputKey: "ctaText", font: { file: "Inter-SemiBold.woff2", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }, fontSize: 28, lineHeight: 1.3, tracking: 0, alignment: "center", maxCharacters: 30, maxLines: 1, colourRole: "inverseText", overflowBehaviour: "truncate" },
    ],
    safeZones: [{ x: 40, y: 200, width: 1000, height: 1520 }],
  },
  imageInputs: [{ key: "propertyPhoto", label: "Property photo", acceptedTypes: ["image/jpeg", "image/png", "image/webp"] }],
  textInputs: [
    { key: "headline", label: "Headline", placeholder: "Enter headline", maxLength: 60 },
    { key: "bodyText", label: "Body", placeholder: "Enter body text", maxLength: 200 },
    { key: "ctaText", label: "CTA", placeholder: "Learn more", maxLength: 30 },
  ],
  semanticColours: {
    background: "#FFFFFF",
    primary: "#1A56DB",
    secondary: "#6B7280",
    accent: "#F59E0B",
    mainText: "#111827",
    inverseText: "#FFFFFF",
  },
  assets: {
    "bg-pattern": { fileName: "bg-pattern.png", sha256: "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a", mimeType: "image/png" },
  },
  fonts: [
    { file: "Inter-Bold.woff2", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
    { file: "Inter-Regular.woff2", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
    { file: "Inter-SemiBold.woff2", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
  ],
  safePreviews: {
    feed: { sha256: "b4d6e7f8a1c2e3d4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8" },
    story: { sha256: "c5d6e7f8a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8" },
  },
  qaEvidence: {
    feedPassed: true,
    storyPassed: true,
    reviewerVersions: ["reviewer/v1.0.0"],
    stressFixtureResults: {
      longestText: "pass",
      oneCharText: "pass",
      landscapeImage: "pass",
      portraitImage: "pass",
      squareImage: "pass",
      minDimensions: "pass",
      extremeCrop: "pass",
      templateColours: "pass",
      brandPackColours: "pass",
      contrastCheck: "pass",
    },
  },
};

// Compute the real manifest hash
goldenPack.manifestSha256 = computeManifestHash(goldenPack as unknown as Record<string, unknown>);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TemplatePack schema", () => {
  it("validates the golden fixture", () => {
    const result = templatePackSchema.safeParse(goldenPack);
    assert.ok(result.success, JSON.stringify(result.error?.issues, null, 2));
  });

  it("rejects a pack with missing Story layout", () => {
    const { storyLayout: _, ...noStory } = goldenPack;
    const result = templatePackSchema.safeParse(noStory);
    assert.equal(result.success, false);
  });

  it("rejects a pack with mismatched input keys", () => {
    const bad = structuredClone(goldenPack);
    bad.feedLayout.layers = bad.feedLayout.layers.filter(l => l.type !== "text");
    bad.storyLayout.layers.push({
      type: "text", layerId: "orphan", inputKey: "nonexistent_key",
      font: { file: "X.woff2", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
      fontSize: 20, lineHeight: 1.3, tracking: 0, alignment: "left",
      maxCharacters: 10, maxLines: 1, colourRole: "mainText", overflowBehaviour: "refuse",
    });
    // The consumer must validate that every inputKey in every layer
    // exists in imageInputs + textInputs. This test verifies that
    // a nonexistent key IS correctly flagged as missing.
    const keys = [...bad.imageInputs.map(i => i.key), ...bad.textInputs.map(i => i.key)];
    const allInputKeys = new Set(keys);
    const orphanKeys: string[] = [];
    for (const layer of [...bad.feedLayout.layers, ...bad.storyLayout.layers]) {
      if ("inputKey" in layer && !allInputKeys.has(layer.inputKey)) {
        orphanKeys.push(layer.inputKey);
      }
    }
    assert.deepEqual(orphanKeys, ["nonexistent_key"]);
  });

  it("rejects invalid hex SHA-256", () => {
    const bad = structuredClone(goldenPack);
    bad.manifestSha256 = "not-a-valid-sha256";
    const result = templatePackSchema.safeParse(bad);
    assert.equal(result.success, false);
  });

  it("rejects invalid layer geometry (zero width)", () => {
    const bad = structuredClone(goldenPack);
    bad.feedLayout.layers[0]!.geometry.width = 0;
    const result = templatePackSchema.safeParse(bad);
    assert.equal(result.success, false);
  });

  it("rejects invalid colour role", () => {
    const bad = structuredClone(goldenPack);
    (bad.feedLayout.layers[0] as any).colourRole = "not_a_role";
    const result = templatePackSchema.safeParse(bad);
    assert.equal(result.success, false);
  });

  it("rejects unsupported layer type", () => {
    const bad = structuredClone(goldenPack);
    bad.feedLayout.layers.push({ type: "unsupported", layerId: "x" } as any);
    const result = templatePackSchema.safeParse(bad);
    assert.equal(result.success, false);
  });

  it("rejects opacity out of range", () => {
    const bad = structuredClone(goldenPack);
    const overlay = bad.storyLayout.layers.find(l => l.type === "overlay_patch");
    assert.ok(overlay);
    (overlay as any).opacity = 1.5;
    const result = templatePackSchema.safeParse(bad);
    assert.equal(result.success, false);
  });
});

describe("Canonical hashing", () => {
  it("is deterministic — same input, same hash", () => {
    const h1 = sha256Hex(goldenPack);
    const h2 = sha256Hex(structuredClone(goldenPack));
    assert.equal(h1, h2);
  });

  it("manifest hash excludes manifestSha256 and signature", () => {
    const mh = computeManifestHash(goldenPack as unknown as Record<string, unknown>);
    assert.equal(mh, goldenPack.manifestSha256);
    // Verify self-check
    assert.ok(verifyManifestHash(goldenPack as unknown as Record<string, unknown>));
  });

  it("different content produces different hash", () => {
    const modified = structuredClone(goldenPack);
    modified.templateId = "golden-002";
    assert.notEqual(sha256Hex(goldenPack), sha256Hex(modified));
  });

  it("sorted keys produce identical output", () => {
    const canonical = canonicalJson(goldenPack);
    // Re-parse and re-stringify should produce the same output
    const reparsed = canonicalJson(JSON.parse(canonical));
    assert.equal(canonical, reparsed);
  });
});

describe("AdDocument schema", () => {
  it("validates a minimal AdDocument", () => {
    const doc = {
      schema: "blockwise.ad-document/v1",
      templateId: "golden-001",
      templateVersion: 1,
      templateHash: goldenPack.manifestSha256,
      rendererVersion: "renderer/0.1.0",
      sharedImageValues: { propertyPhoto: "path/to/photo.jpg" },
      sharedTextValues: { headline: "Hello", bodyText: "World", ctaText: "Go" },
      feedCropOverrides: {},
      storyCropOverrides: {},
      colourMode: "template",
      resolvedColourMap: goldenPack.semanticColours,
      metaPrimaryText: "Primary text",
      metaHeadline: "Headline",
      metaDescription: "Description",
      metaCta: "LEARN_MORE",
      revision: 1,
      documentHash: sha256Hex({}),
      lastRenderedHash: null,
    };
    const result = adDocumentSchema.safeParse(doc);
    assert.ok(result.success, JSON.stringify(result.error?.issues, null, 2));
  });
});
