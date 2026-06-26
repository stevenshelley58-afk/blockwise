import type { TemplateDesign, TemplateDesignSet, TemplateLayer } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "gold_home_buyer_tips";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#F7F5F0", "#2B2A27", "#D7BE66", "#FFFFFF", "#8D7A55"];
const FONTS = ["Georgia, 'Times New Roman', serif", "Inter, Arial, sans-serif"];

export const homeBuyerTipsTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Smart Tips For Buyers",
  goal: "buyer_leads",
  offerId: "buyer_list",
  imageBriefId: "IMG-REFERENCE-HOME-BUYER-TIPS",
  promptHint: "Reference sample 01: soft cream buyer tip card with one centered home photo, oversized editorial headline, gold sketch accent, and a small CTA.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Smart tips for home buyers",
    primaryText: "Avoid costly mistakes before you make your next move.",
    description: "Editorial buyer-guide ad based on the uploaded reference sample.",
    cta: "Learn more",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "new_build",
    priceFeel: "mid_market_family",
    visualStyle: "guide_or_report_mockup",
    people: "none",
    copyDensity: "headline_overlay",
    tone: "practical_local",
    sampleSuburb: "Bicton",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Nadia Cole",
    address: "12 Preston Road, Bicton",
    propertyDetail: "family buyer guide",
    resultDetail: "buyer education lead magnet",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: homeBuyerTipsDesigns(),
  evidenceScore: 99,
  winnerRationale: "Standalone mini-project copied from reference sample 01: square-ish cream card, house hero, gold accent geometry, and large buyer-guide headline.",
  complianceNote: "Editable buyer-guide layout. Property photo, headline, body, CTA, and brand remain replaceable.",
  exemplars: ["Reference sample 01 from the uploaded board."],
};

export const homeBuyerTipsSample = {
  photoFile: "au-modern-coastal.png",
  text: {
    eyebrow: "BUYER GUIDE",
    headline: "Smart tips for home buyers",
    body: "Avoid costly mistakes before you make your next move.",
    cta: "Learn more",
    address: "Bicton buyer guide",
    stat: "6 checks",
  },
};

function homeBuyerTipsDesigns(): TemplateDesignSet {
  return {
    "4:5": design("4:5", [
      shape("paper", box(0.05, 0.05, 0.9, 0.9), PALETTE[0], "background", 34),
      shape("gold_slab", box(0.15, 0.17, 0.5, 0.24), "#EAD78A", "panel", 28),
      image("primary_photo", box(0.24, 0.12, 0.58, 0.38), "primary", "center"),
      shape("photo_edge", box(0.24, 0.12, 0.58, 0.38), "none", "scrim", 0, 1),
      logo("brand", box(0.1, 0.1, 0.23, 0.035)),
      text("headline", "headline", box(0.11, 0.56, 0.62, 0.22), 78, PALETTE[1], "ai_copy", undefined, 70, "left", FONTS[1], 850, 0.98),
      shape("gold_ring", box(0.49, 0.635, 0.18, 0.03), "none", "band", 999, 1),
      text("body", "body", box(0.12, 0.79, 0.48, 0.07), 26, "#5D5850", "ai_copy", undefined, 90, "left", FONTS[1], 650, 1.18),
      cta("cta", box(0.72, 0.82, 0.17, 0.055), "#FFFFFF", PALETTE[1], 999, 21),
      text("handle", "handle", box(0.79, 0.105, 0.08, 0.03), 20, "#B38A29", "static", "...", 6, "right", FONTS[1], 800, 1),
    ]),
    "9:16": design("9:16", [
      shape("paper", box(0.06, 0.08, 0.88, 0.78), PALETTE[0], "background", 34),
      shape("gold_slab", box(0.13, 0.18, 0.54, 0.2), "#EAD78A", "panel", 28),
      image("primary_photo", box(0.22, 0.13, 0.62, 0.32), "primary", "center"),
      logo("brand", box(0.1, 0.1, 0.24, 0.03)),
      text("headline", "headline", box(0.12, 0.5, 0.66, 0.16), 78, PALETTE[1], "ai_copy", undefined, 70, "left", FONTS[1], 850, 0.98),
      text("body", "body", box(0.12, 0.68, 0.52, 0.07), 28, "#5D5850", "ai_copy", undefined, 90, "left", FONTS[1], 650, 1.18),
      cta("cta", box(0.12, 0.78, 0.28, 0.045), "#FFFFFF", PALETTE[1], 999, 22),
    ]),
    "1:1": design("1:1", [
      shape("paper", box(0.05, 0.05, 0.9, 0.9), PALETTE[0], "background", 34),
      shape("gold_slab", box(0.14, 0.19, 0.5, 0.24), "#EAD78A", "panel", 28),
      image("primary_photo", box(0.24, 0.13, 0.58, 0.36), "primary", "center"),
      logo("brand", box(0.1, 0.1, 0.24, 0.035)),
      text("headline", "headline", box(0.11, 0.58, 0.68, 0.22), 62, PALETTE[1], "ai_copy", undefined, 70, "left", FONTS[1], 850, 0.98),
      text("body", "body", box(0.12, 0.81, 0.5, 0.07), 24, "#5D5850", "ai_copy", undefined, 90, "left", FONTS[1], 650, 1.18),
      cta("cta", box(0.72, 0.82, 0.17, 0.055), "#FFFFFF", PALETTE[1], 999, 18),
    ]),
  };
}

function design(format: "4:5" | "9:16" | "1:1", layers: TemplateLayer[]): TemplateDesign {
  const canvas = format === "9:16" ? { w: 1080, h: 1920 } : format === "1:1" ? { w: 1080, h: 1080 } : { w: 1080, h: 1350 };
  return { templateId: ID, version: 1, format, canvas, palette: PALETTE, fonts: FONTS, layers };
}
function box(x: number, y: number, w: number, h: number) { return { x, y, w, h }; }
function shape(id: string, rect: ReturnType<typeof box>, fill: string, role: "background" | "panel" | "band" | "scrim", radius = 0, opacity?: number): TemplateLayer {
  return { id, type: "shape", rect, fill, role, radius, opacity, locked: true };
}
function image(id: string, rect: ReturnType<typeof box>, role: "primary" | "secondary" | "agent_headshot", anchor: "center" | "top" | "bottom" | "left" | "right" | "top_left" | "top_right" | "bottom_left" | "bottom_right"): TemplateLayer {
  return { id, type: "image_slot", rect, role, fit: "cover", anchor, mask: "none", editorLabel: imageLabel(id, role), guidance: imageGuidance(role), required: true };
}
function logo(id: string, rect: ReturnType<typeof box>): TemplateLayer { return { id, type: "logo", rect, source: "brand_kit" }; }
function text(id: string, slot: "eyebrow" | "headline" | "body" | "cta" | "address" | "stat" | "handle", rect: ReturnType<typeof box>, size: number, color: string, fill: "ai_copy" | "brand" | "static", copy: string | undefined, maxChars: number, align: "left" | "center" | "right", font: string, weight: number, lineHeight: number): TemplateLayer {
  return { id, type: "text", slot, rect, align, font, size: Math.max(size, slot === "headline" ? 46 : 18), lineHeight, weight, color, fill, text: copy, maxChars, maxLines: maxLinesForSlot(slot), editorLabel: editorLabelForSlot(slot), copyField: copyFieldForSlot(slot, fill), guidance: guidanceForSlot(slot), case: slot === "eyebrow" ? "upper" : "none" };
}
function cta(id: string, rect: ReturnType<typeof box>, fill: string, textColor: string, radius: number, size: number): TemplateLayer {
  return { id, type: "cta_button", rect, fill, radius, label: "cta", textColor, font: FONTS[1], size: Math.max(size, 18), maxChars: 24, maxLines: 1, editorLabel: "CTA", copyField: "cta", guidance: "Short button label that fits inside the CTA button." };
}
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
