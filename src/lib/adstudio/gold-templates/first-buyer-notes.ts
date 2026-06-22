import type { TemplateDesign, TemplateDesignSet, TemplateLayer } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "gold_first_buyer_notes";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#F4F1ED", "#23201D", "#FFFFFF", "#A9A39C", "#7D6F63"];
const FONTS = ["Georgia, 'Times New Roman', serif", "Inter, Arial, sans-serif"];

export const firstBuyerNotesTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "First Buyer Notes",
  goal: "buyer_leads",
  offerId: "download_guide",
  imageBriefId: "IMG-REFERENCE-FIRST-BUYER-NOTES",
  promptHint: "Reference sample 10: first-time buyer notes card with top lifestyle image, huge serif headline, and checklist boxes.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Notes for first time home buyers",
    primaryText: "Prioritise needs, compare options, and move with a clearer plan.",
    description: "Checklist-style first-buyer guide based on the uploaded reference sample.",
    cta: "Get checklist",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "apartment_townhouse",
    priceFeel: "affordable_entry",
    visualStyle: "guide_or_report_mockup",
    people: "none",
    copyDensity: "full_sales_poster",
    tone: "practical_local",
    sampleSuburb: "Maylands",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Renee Ward",
    address: "Maylands buyer checklist",
    propertyDetail: "first buyer guide",
    resultDetail: "download checklist",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: firstBuyerNotesDesigns(),
  evidenceScore: 99,
  winnerRationale: "Standalone mini-project copied from reference sample 10: top lifestyle image, serif notes headline, and grid of action boxes.",
  complianceNote: "Editable first-buyer guide template with replaceable image, headline, checklist labels, and CTA.",
  exemplars: ["Reference sample 10 from the uploaded board."],
};

export const firstBuyerNotesSample = {
  photoFile: "au-character-cottage.jpg",
  text: {
    eyebrow: "BUYER NOTES",
    headline: "Notes for first time home buyers",
    body: "Prioritise needs, compare options, and move with a clearer plan.",
    cta: "Get checklist",
    address: "Maylands",
    stat: "3 steps",
  },
};

function firstBuyerNotesDesigns(): TemplateDesignSet {
  return {
    "4:5": design("4:5", layout(0.08, 0.05, 0.84, 0.9, 66, 21)),
    "9:16": design("9:16", layout(0.08, 0.08, 0.84, 0.78, 72, 24)),
    "1:1": design("1:1", layout(0.07, 0.05, 0.86, 0.86, 48, 18)),
  };
}

function layout(x: number, y: number, w: number, h: number, headlineSize: number, bodySize: number): TemplateLayer[] {
  const checklist = [
    ["need", "Prioritise needs", 0.08, 0.68],
    ["loan", "Confirm budget", 0.38, 0.68],
    ["area", "Choose suburbs", 0.68, 0.68],
    ["inspect", "Inspect twice", 0.08, 0.78],
    ["offer", "Make the offer", 0.38, 0.78],
    ["settle", "Plan settlement", 0.68, 0.78],
  ].flatMap(([id, label, rx, ry]) => [
    shape(`box_${id}`, box(x + w * Number(rx), y + h * Number(ry), w * 0.24, h * 0.055), "#FFFFFF", "panel", 0),
    text(`label_${id}`, "body", box(x + w * (Number(rx) + 0.015), y + h * (Number(ry) + 0.018), w * 0.21, h * 0.02), bodySize * 0.58, PALETTE[1], "static", String(label), 28, "center", FONTS[1], 720, 1),
  ]);
  return [
    shape("paper", box(x, y, w, h), PALETTE[0], "background", 20),
    image("primary_photo", box(x, y, w, h * 0.31), "primary", "center"),
    shape("caption", box(x + w * 0.5, y + h * 0.11, w * 0.28, h * 0.05), "#FFFFFF", "panel", 0),
    text("caption_text", "address", box(x + w * 0.53, y + h * 0.126, w * 0.22, h * 0.02), bodySize * 0.58, PALETTE[1], "static", "Home in any city", 24, "center", FONTS[1], 650, 1),
    text("eyebrow", "eyebrow", box(x + w * 0.18, y + h * 0.41, w * 0.22, h * 0.035), bodySize * 0.85, PALETTE[4], "static", "Notes", 14, "center", FONTS[0], 500, 1),
    text("headline", "headline", box(x + w * 0.18, y + h * 0.45, w * 0.64, h * 0.13), headlineSize, PALETTE[1], "ai_copy", undefined, 54, "center", FONTS[0], 500, 1.02),
    text("body", "body", box(x + w * 0.18, y + h * 0.6, w * 0.64, h * 0.045), bodySize, PALETTE[4], "ai_copy", undefined, 86, "center", FONTS[1], 520, 1.16),
    ...checklist,
    cta("cta", box(x + w * 0.36, y + h * 0.9, w * 0.28, h * 0.04), "#FFFFFF", PALETTE[1], 0, bodySize * 0.65),
  ];
}

function design(format: "4:5" | "9:16" | "1:1", layers: TemplateLayer[]): TemplateDesign { return { templateId: ID, version: 1, format, canvas: format === "9:16" ? { w: 1080, h: 1920 } : format === "1:1" ? { w: 1080, h: 1080 } : { w: 1080, h: 1350 }, palette: PALETTE, fonts: FONTS, layers }; }
function box(x: number, y: number, w: number, h: number) { return { x, y, w, h }; }
function shape(id: string, rect: ReturnType<typeof box>, fill: string, role: "background" | "panel" | "band" | "scrim", radius = 0): TemplateLayer { return { id, type: "shape", rect, fill, role, radius, locked: true }; }
function image(id: string, rect: ReturnType<typeof box>, role: "primary", anchor: "center" | "top" | "bottom"): TemplateLayer { return { id, type: "image_slot", rect, role, fit: "cover", anchor, mask: "none" }; }
function text(id: string, slot: "eyebrow" | "headline" | "body" | "address", rect: ReturnType<typeof box>, size: number, color: string, fill: "ai_copy" | "static", copy: string | undefined, maxChars: number, align: "left" | "center" | "right", font: string, weight: number, lineHeight: number): TemplateLayer {
  return { id, type: "text", slot, rect, align, font, size: Math.max(size, slot === "headline" ? 46 : 18), lineHeight, weight, color, fill, text: copy, maxChars, case: "none" };
}
function cta(id: string, rect: ReturnType<typeof box>, fill: string, textColor: string, radius: number, size: number): TemplateLayer { return { id, type: "cta_button", rect, fill, radius, label: "cta", textColor, font: FONTS[1], size: Math.max(size, 18) }; }
