import type { TemplateDesign, TemplateDesignSet, TemplateLayer } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "gold_elevate_residences";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#074E5A", "#0D1A1E", "#48D6D2", "#FFFFFF", "#F2B84B"];
const FONTS = ["Inter, Arial, sans-serif", "Georgia, 'Times New Roman', serif"];

export const elevateResidencesTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Elevate Residences Stack",
  goal: "buyer_leads",
  offerId: "listing_inquiries",
  imageBriefId: "IMG-REFERENCE-ELEVATE-RESIDENCES",
  promptHint: "Reference sample 04: teal development hero card stacked above a buyer/seller agent contact card.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Elevate residences",
    primaryText: "A higher standard of living, above the city lights.",
    description: "Two-panel development/listing template based on the uploaded teal reference.",
    cta: "Inspect now",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "development_render",
    priceFeel: "luxury_architectural",
    visualStyle: "super_premium_polished",
    people: "agent_portrait",
    copyDensity: "stat_heavy",
    tone: "over_the_top_direct_response",
    sampleSuburb: "South Perth",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Hannah Morales",
    address: "South Perth skyline",
    propertyDetail: "premium residence release",
    resultDetail: "buyer enquiry campaign",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: elevateResidencesDesigns(),
  evidenceScore: 99,
  winnerRationale: "Standalone mini-project copied from reference sample 04: upper teal project card, price/info chips, and lower consultation panel.",
  complianceNote: "Editable development-style template. No source pixels are baked into the design.",
  exemplars: ["Reference sample 04 from the uploaded board."],
};

export const elevateResidencesSample = {
  photoFile: "au-family-rendered.png",
  photoFiles: {
    primary_photo: "au-family-rendered.png",
    secondary_card: "au-modern-coastal.png",
  },
  text: {
    eyebrow: "NEW RELEASE",
    headline: "Elevate residences",
    body: "A higher standard of living, above the city lights.",
    cta: "Inspect now",
    address: "South Perth",
    stat: "From $850k",
    phone: "08 6111 2400",
  },
};

function elevateResidencesDesigns(): TemplateDesignSet {
  return {
    "4:5": design("4:5", stackLayers(0.09, 0.055, 0.82, 0.88, 56, 22)),
    "9:16": design("9:16", stackLayers(0.08, 0.09, 0.84, 0.74, 58, 24)),
    "1:1": design("1:1", stackLayers(0.07, 0.05, 0.86, 0.86, 48, 18)),
  };
}

function stackLayers(x: number, y: number, w: number, h: number, headlineSize: number, bodySize: number): TemplateLayer[] {
  return [
    shape("bg", box(x, y, w, h), "#ECECEC", "background", 18),
    shape("hero_teal", box(x, y, w, h * 0.56), PALETTE[0], "panel", 18),
    shape("teal_scrim", box(x, y, w, h * 0.56), "#053A44", "scrim", 18, 0.68),
    image("primary_photo", box(x + w * 0.25, y + h * 0.2, w * 0.5, h * 0.25), "primary", "center"),
    text("headline", "headline", box(x + w * 0.18, y + h * 0.08, w * 0.64, h * 0.1), headlineSize, "#FFFFFF", "ai_copy", undefined, 42, "center", FONTS[0], 900, 0.98),
    text("body", "body", box(x + w * 0.22, y + h * 0.18, w * 0.56, h * 0.05), bodySize, "#DFF7F6", "ai_copy", undefined, 74, "center", FONTS[0], 650, 1.12),
    shape("price_chip", box(x + w * 0.13, y + h * 0.46, w * 0.22, h * 0.06), "#07282E", "band", 8),
    text("stat", "stat", box(x + w * 0.145, y + h * 0.478, w * 0.19, h * 0.025), bodySize * 0.78, PALETTE[2], "static", "From $850k", 18, "center", FONTS[0], 850, 1),
    shape("loc_chip", box(x + w * 0.39, y + h * 0.46, w * 0.22, h * 0.06), "#07282E", "band", 8),
    text("address", "address", box(x + w * 0.405, y + h * 0.478, w * 0.19, h * 0.025), bodySize * 0.72, "#FFFFFF", "static", "South Perth", 24, "center", FONTS[0], 750, 1),
    shape("feature_chip", box(x + w * 0.65, y + h * 0.46, w * 0.22, h * 0.06), "#07282E", "band", 8),
    text("feature", "body", box(x + w * 0.665, y + h * 0.478, w * 0.19, h * 0.025), bodySize * 0.7, "#FFFFFF", "static", "Rooftop views", 24, "center", FONTS[0], 750, 1),
    shape("lower_card", box(x, y + h * 0.61, w, h * 0.31), "#FFFFFF", "panel", 18),
    text("consult", "body", box(x + w * 0.08, y + h * 0.67, w * 0.54, h * 0.08), bodySize * 1.15, PALETTE[1], "static", "Thinking of buying or selling?", 48, "left", FONTS[0], 900, 1.03),
    text("phone", "phone", box(x + w * 0.08, y + h * 0.78, w * 0.36, h * 0.035), bodySize * 0.68, PALETTE[1], "brand", undefined, 30, "left", FONTS[0], 750, 1),
    cta("cta", box(x + w * 0.08, y + h * 0.84, w * 0.27, h * 0.045), PALETTE[1], "#FFFFFF", 999, bodySize * 0.72),
    image("secondary_card", box(x + w * 0.66, y + h * 0.66, w * 0.22, h * 0.2), "secondary", "center"),
  ];
}

function design(format: "4:5" | "9:16" | "1:1", layers: TemplateLayer[]): TemplateDesign { return { templateId: ID, version: 1, format, canvas: format === "9:16" ? { w: 1080, h: 1920 } : format === "1:1" ? { w: 1080, h: 1080 } : { w: 1080, h: 1350 }, palette: PALETTE, fonts: FONTS, layers }; }
function box(x: number, y: number, w: number, h: number) { return { x, y, w, h }; }
function shape(id: string, rect: ReturnType<typeof box>, fill: string, role: "background" | "panel" | "band" | "scrim", radius = 0, opacity?: number): TemplateLayer { return { id, type: "shape", rect, fill, role, radius, opacity, locked: true }; }
function image(id: string, rect: ReturnType<typeof box>, role: "primary" | "secondary", anchor: "center" | "top" | "bottom" = "center"): TemplateLayer { return { id, type: "image_slot", rect, role, fit: "cover", anchor, mask: "none" }; }
function text(id: string, slot: "headline" | "body" | "stat" | "address" | "phone", rect: ReturnType<typeof box>, size: number, color: string, fill: "ai_copy" | "brand" | "static", copy: string | undefined, maxChars: number, align: "left" | "center" | "right", font: string, weight: number, lineHeight: number): TemplateLayer {
  return { id, type: "text", slot, rect, align, font, size: Math.max(size, slot === "headline" ? 46 : 18), lineHeight, weight, color, fill, text: copy, maxChars, case: "none" };
}
function cta(id: string, rect: ReturnType<typeof box>, fill: string, textColor: string, radius: number, size: number): TemplateLayer { return { id, type: "cta_button", rect, fill, radius, label: "cta", textColor, font: FONTS[0], size: Math.max(size, 18) }; }
