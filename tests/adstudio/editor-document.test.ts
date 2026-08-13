import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAdDocument, type EditorState } from "../../src/components/adstudio/editor/use-editor-state.ts";
import type { TemplatePack } from "../../packages/ad-template-pack-contract/src/types.ts";

// ---------------------------------------------------------------------------
// buildAdDocument — the Save document must carry the customer's shared text
// and image-slot values. Text goes in sharedTextValues verbatim; images go in
// sharedImageValues as data URLs, which the save route fetches server-side to
// build render buffers (so a data: URL must actually be fetchable).
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

const PACK: TemplatePack = {
  ...loadPack(),
  imageInputs: [
    { key: "hero", label: "Hero image", acceptedTypes: ["image/*"] },
    { key: "logo", label: "Logo", acceptedTypes: ["image/png", "image/jpeg"] },
  ],
  textInputs: [
    { key: "headline", label: "Headline", placeholder: "Your headline", maxLength: 40 },
    { key: "cta", label: "Call to action", placeholder: "", maxLength: 24 },
  ],
};

const HERO_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function makeState(overrides: Partial<EditorState> = {}): EditorState {
  return {
    pack: PACK,
    activePlacement: "feed",
    imageValues: [
      { inputKey: "hero", dataUrl: HERO_DATA_URL, crops: {} },
      { inputKey: "logo", dataUrl: null, crops: {} },
    ],
    textValues: { headline: "Fresh bread, daily", cta: "Order now" },
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

describe("buildAdDocument shared inputs", () => {
  it("includes text values keyed by input key", async () => {
    const doc = await buildAdDocument(makeState());
    assert.deepEqual(doc.sharedTextValues, {
      headline: "Fresh bread, daily",
      cta: "Order now",
    });
  });

  it("includes picked images as data URLs and omits unpicked slots", async () => {
    const doc = await buildAdDocument(makeState());
    assert.equal(doc.sharedImageValues.hero, HERO_DATA_URL);
    assert.ok(!("logo" in doc.sharedImageValues), "unpicked image slot must be omitted");
  });

  it("writes a real document hash over the new values", async () => {
    const empty = await buildAdDocument(makeState({ textValues: { headline: "", cta: "" }, imageValues: [] }));
    const filled = await buildAdDocument(makeState());
    assert.notEqual(filled.documentHash, empty.documentHash);
    assert.match(filled.documentHash, /^[a-f0-9]{64}$/);
  });

  it("emits data URLs the save route can fetch server-side", async () => {
    // The route turns sharedImageValues into Buffers with fetch(url).
    const res = await fetch(HERO_DATA_URL);
    assert.equal(res.status, 200);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.ok(bytes.length > 0, "data URL resolves to bytes");
  });
});

// ---------------------------------------------------------------------------
// buildAdDocument crop overrides — per-placement crops, normalized [0,1],
// keyed by input key (the renderer's cropOverrides contract). Feed and
// Story must stay INDEPENDENT: one shared image, two crop rects.
// ---------------------------------------------------------------------------

const FEED_CROP = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
const STORY_CROP = { x: 0.25, y: 0.25, width: 0.7, height: 0.7 };

describe("buildAdDocument crop overrides", () => {
  it("omits crop overrides when none are set", async () => {
    const doc = await buildAdDocument(makeState());
    assert.deepEqual(doc.feedCropOverrides, {});
    assert.deepEqual(doc.storyCropOverrides, {});
  });

  it("stores a feed crop keyed by input key", async () => {
    const doc = await buildAdDocument(
      makeState({
        imageValues: [
          { inputKey: "hero", dataUrl: HERO_DATA_URL, crops: { feed: FEED_CROP } },
          { inputKey: "logo", dataUrl: null, crops: {} },
        ],
      }),
    );
    assert.deepEqual(doc.feedCropOverrides, { hero: FEED_CROP });
    assert.deepEqual(doc.storyCropOverrides, {});
  });

  it("stores a story crop independently of feed", async () => {
    const doc = await buildAdDocument(
      makeState({
        imageValues: [
          { inputKey: "hero", dataUrl: HERO_DATA_URL, crops: { story: STORY_CROP } },
          { inputKey: "logo", dataUrl: null, crops: {} },
        ],
      }),
    );
    assert.deepEqual(doc.feedCropOverrides, {});
    assert.deepEqual(doc.storyCropOverrides, { hero: STORY_CROP });
  });

  it("keeps feed and story crops separate for the same image", async () => {
    const doc = await buildAdDocument(
      makeState({
        imageValues: [
          {
            inputKey: "hero",
            dataUrl: HERO_DATA_URL,
            crops: { feed: FEED_CROP, story: STORY_CROP },
          },
          { inputKey: "logo", dataUrl: null, crops: {} },
        ],
      }),
    );
    assert.deepEqual(doc.feedCropOverrides.hero, FEED_CROP);
    assert.deepEqual(doc.storyCropOverrides.hero, STORY_CROP);
    assert.notDeepEqual(doc.feedCropOverrides.hero, doc.storyCropOverrides.hero);
  });

  it("includes crops for multiple inputs at once", async () => {
    const doc = await buildAdDocument(
      makeState({
        imageValues: [
          { inputKey: "hero", dataUrl: HERO_DATA_URL, crops: { feed: FEED_CROP } },
          { inputKey: "logo", dataUrl: HERO_DATA_URL, crops: { story: STORY_CROP } },
        ],
      }),
    );
    assert.deepEqual(doc.feedCropOverrides, { hero: FEED_CROP });
    assert.deepEqual(doc.storyCropOverrides, { logo: STORY_CROP });
  });

  it("changes the document hash when a crop changes", async () => {
    const base = await buildAdDocument(makeState());
    const cropped = await buildAdDocument(
      makeState({
        imageValues: [{ inputKey: "hero", dataUrl: HERO_DATA_URL, crops: { feed: FEED_CROP } }],
      }),
    );
    assert.notEqual(cropped.documentHash, base.documentHash);
    assert.match(cropped.documentHash, /^[a-f0-9]{64}$/);
  });
});
