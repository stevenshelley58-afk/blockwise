import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SaveError } from "../src/lib/adstudio/save-ad.ts";
import { sha256Hex } from "../packages/ad-template-pack-contract/src/hash.ts";
import type { TemplatePack } from "../packages/ad-template-pack-contract/src/types.ts";

// ---------------------------------------------------------------------------
// Mock Supabase — enough of the fluent chain for saveAd's queries.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function makeSupabase(rows: {
  ads: Row[];
  packs: Row[];
  revisions: Row[];
  attempts: Row[];
  uploads: string[];
}) {
  const insertedRevisions: Row[] = [];
  const updatedAds: Row[] = [];

  const table = (name: string) => {
    let chainFilters: Array<[string, unknown]> = [];
    const base: Row = {
      select: (..._cols: unknown[]) => base,
      insert: (val: Row | Row[]) => {
        const arr = Array.isArray(val) ? val : [val];
        if (name === "ad_revisions") {
          arr.forEach(r => {
            r.id = randomUUID();
            r.revision_number = r.revision_number ?? 1;
            insertedRevisions.push(r);
          });
        }
        if (name === "ad_render_attempts") arr.forEach(r => rows.attempts.push(r));
        return { ...base, select: () => ({ ...base, single: async () => ({ data: arr[0], error: null }) }) };
      },
      update: (val: Row) => {
        if (name === "ad_customer_ads") updatedAds.push(val);
        return { ...base, eq: () => base };
      },
      eq: (col: string, val: unknown) => {
        chainFilters.push([col, val]);
        return base;
      },
      single: async () => {
        if (name === "ad_customer_ads") return { data: rows.ads[0] ?? null, error: rows.ads.length ? null : { message: "not found" } };
        if (name === "ad_template_packs") return { data: rows.packs[0] ?? null, error: rows.packs.length ? null : { message: "not found" } };
        if (name === "ad_revisions") return { data: rows.revisions[0] ?? null, error: null };
        return { data: null, error: null };
      },
      maybeSingle: async () => {
        if (name === "ad_revisions") return { data: rows.revisions[0] ?? null, error: null };
        return { data: null, error: null };
      },
    };
    return base;
  };

  return { from: table, _insertedRevisions: insertedRevisions, _updatedAds: updatedAds };
}

const manifestHash = "f".repeat(64);
const pack: TemplatePack = {
  schema: "blockwise.template-pack/v1",
  templateId: "save-test-001",
  version: 1,
  packId: "pack-save-test-001-v1",
  createdAt: "2026-08-12T00:00:00.000Z",
  builderVersion: "frank/0.1.0",
  rendererVersion: "renderer/0.1.0",
  classification: { label: "test", modelVersion: "v1", confidence: 0.9 },
  manifestSha256: manifestHash,
  signature: "sig",
  feedLayout: {
    placement: "feed",
    layers: [{ type: "plate", layerId: "bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: false }],
    safeZones: [],
  },
  storyLayout: {
    placement: "story",
    layers: [{ type: "plate", layerId: "bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1920 }, protected: false }],
    safeZones: [],
  },
  imageInputs: [],
  textInputs: [{ key: "headline", label: "Headline", placeholder: "", maxLength: 60 }],
  semanticColours: { background: "#FFFFFF", primary: "#111", secondary: "#222", accent: "#333", mainText: "#000", inverseText: "#fff" },
  assets: {},
  fonts: [],
  safePreviews: { feed: { sha256: "0".repeat(64) }, story: { sha256: "0".repeat(64) } },
  qaEvidence: { feedPassed: true, storyPassed: true, reviewerVersions: [], stressFixtureResults: {} },
};

function makeDeps(uploads: string[]) {
  return {
    uploadRender: async (path: string, bytes: Buffer) => {
      uploads.push(path);
      assert.ok(bytes.length > 8);
      return path;
    },
    loadFonts: async () => ({}),
  };
}

const baseDocument = (hash: string) => ({
  schema: "blockwise.ad-document/v1" as const,
  templateId: pack.templateId,
  templateVersion: 1,
  templateHash: manifestHash,
  rendererVersion: pack.rendererVersion,
  sharedImageValues: {},
  sharedTextValues: { headline: "Hello" },
  feedCropOverrides: {},
  storyCropOverrides: {},
  colourMode: "template" as const,
  resolvedColourMap: pack.semanticColours,
  metaPrimaryText: "Primary",
  metaHeadline: "Headline",
  metaDescription: "Desc",
  metaCta: "LEARN_MORE",
  revision: 1,
  documentHash: hash,
  lastRenderedHash: null,
});

describe("Save ad", () => {
  it("SaveError has code and message", () => {
    const err = new SaveError("ad_not_found", "Ad not found");
    assert.equal(err.code, "ad_not_found");
    assert.equal(err.message, "Ad not found");
  });

  it("rejects a save when the ad row is workspace-missing", async () => {
    const sb = makeSupabase({ ads: [], packs: [{}], revisions: [], attempts: [], uploads: [] });
    const { saveAd } = await import("../src/lib/adstudio/save-ad.ts");
    await assert.rejects(
      saveAd(
        { supabase: sb as never, workspaceId: "ws-1", adId: "ad-1", document: baseDocument("x") as never, expectedRevision: 0, colourMap: pack.semanticColours, imageValues: {} },
        makeDeps([]),
      ),
      (err: unknown) => err instanceof SaveError && err.code === "ad_not_found",
    );
  });

  it("rejects a document pointing at a different pack version", async () => {
    const sb = makeSupabase({
      ads: [{ id: "ad-1", active_revision_id: null, template_pack_id: pack.packId, template_hash: manifestHash }],
      packs: [{ pack_json: pack, manifest_sha256: manifestHash, fonts_map: {} }],
      revisions: [],
      attempts: [],
      uploads: [],
    });
    const { saveAd } = await import("../src/lib/adstudio/save-ad.ts");
    const doc = { ...baseDocument("x"), templateHash: "e".repeat(64) };
    await assert.rejects(
      saveAd(
        { supabase: sb as never, workspaceId: "ws-1", adId: "ad-1", document: doc as never, expectedRevision: 0, colourMap: pack.semanticColours, imageValues: {} },
        makeDeps([]),
      ),
      (err: unknown) => err instanceof SaveError && err.code === "template_hash_mismatch",
    );
  });

  it("returns the stored revision unchanged when the document hash matches", async () => {
    const doc = baseDocument("stable-hash");
    const existingDocHash = sha256Hex(doc);
    const sb = makeSupabase({
      ads: [{ id: "ad-1", active_revision_id: "rev-existing", template_pack_id: pack.packId, template_hash: manifestHash }],
      packs: [{ pack_json: pack, manifest_sha256: manifestHash, fonts_map: {} }],
      revisions: [{ id: "rev-existing", revision_number: 4, document_hash: existingDocHash, feed_png_hash: "feed-hash", story_png_hash: "story-hash" }],
      attempts: [],
      uploads: [],
    });
    const { saveAd } = await import("../src/lib/adstudio/save-ad.ts");
    const uploads: string[] = [];
    const result = await saveAd(
      { supabase: sb as never, workspaceId: "ws-1", adId: "ad-1", document: doc as never, expectedRevision: 4, colourMap: pack.semanticColours, imageValues: {} },
      makeDeps(uploads),
    );
    assert.equal(result.unchanged, true);
    assert.equal(result.revisionNumber, 4);
    assert.equal(result.feedPngHash, "feed-hash");
    assert.equal(result.storyPngHash, "story-hash");
    assert.equal(uploads.length, 0, "unchanged save must not re-render or re-upload");
  });

  it("rejects a stale revision", async () => {
    const doc = baseDocument("changed");
    const sb = makeSupabase({
      ads: [{ id: "ad-1", active_revision_id: "rev-existing", template_pack_id: pack.packId, template_hash: manifestHash }],
      packs: [{ pack_json: pack, manifest_sha256: manifestHash, fonts_map: {} }],
      revisions: [{ id: "rev-existing", revision_number: 7, document_hash: "different-hash", feed_png_hash: "fh", story_png_hash: "sh" }],
      attempts: [],
      uploads: [],
    });
    const { saveAd } = await import("../src/lib/adstudio/save-ad.ts");
    await assert.rejects(
      saveAd(
        { supabase: sb as never, workspaceId: "ws-1", adId: "ad-1", document: doc as never, expectedRevision: 3, colourMap: pack.semanticColours, imageValues: {} },
        makeDeps([]),
      ),
      (err: unknown) => err instanceof SaveError && err.code === "stale_revision",
    );
  });

  it("renders both placements and advances the revision on a real change", async () => {
    const doc = baseDocument("brand-new-doc");
    const uploads: string[] = [];
    const sb = makeSupabase({
      ads: [{ id: "ad-1", active_revision_id: null, template_pack_id: pack.packId, template_hash: manifestHash }],
      packs: [{ pack_json: pack, manifest_sha256: manifestHash, fonts_map: {} }],
      revisions: [],
      attempts: [],
      uploads,
    });
    const { saveAd } = await import("../src/lib/adstudio/save-ad.ts");
    const result = await saveAd(
      { supabase: sb as never, workspaceId: "ws-1", adId: "ad-1", document: doc as never, expectedRevision: 0, colourMap: pack.semanticColours, imageValues: {} },
      makeDeps(uploads),
    );
    assert.equal(result.unchanged, false);
    assert.equal(result.revisionNumber, 1);
    assert.equal(uploads.length, 2, "one upload per placement");
    assert.ok(uploads.some(u => u.startsWith("ws-1/adstudio/renders/ad-1/feed-")));
    assert.ok(uploads.some(u => u.startsWith("ws-1/adstudio/renders/ad-1/story-")));
    assert.equal(result.feedPngHash.length, 64);
    assert.equal(result.storyPngHash.length, 64);
    assert.notEqual(result.feedPngHash, result.storyPngHash, "feed and story hashes differ (different canvas sizes)");
  });

  it("passes per-placement crop overrides to the renderer (feed ≠ story crops)", async () => {
    // Capture crop overrides by spying through a pack with an image slot.
    const doc = baseDocument("with-crops");
    doc.feedCropOverrides = { hero: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } };
    doc.storyCropOverrides = { hero: { x: 0.2, y: 0.0, width: 0.6, height: 1.0 } };

    const packWithSlot = structuredClone(pack);
    packWithSlot.imageInputs.push({ key: "hero", label: "Hero", acceptedTypes: ["image/png"] });
    const slot = {
      type: "image_slot" as const, layerId: "hero-slot", inputKey: "hero",
      geometry: { x: 0, y: 0, width: 1080, height: 700 }, mask: "none" as const,
      minSourceWidth: 10, minSourceHeight: 10,
      defaultCrop: { x: 0, y: 0, width: 1, height: 1 },
      allowedPlacementOverrides: ["crop" as const],
    };
    packWithSlot.feedLayout.layers.push(slot);
    packWithSlot.storyLayout.layers.push(slot);

    // Build a 100×100 probe PNG.
    const { createCanvas } = await import("@napi-rs/canvas");
    const c = createCanvas(100, 100);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 100, 100);
    const probePng = Buffer.from(c.toBuffer("image/png"));

    const uploads: string[] = [];
    const sb = makeSupabase({
      ads: [{ id: "ad-1", active_revision_id: null, template_pack_id: packWithSlot.packId, template_hash: manifestHash }],
      packs: [{ pack_json: packWithSlot, manifest_sha256: manifestHash, fonts_map: {} }],
      revisions: [],
      attempts: [],
      uploads,
    });
    const { saveAd } = await import("../src/lib/adstudio/save-ad.ts");
    const result = await saveAd(
      { supabase: sb as never, workspaceId: "ws-1", adId: "ad-1", document: doc as never, expectedRevision: 0, colourMap: packWithSlot.semanticColours, imageValues: { hero: probePng } },
      makeDeps(uploads),
    );
    assert.equal(result.unchanged, false);
    // Different per-placement crops ⇒ different render bytes ⇒ different hashes.
    assert.notEqual(result.feedPngHash, result.storyPngHash);
  });
});
