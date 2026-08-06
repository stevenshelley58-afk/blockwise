import { NextResponse } from "next/server";

import { renderAdDocToPng } from "@/lib/adstudio/v2/render/server.ts";
import type { AdTemplateDocV2 } from "@/lib/adstudio/v2/template-doc.ts";

// F0 acceptance #4: proves the napi-rs/canvas backend renders on the Vercel
// Node runtime. Gated by ADSTUDIO_RENDER_SMOKE (Preview env only; never set
// in production — canonical pixels ship through /doc, not here). The fixture
// is self-contained (committed smoke plate) so the smoke never depends on
// gallery QA state or provider keys.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SMOKE_PLATE_SHA = "4baf90c57e62694b2e76d820076f29736e9812ac561cca90dcce047d99bcc58f";

const SMOKE_DOC: AdTemplateDocV2 = {
  schema: "adstudio.template.v2",
  id: "meta-smoke",
  name: "Deploy render smoke",
  goal: "seller_leads",
  offerId: "general",
  category: "real-estate",
  tags: [],
  audienceIntent: "smoke",
  classification: { ad_type: "feed", primary_intent: "other", property_or_agent_focus: "property" },
  provenance: {
    sourceAd: { contentHash: "0".repeat(64) },
    sample: { imageSrc: "", contentHash: "1".repeat(64), generatedBy: "deterministic_render" },
    decomposedFrom: "source",
  },
  restyle: { paletteMap: {}, replacedAssets: [] },
  fonts: [],
  formats: {
    feed: {
      format: "4:5",
      width: 1080,
      height: 1350,
      plate: { src: "/adstudio-templates/__smoke__/plate-feed.webp", sha256: SMOKE_PLATE_SHA },
      layers: [
        {
          id: "text-smoke",
          type: "text",
          z: 1,
          inputKey: "headline",
          box: { x: 0.1, y: 0.4, width: 0.8, height: 0.2 },
          typo: {
            fontId: "arimo",
            family: "Arimo",
            fallbackFamily: "sans-serif",
            weight: 400,
            italic: false,
            case: "upper",
            sizeRatio: 0.4,
            lineHeight: 1.1,
            tracking: 0,
            align: "center",
            color: "#111111",
          },
          constraints: { maxLength: 40, maxLines: 2, autoFitMinRatio: 0.85 },
          measurement: { fitScore: 1, detectionScore: 1, source: "manual-verified", version: 1 },
        },
      ],
    },
  },
  inputs: {
    images: [],
    text: [{ key: "headline", label: "Headline", required: true, maxLength: 40, sample: "Render smoke" }],
  },
  publish: {
    platform: "meta",
    objective: "OUTCOME_LEADS",
    specialAdCategory: "housing",
    apiVersionMin: "v26.0",
    copy: { primaryText: ["smoke"], headlines: ["smoke"], descriptions: [] },
    cta: "LEARN_MORE",
    leadForm: { headline: "smoke", questions: [], thankYou: { title: "t", body: "b" } },
    placements: { publisherPlatforms: ["facebook"], facebookPositions: ["feed"], instagramPositions: [] },
    formatRouting: { feed: "4:5", story: null },
    creativeFeatures: {},
    previewFormats: [],
  },
  editPolicy: { mode: "guided", advancedUnlockable: true, lockedLayerIds: [] },
  exactness: { status: "draft", residuals: {}, bakedTextKeys: [] },
};

export async function GET() {
  if (process.env.ADSTUDIO_RENDER_SMOKE !== "1") {
    return NextResponse.json({ error: "Render smoke is disabled." }, { status: 404 });
  }
  const started = Date.now();
  const instance = {
    schema: "adstudio.instance.v2" as const,
    templateId: SMOKE_DOC.id,
    templateHash: "0".repeat(64),
    format: "4:5" as const,
    values: { images: {}, text: { headline: "Render smoke" } },
    overrides: [],
  };
  const png = await renderAdDocToPng(SMOKE_DOC, instance, "4:5");
  return NextResponse.json({
    ok: true,
    template: SMOKE_DOC.id,
    bytes: png.length,
    width: 1080,
    height: 1350,
    ms: Date.now() - started,
  });
}
