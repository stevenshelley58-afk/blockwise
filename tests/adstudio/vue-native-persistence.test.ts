import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import sharp from "sharp";

import { adDocumentSchema } from "../../packages/ad-template-contract/src/schema.ts";
import type { AdDocument, AdTemplate, NativeFabricScene } from "../../packages/ad-template-contract/src/types.ts";
import { documentToken } from "../../src/lib/adstudio/document-token.ts";
import { loadNativeTrialIdentity, nativeTrialCreationKey } from "../../src/lib/adstudio/vue-native-copy.ts";
import { NativeSaveError, saveNativeAd } from "../../src/lib/adstudio/vue-native-save.ts";
import {
  NATIVE_RENDERER_VERSION,
  NativeEditorValidationError,
  validateNativeEditorDocument,
  validateNativePngExport,
} from "../../src/lib/adstudio/vue-native-validation.ts";

const workspaceId = "workspace-1";
const sourceAdId = "source-ad";
const trialAdId = "trial-ad";
const templateId = "native-template";

function scene(width: number, height: number, object: Record<string, unknown> = { type: "rect", width: 20, height: 20 }): NativeFabricScene {
  return { version: "5.3.0", width, height, objects: [{ ...object, vendorField: { retained: true } }] };
}

function document(): AdDocument {
  return {
    schema: "blockwise.ad-document",
    templateId,
    sharedImageValues: {},
    sharedTextValues: { headline: "A real edit" },
    feedCropOverrides: {},
    storyCropOverrides: {},
    colourMode: "template",
    resolvedColourMap: {},
    metaPrimaryText: "Primary",
    metaHeadline: "Headline",
    metaDescription: "Description",
    metaCta: "LEARN_MORE",
    nativeEditor: {
      engine: "vue-fabric-editor",
      version: 1,
      feed: scene(1080, 1350),
      story: scene(1080, 1920),
      sourceAdId,
    },
    revision: 1,
  };
}

const template = {
  schema: "blockwise.ad-template",
  templateId,
  createdAt: "2026-09-12T00:00:00.000Z",
  feedLayout: { placement: "feed", layers: [{ type: "plate", layerId: "feed-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: true }], safeZones: [] },
  storyLayout: { placement: "story", layers: [{ type: "plate", layerId: "story-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1920 }, protected: true }], safeZones: [] },
  imageInputs: [],
  textInputs: [{ key: "headline", label: "Headline", placeholder: "Default", maxLength: 80 }],
  semanticColours: { background: "#ffffff", primary: "#111111", secondary: "#222222", accent: "#333333", mainText: "#000000", inverseText: "#ffffff" },
  assets: {},
  fonts: [],
  metadata: {
    title: "Native test", description: "", gallerySamples: {},
    metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" },
    aiWritingGuidance: { summary: "", fields: {} },
    publishRequirements: { objective: "LEAD_GENERATION", specialAdCategory: null, instantForm: { required: false, dependency: null }, destination: { required: false, kind: "none", dependency: null }, requiredCtaTypes: [] },
    replacementAssets: [], realAssetRefs: [],
  },
} as AdTemplate;

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
}

function fakeSupabase(options: { workspace?: string; activeRevision?: { id: string; revision_number: number; document_hash: string; feed_png_hash: string; story_png_hash: string } | null } = {}) {
  const expectedWorkspace = options.workspace ?? workspaceId;
  const rpcCalls: Array<{ name: string; args: Record<string, any> }> = [];
  const uploads: Array<{ path: string; bytes: Buffer }> = [];
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const query: any = {
      select() { return query; },
      eq(key: string, value: unknown) { filters[key] = value; return query; },
      async maybeSingle() {
        if (filters.workspace_id !== expectedWorkspace) return { data: null, error: null };
        if (table === "ad_customer_ads") {
          if (filters.id === trialAdId) return { data: { id: trialAdId, template_id: templateId, active_revision_id: options.activeRevision?.id ?? null, creation_key: nativeTrialCreationKey(sourceAdId) }, error: null };
          if (filters.id === sourceAdId) return { data: { id: sourceAdId, template_id: templateId }, error: null };
        }
        if (table === "ad_revisions" && filters.id === options.activeRevision?.id) return { data: options.activeRevision, error: null };
        return { data: null, error: null };
      },
      async single() {
        if (table === "ad_templates") return { data: { template_json: template }, error: null };
        return query.maybeSingle();
      },
    };
    return query;
  };
  return {
    client: {
      from,
      storage: { from: () => ({
        async upload(path: string, bytes: Buffer) { uploads.push({ path, bytes }); return { error: null }; },
        async download() { return { data: null, error: { message: "missing" } }; },
      }) },
      async rpc(name: string, args: Record<string, any>) { rpcCalls.push({ name, args }); return { data: { id: "revision-1", revision_number: 1 }, error: null }; },
    } as any,
    rpcCalls,
    uploads,
  };
}

describe("Vue native scene and export validation", () => {
  it("preserves vendor JSON while requiring exact placement dimensions", () => {
    const parsed = adDocumentSchema.parse(document());
    assert.deepEqual(parsed.nativeEditor?.feed.objects[0]?.vendorField, { retained: true });
    assert.throws(() => validateNativeEditorDocument({ nativeEditor: { ...parsed.nativeEditor!, feed: scene(1080, 1920) }, workspaceId, adId: trialAdId, templateId }), (error: unknown) => error instanceof NativeEditorValidationError && error.code === "native_scene_dimensions");
  });

  it("rejects arbitrary scene URLs and malformed or wrong-sized PNG exports", async () => {
    const native = document().nativeEditor!;
    assert.doesNotThrow(() => validateNativeEditorDocument({ nativeEditor: { ...native, feed: scene(1080, 1350, { type: "image", src: `/api/adstudio/templates/${templateId}/assets/photo%3Ahero?adId=${trialAdId}` }) }, workspaceId, adId: trialAdId, templateId }));
    assert.throws(() => validateNativeEditorDocument({ nativeEditor: { ...native, feed: scene(1080, 1350, { type: "image", src: "http://127.0.0.1/private" }) }, workspaceId, adId: trialAdId, templateId }), (error: unknown) => error instanceof NativeEditorValidationError && error.code === "native_scene_resource_invalid");
    await assert.rejects(() => validateNativePngExport({ mimeType: "image/png", base64: "not base64" }, "feed"), (error: unknown) => error instanceof NativeEditorValidationError && error.code === "native_export_invalid");
    const wrong = await png(100, 100);
    await assert.rejects(() => validateNativePngExport({ mimeType: "image/png", base64: wrong.toString("base64") }, "feed"), (error: unknown) => error instanceof NativeEditorValidationError && error.code === "native_export_dimensions");
  });
});

describe("Vue native revision persistence", () => {
  it("stores exact native scenes and browser PNG hashes in the active-revision transaction", async () => {
    const feed = await png(1080, 1350);
    const story = await png(1080, 1920);
    const fake = fakeSupabase();
    const parsed = adDocumentSchema.parse(document());
    const saved = await saveNativeAd({
      supabase: fake.client,
      templateSupabase: fake.client,
      workspaceId,
      adId: trialAdId,
      document: parsed,
      expectedRevision: 0,
      exports: {
        feed: { mimeType: "image/png", base64: feed.toString("base64") },
        story: { mimeType: "image/png", base64: story.toString("base64") },
      },
    });
    assert.equal(saved.revisionNumber, 1);
    assert.equal(fake.rpcCalls.length, 1);
    const revision = fake.rpcCalls[0]!.args.p_revision;
    assert.equal(revision.renderer_version, NATIVE_RENDERER_VERSION);
    assert.equal(revision.document_hash, documentToken(parsed));
    assert.deepEqual(revision.document_json.nativeEditor, parsed.nativeEditor);
    assert.equal(revision.feed_png_hash, createHash("sha256").update(feed).digest("hex"));
    assert.equal(revision.story_png_hash, createHash("sha256").update(story).digest("hex"));
    assert.match(revision.feed_png_path, new RegExp(`^${workspaceId}/adstudio/renders/${trialAdId}/feed-`));
    assert.equal(fake.uploads.length, 2);
  });

  it("fails closed for another workspace and for a stale revision", async () => {
    const exports = {
      feed: { mimeType: "image/png" as const, base64: (await png(1080, 1350)).toString("base64") },
      story: { mimeType: "image/png" as const, base64: (await png(1080, 1920)).toString("base64") },
    };
    const isolated = fakeSupabase({ workspace: "other-workspace" });
    await assert.rejects(() => saveNativeAd({ supabase: isolated.client, templateSupabase: isolated.client, workspaceId, adId: trialAdId, document: adDocumentSchema.parse(document()), expectedRevision: 0, exports }), (error: unknown) => error instanceof NativeSaveError && error.code === "ad_not_found");

    const stale = fakeSupabase({ activeRevision: { id: "revision-current", revision_number: 2, document_hash: "old", feed_png_hash: "a", story_png_hash: "b" } });
    await assert.rejects(() => saveNativeAd({ supabase: stale.client, templateSupabase: stale.client, workspaceId, adId: trialAdId, document: adDocumentSchema.parse(document()), expectedRevision: 1, exports }), (error: unknown) => error instanceof NativeSaveError && error.code === "stale_revision");
  });

  it("rejects native saves to an original ad before uploading artwork", async () => {
    const fake = fakeSupabase();
    const parsed = adDocumentSchema.parse(document());
    await assert.rejects(() => saveNativeAd({
      supabase: fake.client, templateSupabase: fake.client, workspaceId,
      adId: sourceAdId, document: parsed, expectedRevision: 0,
      exports: { feed: { mimeType: "image/png", base64: "" }, story: { mimeType: "image/png", base64: "" } },
    }), (error: unknown) => error instanceof NativeSaveError && error.code === "native_source_invalid");
    assert.equal(fake.uploads.length, 0);
    assert.equal(fake.rpcCalls.length, 0);
  });

  it("recognizes only the server-stable workspace-owned trial copy", async () => {
    const fake = fakeSupabase();
    assert.deepEqual(await loadNativeTrialIdentity(fake.client, workspaceId, trialAdId), { sourceAdId, templateId });
    assert.equal(await loadNativeTrialIdentity(fake.client, "other-workspace", trialAdId), null);
  });
});
