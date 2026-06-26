import type { TemplateDesign, TemplateDesignSet, TemplateLayer } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "gold_elevated_living_editorial";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#F6EFE5", "#6C3B25", "#1F211E", "#FFFFFF", "#B47B52"];
const FONTS = ["Georgia, 'Times New Roman', serif", "Inter, Arial, sans-serif"];

export const elevatedLivingEditorialTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Elevated Living Editorial",
  goal: "seller_leads",
  offerId: "recent_sales_report",
  imageBriefId: "IMG-REFERENCE-ELEVATED-LIVING",
  promptHint: "Reference sample 07: cream editorial living card with a cropped arched interior image, copper footer, and restrained serif type.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Elevated living",
    primaryText: "Designed spaces with comfort and calm.",
    description: "Soft editorial living template based on the uploaded reference sample.",
    cta: "See home",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "renovated_character",
    priceFeel: "premium_coastal",
    visualStyle: "property_photo_first",
    people: "none",
    copyDensity: "minimal_no_overlay",
    tone: "quiet_editorial",
    sampleSuburb: "Subiaco",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Anika Bell",
    address: "22 Olive Street, Subiaco",
    propertyDetail: "elevated living spaces",
    resultDetail: "premium listing story",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: elevatedLivingEditorialDesigns(),
  evidenceScore: 99,
  winnerRationale: "Standalone mini-project copied from reference sample 07: vertical editorial crop, cream whitespace, copper contact band, and elegant serif headline.",
  complianceNote: "Editable editorial listing template with replaceable media, address, and CTA.",
  exemplars: ["Reference sample 07 from the uploaded board."],
};

export const elevatedLivingEditorialSample = {
  photoFile: "au-limestone-coastal.png",
  text: {
    eyebrow: "ELEVATED",
    headline: "Elevated living",
    body: "Designed spaces with comfort and calm.",
    cta: "See home",
    address: "22 Olive Street, Subiaco",
    stat: "Living room",
  },
};

function elevatedLivingEditorialDesigns(): TemplateDesignSet {
  return {
    "4:5": design("4:5", layout(0.08, 0.05, 0.84, 0.9, 74, 25)),
    "9:16": design("9:16", layout(0.08, 0.08, 0.84, 0.78, 82, 28)),
    "1:1": design("1:1", layout(0.07, 0.05, 0.86, 0.86, 54, 20)),
  };
}

function layout(x: number, y: number, w: number, h: number, headlineSize: number, bodySize: number): TemplateLayer[] {
  return [
    shape("paper", box(x, y, w, h), PALETTE[0], "background", 22),
    text("eyebrow", "eyebrow", box(x + w * 0.09, y + h * 0.07, w * 0.32, h * 0.03), bodySize * 0.72, PALETTE[2], "static", "ELEVATED", 16, "left", FONTS[1], 800, 1),
    text("headline", "headline", box(x + w * 0.09, y + h * 0.12, w * 0.48, h * 0.11), headlineSize, PALETTE[1], "ai_copy", undefined, 34, "left", FONTS[0], 500, 0.98),
    image("primary_photo", box(x + w * 0.38, y + h * 0.2, w * 0.45, h * 0.48), "primary", "center"),
    shape("photo_rule", box(x + w * 0.36, y + h * 0.2, w * 0.02, h * 0.48), PALETTE[0], "band", 0),
    text("body", "body", box(x + w * 0.09, y + h * 0.7, w * 0.44, h * 0.07), bodySize, PALETTE[2], "ai_copy", undefined, 70, "left", FONTS[1], 500, 1.2),
    shape("footer", box(x, y + h * 0.86, w, h * 0.08), PALETTE[1], "band", 0),
    text("address", "address", box(x + w * 0.08, y + h * 0.885, w * 0.44, h * 0.025), bodySize * 0.62, "#FFFFFF", "static", "22 Olive Street, Subiaco", 46, "left", FONTS[1], 650, 1),
    cta("cta", box(x + w * 0.64, y + h * 0.875, w * 0.22, h * 0.04), "#FFFFFF", PALETTE[1], 999, bodySize * 0.68),
  ];
}

function design(format: "4:5" | "9:16" | "1:1", layers: TemplateLayer[]): TemplateDesign { return { templateId: ID, version: 1, format, canvas: format === "9:16" ? { w: 1080, h: 1920 } : format === "1:1" ? { w: 1080, h: 1080 } : { w: 1080, h: 1350 }, palette: PALETTE, fonts: FONTS, layers }; }
function box(x: number, y: number, w: number, h: number) { return { x, y, w, h }; }
function shape(id: string, rect: ReturnType<typeof box>, fill: string, role: "background" | "panel" | "band" | "scrim", radius = 0): TemplateLayer { return { id, type: "shape", rect, fill, role, radius, locked: true }; }
function image(id: string, rect: ReturnType<typeof box>, role: "primary", anchor: "center" | "top" | "bottom"): TemplateLayer { return { id, type: "image_slot", rect, role, fit: "cover", anchor, mask: "shape", editorLabel: imageLabel(id, role), guidance: imageGuidance(role), required: true }; }
function text(id: string, slot: "eyebrow" | "headline" | "body" | "address", rect: ReturnType<typeof box>, size: number, color: string, fill: "ai_copy" | "static", copy: string | undefined, maxChars: number, align: "left" | "center" | "right", font: string, weight: number, lineHeight: number): TemplateLayer {
  return { id, type: "text", slot, rect, align, font, size: Math.max(size, slot === "headline" ? 46 : 18), lineHeight, weight, color, fill, text: copy, maxChars, maxLines: maxLinesForSlot(slot), editorLabel: editorLabelForSlot(slot), copyField: copyFieldForSlot(slot, fill), guidance: guidanceForSlot(slot), case: slot === "eyebrow" ? "upper" : "none" };
}
function cta(id: string, rect: ReturnType<typeof box>, fill: string, textColor: string, radius: number, size: number): TemplateLayer { return { id, type: "cta_button", rect, fill, radius, label: "cta", textColor, font: FONTS[1], size: Math.max(size, 18), maxChars: 24, maxLines: 1, editorLabel: "CTA", copyField: "cta", guidance: "Short button label that fits inside the CTA button." }; }
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
