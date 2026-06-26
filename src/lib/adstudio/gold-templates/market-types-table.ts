import type { TemplateDesign, TemplateDesignSet, TemplateLayer } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "gold_market_types_table";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#F2F3F1", "#242A2D", "#2D6E68", "#A66D5D", "#FFFFFF"];
const FONTS = ["Inter, Arial, sans-serif", "Georgia, 'Times New Roman', serif"];

export const marketTypesTableTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Market Types Table",
  goal: "market_update_leads",
  offerId: "market_report",
  imageBriefId: "IMG-REFERENCE-MARKET-TYPES-TABLE",
  promptHint: "Reference sample 03: text-led market comparison table with buyer/seller headers, horizontal rows, and almost no property imagery.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Real estate market types",
    primaryText: "Know the difference before you act.",
    description: "Comparison-table market update ad based on the uploaded reference sample.",
    cta: "Get update",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "apartment_townhouse",
    priceFeel: "mid_market_family",
    visualStyle: "data_card",
    people: "none",
    copyDensity: "stat_heavy",
    tone: "practical_local",
    sampleSuburb: "Fremantle",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Priya Nair",
    address: "Fremantle market update",
    propertyDetail: "market comparison",
    resultDetail: "monthly buyer seller report",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: marketTypesTableDesigns(),
  evidenceScore: 99,
  winnerRationale: "Standalone mini-project copied from reference sample 03: comparison-table creative instead of another property-photo card.",
  complianceNote: "Editable market education template. Headline, rows, CTA, and brand are replaceable.",
  exemplars: ["Reference sample 03 from the uploaded board."],
};

export const marketTypesTableSample = {
  photoFile: "au-riverside-townhouse.jpg",
  text: {
    eyebrow: "MARKET UPDATE",
    headline: "Real estate market types",
    body: "Know the difference before you act.",
    cta: "Get update",
    address: "Fremantle",
    stat: "Buyer vs seller",
  },
};

function marketTypesTableDesigns(): TemplateDesignSet {
  return {
    "4:5": design("4:5", layers(0.08, 0.08, 0.84, 0.78, 58, 24)),
    "9:16": design("9:16", layers(0.07, 0.12, 0.86, 0.66, 62, 26)),
    "1:1": design("1:1", layers(0.07, 0.07, 0.86, 0.82, 48, 20)),
  };
}

function layers(x: number, y: number, w: number, h: number, headlineSize: number, bodySize: number): TemplateLayer[] {
  const rows = [
    ["More homes available", "Fewer homes for sale"],
    ["Prices stay low", "Prices climb fast"],
    ["Buyers have power", "Sellers call the shots"],
    ["Slow sales pace", "Quick sales happen"],
    ["Discounts are common", "Bidding wars break out"],
    ["Longer time on market", "Homes sell in days"],
  ];
  const rowLayers: TemplateLayer[] = [];
  rows.forEach((row, index) => {
    const ry = y + h * (0.32 + index * 0.085);
    rowLayers.push(shape(`line_${index}`, box(x + w * 0.08, ry + h * 0.06, w * 0.84, 0.002), "#C9CECC", "band"));
    rowLayers.push(text(`buyer_${index}`, "body", box(x + w * 0.1, ry, w * 0.32, h * 0.045), bodySize * 0.58, PALETTE[1], "static", row[0], 46, "left", FONTS[0], 550, 1.1));
    rowLayers.push(text(`seller_${index}`, "body", box(x + w * 0.58, ry, w * 0.32, h * 0.045), bodySize * 0.58, PALETTE[1], "static", row[1], 46, "left", FONTS[0], 550, 1.1));
  });
  return [
    shape("card", box(x, y, w, h), PALETTE[0], "background", 26),
    text("headline", "headline", box(x + w * 0.16, y + h * 0.09, w * 0.68, h * 0.09), headlineSize, "#111111", "ai_copy", undefined, 56, "center", FONTS[0], 760, 1.05),
    text("subhead", "body", box(x + w * 0.18, y + h * 0.19, w * 0.64, h * 0.04), bodySize, "#33383A", "ai_copy", undefined, 70, "center", FONTS[0], 500, 1.1),
    shape("buyer_tab", box(x + w * 0.1, y + h * 0.28, w * 0.33, h * 0.06), PALETTE[2], "band", 0),
    shape("seller_tab", box(x + w * 0.57, y + h * 0.28, w * 0.33, h * 0.06), PALETTE[3], "band", 0),
    text("buyer_label", "eyebrow", box(x + w * 0.13, y + h * 0.297, w * 0.25, h * 0.025), bodySize * 0.72, "#FFFFFF", "static", "Buyer market", 20, "center", FONTS[0], 800, 1),
    text("seller_label", "eyebrow", box(x + w * 0.61, y + h * 0.297, w * 0.25, h * 0.025), bodySize * 0.72, "#FFFFFF", "static", "Seller market", 20, "center", FONTS[0], 800, 1),
    text("versus", "stat", box(x + w * 0.45, y + h * 0.285, w * 0.1, h * 0.04), bodySize * 1.08, PALETTE[1], "static", "VS", 4, "center", FONTS[0], 900, 1),
    ...rowLayers,
    cta("cta", box(x + w * 0.35, y + h * 0.86, w * 0.3, h * 0.055), PALETTE[1], "#FFFFFF", 999, bodySize * 0.72),
  ];
}

function design(format: "4:5" | "9:16" | "1:1", layers: TemplateLayer[]): TemplateDesign {
  return { templateId: ID, version: 1, format, canvas: format === "9:16" ? { w: 1080, h: 1920 } : format === "1:1" ? { w: 1080, h: 1080 } : { w: 1080, h: 1350 }, palette: PALETTE, fonts: FONTS, layers };
}
function box(x: number, y: number, w: number, h: number) { return { x, y, w, h }; }
function shape(id: string, rect: ReturnType<typeof box>, fill: string, role: "background" | "panel" | "band" | "scrim", radius = 0): TemplateLayer { return { id, type: "shape", rect, fill, role, radius, locked: true }; }
function text(id: string, slot: "eyebrow" | "headline" | "body" | "stat", rect: ReturnType<typeof box>, size: number, color: string, fill: "ai_copy" | "brand" | "static", copy: string | undefined, maxChars: number, align: "left" | "center" | "right", font: string, weight: number, lineHeight: number): TemplateLayer {
  return { id, type: "text", slot, rect, align, font, size: Math.max(size, slot === "headline" ? 46 : 18), lineHeight, weight, color, fill, text: copy, maxChars, maxLines: maxLinesForSlot(slot), editorLabel: editorLabelForSlot(slot), copyField: copyFieldForSlot(slot, fill), guidance: guidanceForSlot(slot), case: slot === "eyebrow" ? "upper" : "none" };
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
