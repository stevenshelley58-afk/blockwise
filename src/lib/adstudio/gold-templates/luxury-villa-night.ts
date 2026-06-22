import type { TemplateDesign, TemplateDesignSet, TemplateLayer } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "gold_luxury_villa_night";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#050403", "#F5F0E6", "#9E8A5D", "#191512", "#FFFFFF"];
const FONTS = ["Georgia, 'Times New Roman', serif", "Inter, Arial, sans-serif"];

export const luxuryVillaNightTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Luxury Villa Night",
  goal: "investor_leads",
  offerId: "listing_inquiries",
  imageBriefId: "IMG-REFERENCE-LUXURY-VILLA-NIGHT",
  promptHint: "Reference sample 06: moody black luxury villa ad with full-bleed dark interior, huge elegant headline, feature icons, and website strip.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Luxury villa",
    primaryText: "New luxury villa is now available for renters wanting style, comfort, and convenience.",
    description: "Dark luxury interior template based on the uploaded villa reference.",
    cta: "Enquire now",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "luxury_architectural",
    priceFeel: "luxury_architectural",
    visualStyle: "super_premium_polished",
    people: "none",
    copyDensity: "headline_overlay",
    tone: "simple_super_premium",
    sampleSuburb: "Cottesloe",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Jon Bell",
    address: "9 Marine Parade, Cottesloe",
    propertyDetail: "luxury villa at night",
    resultDetail: "premium rental enquiry",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: luxuryVillaNightDesigns(),
  evidenceScore: 99,
  winnerRationale: "Standalone mini-project copied from reference sample 06: full dark image, oversized luxury headline, feature rail, and web/contact strip.",
  complianceNote: "Editable luxury listing template with replaceable photo, features, copy, and CTA.",
  exemplars: ["Reference sample 06 from the uploaded board."],
};

export const luxuryVillaNightSample = {
  photoFile: "au-coastal-luxury.jpg",
  text: {
    eyebrow: "LUXURY RELEASE",
    headline: "Luxury villa",
    body: "New luxury villa is now available for a stylish coastal lifestyle.",
    cta: "Enquire now",
    stat: "2 bed / 2 bath / kitchen set",
    address: "Cottesloe",
  },
};

function luxuryVillaNightDesigns(): TemplateDesignSet {
  return {
    "4:5": design("4:5", layout(0, 0, 1, 1, 112, 28)),
    "9:16": design("9:16", layout(0, 0, 1, 1, 118, 31)),
    "1:1": design("1:1", layout(0, 0, 1, 1, 78, 21)),
  };
}

function layout(x: number, y: number, w: number, h: number, headlineSize: number, bodySize: number): TemplateLayer[] {
  return [
    image("primary_photo", box(x, y, w, h), "primary", "center"),
    shape("dark_overlay", box(0, 0, 1, 1), "#000000", "scrim", 0, 0.48),
    text("headline", "headline", box(0.06, 0.16, 0.74, 0.13), headlineSize, PALETTE[1], "ai_copy", undefined, 34, "left", FONTS[0], 500, 0.96),
    text("body", "body", box(0.06, 0.31, 0.67, 0.07), bodySize, "#FFFFFF", "ai_copy", undefined, 110, "left", FONTS[1], 650, 1.12),
    shape("feature_bar", box(0.06, 0.73, 0.78, 0.12), "#0B0B0A", "panel", 18, 0.82),
    text("stat", "stat", box(0.08, 0.77, 0.72, 0.04), bodySize * 0.9, "#FFFFFF", "static", "2 bedroom    kitchen set    lounge", 56, "center", FONTS[1], 760, 1),
    text("address", "address", box(0.06, 0.88, 0.4, 0.035), bodySize * 0.68, "#FFFFFF", "static", "Cottesloe", 26, "left", FONTS[1], 650, 1),
    cta("cta", box(0.66, 0.875, 0.21, 0.045), "#FFFFFF", "#111111", 999, bodySize * 0.72),
  ];
}

function design(format: "4:5" | "9:16" | "1:1", layers: TemplateLayer[]): TemplateDesign { return { templateId: ID, version: 1, format, canvas: format === "9:16" ? { w: 1080, h: 1920 } : format === "1:1" ? { w: 1080, h: 1080 } : { w: 1080, h: 1350 }, palette: PALETTE, fonts: FONTS, layers }; }
function box(x: number, y: number, w: number, h: number) { return { x, y, w, h }; }
function shape(id: string, rect: ReturnType<typeof box>, fill: string, role: "background" | "panel" | "band" | "scrim", radius = 0, opacity?: number): TemplateLayer { return { id, type: "shape", rect, fill, role, radius, opacity, locked: true }; }
function image(id: string, rect: ReturnType<typeof box>, role: "primary", anchor: "center" | "top" | "bottom"): TemplateLayer { return { id, type: "image_slot", rect, role, fit: "cover", anchor, mask: "none" }; }
function text(id: string, slot: "headline" | "body" | "stat" | "address", rect: ReturnType<typeof box>, size: number, color: string, fill: "ai_copy" | "static", copy: string | undefined, maxChars: number, align: "left" | "center" | "right", font: string, weight: number, lineHeight: number): TemplateLayer {
  return { id, type: "text", slot, rect, align, font, size: Math.max(size, slot === "headline" ? 46 : 18), lineHeight, weight, color, fill, text: copy, maxChars, case: "none" };
}
function cta(id: string, rect: ReturnType<typeof box>, fill: string, textColor: string, radius: number, size: number): TemplateLayer { return { id, type: "cta_button", rect, fill, radius, label: "cta", textColor, font: FONTS[1], size: Math.max(size, 18) }; }
