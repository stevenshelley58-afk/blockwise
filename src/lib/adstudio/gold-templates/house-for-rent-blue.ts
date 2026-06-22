import type { TemplateDesign, TemplateDesignSet, TemplateLayer } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "gold_house_for_rent_blue";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#F8FAFB", "#0D71A4", "#1D2B33", "#FFFFFF", "#111111"];
const FONTS = ["Inter, Arial, sans-serif", "Georgia, 'Times New Roman', serif"];

export const houseForRentBlueTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "House For Rent Blue",
  goal: "investor_leads",
  offerId: "listing_inquiries",
  imageBriefId: "IMG-REFERENCE-HOUSE-FOR-RENT-BLUE",
  promptHint: "Reference sample 09: white and electric-blue house-for-rent card with house cutout, feature icon strip, and black booking pill.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "House for rent",
    primaryText: "Modern house for rent, spacious design, prime location, perfect for families.",
    description: "Blue rental listing template based on the uploaded reference sample.",
    cta: "Book now",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "new_build",
    priceFeel: "investor_rental",
    visualStyle: "polished_meta_ad",
    people: "none",
    copyDensity: "stat_heavy",
    tone: "urgent_listing",
    sampleSuburb: "Scarborough",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Sam Park",
    address: "31 Brighton Road, Scarborough",
    propertyDetail: "house for rent",
    resultDetail: "rental enquiry campaign",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: houseForRentBlueDesigns(),
  evidenceScore: 99,
  winnerRationale: "Standalone mini-project copied from reference sample 09: blue diagonal card, central house hero, feature icon rail, and compact rent CTA.",
  complianceNote: "Editable rental listing template. Property image, headline, body, stat, and CTA remain replaceable.",
  exemplars: ["Reference sample 09 from the uploaded board."],
};

export const houseForRentBlueSample = {
  photoFile: "au-family-rendered.png",
  text: {
    eyebrow: "FOR RENT",
    headline: "House for rent",
    body: "Modern house for rent, spacious design, prime location, perfect for family.",
    cta: "Book now",
    address: "Scarborough",
    stat: "3 bed / 2 bath / garage",
  },
};

function houseForRentBlueDesigns(): TemplateDesignSet {
  return {
    "4:5": design("4:5", layout(0.07, 0.06, 0.86, 0.88, 72, 24)),
    "9:16": design("9:16", layout(0.07, 0.1, 0.86, 0.74, 76, 27)),
    "1:1": design("1:1", layout(0.06, 0.05, 0.88, 0.86, 52, 19)),
  };
}

function layout(x: number, y: number, w: number, h: number, headlineSize: number, bodySize: number): TemplateLayer[] {
  return [
    shape("card", box(x, y, w, h), PALETTE[0], "background", 26),
    shape("blue_block", box(x + w * 0.56, y + h * 0.22, w * 0.32, h * 0.31), PALETTE[1], "panel", 20),
    logo("logo", box(x + w * 0.12, y + h * 0.1, w * 0.26, h * 0.04)),
    text("headline", "headline", box(x + w * 0.14, y + h * 0.27, w * 0.46, h * 0.11), headlineSize, PALETTE[4], "ai_copy", undefined, 36, "left", FONTS[0], 760, 1),
    text("body", "body", box(x + w * 0.14, y + h * 0.39, w * 0.42, h * 0.07), bodySize, "#4D5961", "ai_copy", undefined, 90, "left", FONTS[0], 500, 1.16),
    image("primary_photo", box(x + w * 0.33, y + h * 0.45, w * 0.5, h * 0.28), "primary", "center"),
    shape("feature_strip", box(x + w * 0.22, y + h * 0.69, w * 0.56, h * 0.075), "#2A99CF", "band", 12),
    text("stat", "stat", box(x + w * 0.25, y + h * 0.715, w * 0.5, h * 0.025), bodySize * 0.72, "#FFFFFF", "static", "3 bed / 2 bath / garage", 38, "center", FONTS[0], 760, 1),
    cta("cta", box(x + w * 0.38, y + h * 0.81, w * 0.24, h * 0.045), "#111111", "#FFFFFF", 999, bodySize * 0.72),
  ];
}

function design(format: "4:5" | "9:16" | "1:1", layers: TemplateLayer[]): TemplateDesign { return { templateId: ID, version: 1, format, canvas: format === "9:16" ? { w: 1080, h: 1920 } : format === "1:1" ? { w: 1080, h: 1080 } : { w: 1080, h: 1350 }, palette: PALETTE, fonts: FONTS, layers }; }
function box(x: number, y: number, w: number, h: number) { return { x, y, w, h }; }
function shape(id: string, rect: ReturnType<typeof box>, fill: string, role: "background" | "panel" | "band" | "scrim", radius = 0): TemplateLayer { return { id, type: "shape", rect, fill, role, radius, locked: true }; }
function image(id: string, rect: ReturnType<typeof box>, role: "primary", anchor: "center" | "top" | "bottom"): TemplateLayer { return { id, type: "image_slot", rect, role, fit: "cover", anchor, mask: "none" }; }
function logo(id: string, rect: ReturnType<typeof box>): TemplateLayer { return { id, type: "logo", rect, source: "brand_kit" }; }
function text(id: string, slot: "headline" | "body" | "stat", rect: ReturnType<typeof box>, size: number, color: string, fill: "ai_copy" | "static", copy: string | undefined, maxChars: number, align: "left" | "center" | "right", font: string, weight: number, lineHeight: number): TemplateLayer {
  return { id, type: "text", slot, rect, align, font, size: Math.max(size, slot === "headline" ? 46 : 18), lineHeight, weight, color, fill, text: copy, maxChars, case: "none" };
}
function cta(id: string, rect: ReturnType<typeof box>, fill: string, textColor: string, radius: number, size: number): TemplateLayer { return { id, type: "cta_button", rect, fill, radius, label: "cta", textColor, font: FONTS[0], size: Math.max(size, 18) }; }
