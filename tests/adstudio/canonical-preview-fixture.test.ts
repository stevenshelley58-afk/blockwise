import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, it } from "node:test";
import { renderPlacement } from "../../packages/ad-template-renderer/src/renderer.ts";
import { handleCanonicalPreview } from "../../src/lib/adstudio/canonical-preview.ts";
import { saveAd } from "../../src/lib/adstudio/save-ad.ts";

const colours = { background: "#ffffff", primary: "#111111", secondary: "#222222", accent: "#ff0000", mainText: "#000000", inverseText: "#ffffff" };
const base = { schema: "blockwise.ad-template", templateId: "fixture-template", createdAt: "2026-09-07T00:00:00.000Z", imageInputs: [{ key: "hero", label: "Hero", required: true, acceptedTypes: ["image/png"] }], textInputs: [{ key: "headline", label: "Headline", placeholder: "Default", maxLength: 80 }], semanticColours: colours, assets: {}, fonts: [{ file: "manrope-800.woff2" }], metadata: { title: "Fixture", description: "", gallerySamples: {}, metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" }, aiWritingGuidance: { summary: "", fields: {} }, publishRequirements: { objective: "LEAD_GENERATION", specialAdCategory: null, instantForm: { required: false, dependency: null }, destination: { required: false, kind: "none", dependency: null }, requiredCtaTypes: [] }, replacementAssets: [], realAssetRefs: [] } };
const plate = (id: string, h: number) => ({ type: "plate", layerId: id, colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: h }, protected: true });
const image = (id: string, h: number) => ({ type: "image_slot", layerId: id, inputKey: "hero", geometry: { x: 100, y: 100, width: 880, height: 500 }, mask: "none", minSourceWidth: 1, minSourceHeight: 1, defaultCrop: { x: 0, y: 0, width: 1, height: 1 }, allowedPlacementOverrides: ["crop"] });
const text = (id: string) => ({ type: "text", layerId: id, inputKey: "headline", font: { file: "manrope-800.woff2" }, geometry: { x: 100, y: 700, width: 880, height: 120 }, fontSize: 40, lineHeight: 1, tracking: 0, alignment: "left", maxCharacters: 80, maxLines: 1, colourRole: "mainText", overflowBehaviour: "scale_down" });
const template = { ...base, feedLayout: { placement: "feed", layers: [plate("feed-bg", 1350), image("feed-image", 1350), text("feed-text")], safeZones: [] }, storyLayout: { placement: "story", layers: [plate("story-bg", 1920), image("story-image", 1920), text("story-text")], safeZones: [] } } as any;
const document = { schema: "blockwise.ad-document", templateId: "fixture-template", sharedImageValues: { hero: "workspace/hero.png" }, sharedTextValues: { headline: "Edited headline" }, feedCropOverrides: { hero: { x: 0, y: 0, width: 0.5, height: 1 } }, storyCropOverrides: { hero: { x: 0.5, y: 0, width: 0.5, height: 1 } }, colourMode: "template", resolvedColourMap: colours, metaPrimaryText: "", metaHeadline: "", metaDescription: "", metaCta: "LEARN_MORE", revision: 1 };
const imageBytes = (() => { const canvas = createCanvas(8, 4); const ctx = canvas.getContext("2d"); ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, 4, 4); ctx.fillStyle = "#0000ff"; ctx.fillRect(4, 0, 4, 4); return canvas.toBuffer("image/png"); })();

describe("canonical preview replacement fixture", () => {
  it("matches direct save renderer bytes and changes with text/crop edits", async () => {
    const deps = { loadAd: async () => ({ templateId: template.templateId }), loadTemplate: async () => template, resolveImages: async () => ({ hero: imageBytes }) };
    const previewFeed = await handleCanonicalPreview({ adId: "ad", workspaceId: "ws", placement: "feed", document, deps });
    const uploads = new Map<string, Buffer>();
    const supabase = {
      from(table: string) {
        const query: any = {};
        query.select = () => query;
        query.eq = () => query;
        query.single = async () => table === "ad_customer_ads"
          ? { data: { id: "ad", active_revision_id: null, template_id: template.templateId }, error: null }
          : { data: { template_json: template }, error: null };
        return query;
      },
      storage: {
        from() {
          return {
            async upload(path: string, bytes: Buffer) {
              uploads.set(path, bytes);
              return { error: null };
            },
          };
        },
      },
      async rpc() {
        return { data: { id: "revision", revision_number: 1 }, error: null };
      },
    };
    await saveAd({
      supabase: supabase as never,
      workspaceId: "ws",
      adId: "ad",
      document,
      expectedRevision: 0,
      colourMap: colours,
      imageValues: { hero: imageBytes },
      renderPlacement: async placement => {
        const rendered = await renderPlacement({
          template,
          imageValues: { hero: imageBytes },
          textValues: document.sharedTextValues,
          colourMap: colours,
          cropOverrides: placement === "feed" ? document.feedCropOverrides : document.storyCropOverrides,
        }, placement);
        return { sha256: createHash("sha256").update(rendered.png).digest("hex"), png: rendered.png };
      },
    });
    const savedFeed = [...uploads.entries()].find(([path]) => path.includes("/feed-"))?.[1];
    const savedStory = [...uploads.entries()].find(([path]) => path.includes("/story-"))?.[1];
    assert.ok(savedFeed);
    assert.ok(savedStory);
    assert.deepEqual(previewFeed.render.png, savedFeed);
    const previewStory = await handleCanonicalPreview({ adId: "ad", workspaceId: "ws", placement: "story", document, deps });
    assert.deepEqual(previewStory.render.png, savedStory);
    const edited = await handleCanonicalPreview({ adId: "ad", workspaceId: "ws", placement: "feed", document: { ...document, sharedTextValues: { headline: "A different edited headline" } }, deps });
    assert.notDeepEqual(edited.render.png, previewFeed.render.png);
  });
});

