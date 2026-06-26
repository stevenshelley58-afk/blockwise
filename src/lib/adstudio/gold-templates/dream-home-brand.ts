import type { TemplateDesign, TemplateDesignSet, TemplateLayer } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "gold_dream_home_brand";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#FFFFFF", "#7A3F21", "#2B201A", "#F0D8BD", "#E2A05D"];
const FONTS = ["Inter, Arial, sans-serif", "Georgia, 'Times New Roman', serif"];

export const dreamHomeBrandTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Dream Home Brand",
  goal: "seller_leads",
  offerId: "listing_inquiries",
  imageBriefId: "IMG-REFERENCE-DREAM-HOME",
  promptHint: "Reference sample 08: white brand-led card with centered logo, chunky brown headline, bottom hero property image, and sunrise accent.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Find your dream home",
    primaryText: "Trusted real estate solutions tailored to your lifestyle.",
    description: "Brand-led real estate card based on the uploaded reference sample.",
    cta: "Start search",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "new_build",
    priceFeel: "mid_market_family",
    visualStyle: "polished_meta_ad",
    people: "none",
    copyDensity: "headline_overlay",
    tone: "soft_organic",
    sampleSuburb: "Victoria Park",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Leo Romano",
    address: "15 Albany Highway, Victoria Park",
    propertyDetail: "dream home search",
    resultDetail: "buyer enquiry lead",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: dreamHomeBrandDesigns(),
  evidenceScore: 99,
  winnerRationale: "Standalone mini-project copied from reference sample 08: logo-first white card, stacked brown headline, bottom hero image, and warm accent block.",
  complianceNote: "Editable brand-led real estate template with replaceable headline, photo, CTA, and address.",
  exemplars: ["Reference sample 08 from the uploaded board."],
};

export const dreamHomeBrandSample = {
  photoFile: "au-modern-coastal.png",
  text: {
    eyebrow: "BLOCKWISE REALTY",
    headline: "Find your dream home",
    body: "Trusted real estate solutions tailored to your lifestyle.",
    cta: "Start search",
    address: "Victoria Park",
    stat: "New homes",
  },
};

function dreamHomeBrandDesigns(): TemplateDesignSet {
  return {
    "4:5": design("4:5", layout(0.08, 0.04, 0.84, 0.9, 76, 25)),
    "9:16": design("9:16", layout(0.08, 0.08, 0.84, 0.78, 82, 28)),
    "1:1": design("1:1", layout(0.07, 0.05, 0.86, 0.86, 56, 20)),
  };
}

function layout(x: number, y: number, w: number, h: number, headlineSize: number, bodySize: number): TemplateLayer[] {
  return [
    shape("paper", box(x, y, w, h), "#FFFFFF", "background", 26),
    logo("logo", box(x + w * 0.36, y + h * 0.05, w * 0.28, h * 0.04)),
    text("headline", "headline", box(x + w * 0.19, y + h * 0.16, w * 0.62, h * 0.18), headlineSize, PALETTE[1], "ai_copy", undefined, 44, "center", FONTS[0], 900, 1.02),
    text("body", "body", box(x + w * 0.19, y + h * 0.38, w * 0.62, h * 0.06), bodySize, PALETTE[2], "ai_copy", undefined, 86, "center", FONTS[0], 650, 1.18),
    shape("accent", box(x + w * 0.36, y + h * 0.335, w * 0.28, h * 0.06), PALETTE[1], "band", 10),
    image("primary_photo", box(x + w * 0.12, y + h * 0.52, w * 0.76, h * 0.34), "primary", "center"),
    shape("sun", box(x + w * 0.72, y + h * 0.77, w * 0.18, h * 0.08), PALETTE[4], "scrim", 999, 0.72),
    cta("cta", box(x + w * 0.36, y + h * 0.88, w * 0.28, h * 0.045), PALETTE[1], "#FFFFFF", 999, bodySize * 0.72),
  ];
}

function design(format: "4:5" | "9:16" | "1:1", layers: TemplateLayer[]): TemplateDesign { return { templateId: ID, version: 1, format, canvas: format === "9:16" ? { w: 1080, h: 1920 } : format === "1:1" ? { w: 1080, h: 1080 } : { w: 1080, h: 1350 }, palette: PALETTE, fonts: FONTS, layers }; }
function box(x: number, y: number, w: number, h: number) { return { x, y, w, h }; }
function shape(id: string, rect: ReturnType<typeof box>, fill: string, role: "background" | "panel" | "band" | "scrim", radius = 0, opacity?: number): TemplateLayer { return { id, type: "shape", rect, fill, role, radius, opacity, locked: true }; }
function image(id: string, rect: ReturnType<typeof box>, role: "primary", anchor: "center" | "top" | "bottom"): TemplateLayer { return { id, type: "image_slot", rect, role, fit: "cover", anchor, mask: "none", editorLabel: imageLabel(id, role), guidance: imageGuidance(role), required: true }; }
function logo(id: string, rect: ReturnType<typeof box>): TemplateLayer { return { id, type: "logo", rect, source: "brand_kit" }; }
function text(id: string, slot: "headline" | "body", rect: ReturnType<typeof box>, size: number, color: string, fill: "ai_copy", copy: string | undefined, maxChars: number, align: "center", font: string, weight: number, lineHeight: number): TemplateLayer {
  return { id, type: "text", slot, rect, align, font, size: Math.max(size, slot === "headline" ? 46 : 18), lineHeight, weight, color, fill, text: copy, maxChars, maxLines: maxLinesForSlot(slot), editorLabel: editorLabelForSlot(slot), copyField: copyFieldForSlot(slot, fill), guidance: guidanceForSlot(slot), case: "none" };
}
function cta(id: string, rect: ReturnType<typeof box>, fill: string, textColor: string, radius: number, size: number): TemplateLayer { return { id, type: "cta_button", rect, fill, radius, label: "cta", textColor, font: FONTS[0], size: Math.max(size, 18), maxChars: 24, maxLines: 1, editorLabel: "CTA", copyField: "cta", guidance: "Short button label that fits inside the CTA button." }; }
function maxLinesForSlot(slot: string): number {
  if (slot === "headline") return 2;
  if (slot === "body" || slot === "subhead") return 2;
  return 1;
}

function editorLabelForSlot(slot: string): string {
  if (slot === "headline") return "Hero headline";
  if (slot === "body" || slot === "subhead") return "Supporting copy";
  if (slot === "cta") return "CTA";
  if (slot === "eyebrow") return "Eyebrow";
  if (slot === "address") return "Location label";
  if (slot === "stat") return "Stat";
  if (slot === "phone") return "Phone";
  if (slot === "handle") return "Social handle";
  return "Template text";
}

function copyFieldForSlot(slot: string, fill: string): "headline" | "description" | "cta" | "static" | "brand" {
  if (fill === "brand") return "brand";
  if (fill === "static") return "static";
  if (slot === "headline") return "headline";
  if (slot === "body" || slot === "subhead") return "description";
  if (slot === "cta") return "cta";
  return "static";
}

function guidanceForSlot(slot: string): string {
  if (slot === "headline") return "Keep this short enough to stay inside the designed headline frame.";
  if (slot === "body" || slot === "subhead") return "Short supporting message for the visible creative.";
  if (slot === "cta") return "Short button label.";
  if (slot === "address") return "Short suburb or location label.";
  if (slot === "stat") return "Compact proof point or number.";
  return "Template-controlled text.";
}

function imageLabel(id: string, role: string): string {
  if (role === "primary") return "Hero image";
  if (role === "agent_headshot") return "Agent headshot";
  if (id.includes("top")) return "Upper inset image";
  if (id.includes("mid")) return "Middle inset image";
  if (id.includes("low") || id.includes("bottom")) return "Lower inset image";
  return "Supporting image";
}

function imageGuidance(role: string): string {
  if (role === "primary") return "Main property photo for the strongest visual position in this template.";
  if (role === "agent_headshot") return "Agent portrait used where this template shows a person.";
  return "Supporting property photo for this template position.";
}
