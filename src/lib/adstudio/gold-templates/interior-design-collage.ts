import type { TemplateDesign, TemplateDesignSet, TemplateLayer } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "gold_interior_design_collage";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#E8E2D6", "#2E2B27", "#FFFFFF", "#9B6B4E", "#C8B7A1"];
const FONTS = ["Georgia, 'Times New Roman', serif", "Inter, Arial, sans-serif"];

export const interiorDesignCollageTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Interior Collage Specialist",
  goal: "seller_leads",
  offerId: "download_guide",
  imageBriefId: "IMG-REFERENCE-INTERIOR-COLLAGE",
  promptHint: "Reference sample 02: interior-design style collage with four image panels, inset title card, border details, and a fine-print contact strip.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Interior design specialist",
    primaryText: "Bring the best rooms forward before buyers see the listing.",
    description: "Multi-image editorial service template based on the uploaded collage reference.",
    cta: "Get the guide",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "renovated_character",
    priceFeel: "premium_coastal",
    visualStyle: "polished_meta_ad",
    people: "none",
    copyDensity: "full_sales_poster",
    tone: "quiet_editorial",
    sampleSuburb: "Mount Lawley",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Clara Moretti",
    address: "47 View Street, Mount Lawley",
    propertyDetail: "styled interior campaign",
    resultDetail: "seller guide download",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: interiorDesignCollageDesigns(),
  evidenceScore: 99,
  winnerRationale: "Standalone mini-project copied from reference sample 02: asymmetric image collage, central paper title card, and fine UI-like contact strip.",
  complianceNote: "Editable collage template. Each image slot, headline, body, CTA, and brand are replaceable.",
  exemplars: ["Reference sample 02 from the uploaded board."],
};

export const interiorDesignCollageSample = {
  photoFile: "au-character-cottage.jpg",
  photoFiles: {
    primary_photo: "au-urban-townhouse.png",
    secondary_top: "au-coastal-luxury.jpg",
    secondary_mid: "au-limestone-coastal.png",
    secondary_low: "au-brick-family-home.jpg",
  },
  text: {
    eyebrow: "STYLE GUIDE",
    headline: "Interior design specialist",
    body: "Bring the best rooms forward before buyers see the listing.",
    cta: "Get the guide",
    address: "Mount Lawley rooms",
    stat: "4 spaces",
  },
};

function interiorDesignCollageDesigns(): TemplateDesignSet {
  return {
    "4:5": design("4:5", [
      shape("canvas", b(0.06, 0.04, 0.88, 0.9), PALETTE[0], "background", 24),
      image("primary_photo", b(0.14, 0.09, 0.32, 0.31), "primary", "center"),
      image("secondary_top", b(0.49, 0.09, 0.34, 0.2), "secondary", "center"),
      image("secondary_mid", b(0.49, 0.31, 0.34, 0.22), "secondary", "center"),
      image("secondary_low", b(0.49, 0.55, 0.34, 0.2), "secondary", "center"),
      shape("title_card", b(0.14, 0.42, 0.36, 0.28), "#FFF8EE", "panel", 4),
      text("eyebrow", "eyebrow", b(0.17, 0.45, 0.3, 0.04), 20, PALETTE[3], "static", "INTERIOR RELEASE", 32, "center", FONTS[1], 800, 1),
      text("headline", "headline", b(0.16, 0.49, 0.32, 0.11), 48, PALETTE[1], "ai_copy", undefined, 60, "center", FONTS[0], 700, 1.06),
      cta("cta", b(0.2, 0.625, 0.23, 0.045), "#FFFFFF", PALETTE[1], 999, 18),
      shape("bottom_strip", b(0.12, 0.79, 0.76, 0.1), "#FFFFFF", "panel", 2),
      text("body", "body", b(0.15, 0.815, 0.52, 0.05), 21, PALETTE[1], "ai_copy", undefined, 95, "left", FONTS[1], 550, 1.16),
      text("address", "address", b(0.68, 0.825, 0.17, 0.035), 16, PALETTE[3], "static", "Mount Lawley", 30, "right", FONTS[1], 700, 1),
    ]),
    "9:16": design("9:16", [
      shape("canvas", b(0.06, 0.07, 0.88, 0.78), PALETTE[0], "background", 24),
      image("primary_photo", b(0.13, 0.11, 0.36, 0.25), "primary", "center"),
      image("secondary_top", b(0.52, 0.11, 0.32, 0.17), "secondary", "center"),
      image("secondary_mid", b(0.52, 0.3, 0.32, 0.18), "secondary", "center"),
      image("secondary_low", b(0.52, 0.5, 0.32, 0.17), "secondary", "center"),
      shape("title_card", b(0.13, 0.39, 0.38, 0.2), "#FFF8EE", "panel", 4),
      text("headline", "headline", b(0.15, 0.43, 0.34, 0.09), 48, PALETTE[1], "ai_copy", undefined, 60, "center", FONTS[0], 700, 1.06),
      cta("cta", b(0.18, 0.54, 0.27, 0.04), "#FFFFFF", PALETTE[1], 999, 19),
      shape("bottom_strip", b(0.12, 0.7, 0.76, 0.08), "#FFFFFF", "panel", 2),
      text("body", "body", b(0.15, 0.725, 0.58, 0.04), 22, PALETTE[1], "ai_copy", undefined, 95, "left", FONTS[1], 550, 1.16),
    ]),
    "1:1": design("1:1", [
      shape("canvas", b(0.06, 0.05, 0.88, 0.88), PALETTE[0], "background", 24),
      image("primary_photo", b(0.13, 0.1, 0.35, 0.29), "primary", "center"),
      image("secondary_top", b(0.51, 0.1, 0.34, 0.19), "secondary", "center"),
      image("secondary_mid", b(0.51, 0.31, 0.34, 0.2), "secondary", "center"),
      image("secondary_low", b(0.51, 0.53, 0.34, 0.18), "secondary", "center"),
      shape("title_card", b(0.14, 0.43, 0.34, 0.23), "#FFF8EE", "panel", 4),
      text("headline", "headline", b(0.15, 0.46, 0.32, 0.11), 46, PALETTE[1], "ai_copy", undefined, 60, "center", FONTS[0], 700, 1.06),
      shape("bottom_strip", b(0.12, 0.77, 0.76, 0.09), "#FFFFFF", "panel", 2),
      cta("cta", b(0.63, 0.795, 0.18, 0.04), "#FFFFFF", PALETTE[1], 999, 16),
      text("body", "body", b(0.15, 0.795, 0.43, 0.04), 17, PALETTE[1], "ai_copy", undefined, 80, "left", FONTS[1], 550, 1.16),
    ]),
  };
}

function design(format: "4:5" | "9:16" | "1:1", layers: TemplateLayer[]): TemplateDesign {
  return { templateId: ID, version: 1, format, canvas: format === "9:16" ? { w: 1080, h: 1920 } : format === "1:1" ? { w: 1080, h: 1080 } : { w: 1080, h: 1350 }, palette: PALETTE, fonts: FONTS, layers };
}
function b(x: number, y: number, w: number, h: number) { return { x, y, w, h }; }
function shape(id: string, rect: ReturnType<typeof b>, fill: string, role: "background" | "panel" | "band" | "scrim", radius = 0): TemplateLayer { return { id, type: "shape", rect, fill, role, radius, locked: true }; }
function image(id: string, rect: ReturnType<typeof b>, role: "primary" | "secondary", anchor: "center" | "top" | "bottom" | "left" | "right" = "center"): TemplateLayer { return { id, type: "image_slot", rect, role, fit: "cover", anchor, mask: "none" }; }
function text(id: string, slot: "eyebrow" | "headline" | "body" | "cta" | "address" | "stat", rect: ReturnType<typeof b>, size: number, color: string, fill: "ai_copy" | "brand" | "static", copy: string | undefined, maxChars: number, align: "left" | "center" | "right", font: string, weight: number, lineHeight: number): TemplateLayer {
  return { id, type: "text", slot, rect, align, font, size: Math.max(size, slot === "headline" ? 46 : 18), lineHeight, weight, color, fill, text: copy, maxChars, case: slot === "eyebrow" ? "upper" : "none" };
}
function cta(id: string, rect: ReturnType<typeof b>, fill: string, textColor: string, radius: number, size: number): TemplateLayer { return { id, type: "cta_button", rect, fill, radius, label: "cta", textColor, font: FONTS[1], size: Math.max(size, 18) }; }
