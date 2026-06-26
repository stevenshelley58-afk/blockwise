import type { TemplateDesign, TemplateDesignSet, TemplateLayer } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "meta_003";
const VERSION = "gold-local-50-v1";
const PALETTE = [
  "#F4F7F2",
  "#12362F",
  "#D6A84F",
  "#FFFFFF",
  "#253D35",
  "#DDE8E1"
];
const FONTS = [
  "Georgia, 'Times New Roman', serif",
  "Inter, Arial, sans-serif"
];
const EYEBROW = "Seller Prep List";
const SAMPLE_STAT = "15 min read";
const SAMPLE_ADDRESS = "13 Preston Point Road, Fremantle";

export const meta003Template: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Feed 003 - Seller Prep List",
  goal: "seller_leads",
  offerId: "seller_prep_checklist",
  imageBriefId: "IMG-SELLER-CHECKLIST",
  promptHint: "Feed 003 - Seller Prep List: local standalone feed-led real estate ad template with editable copy, property photo slots, brand logo, and CTA.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Before you list in Fremantle",
    primaryText: "Use a practical checklist before timing, styling, or pricing your property.",
    description: "seller preparation",
    cta: "Get checklist",
  },
  sampleStyle: {
  version: "template-samples-v1",
  propertyAge: "luxury_architectural",
  priceFeel: "affordable_entry",
  visualStyle: "data_card",
  people: "none",
  copyDensity: "small_badge",
  tone: "soft_organic",
  sampleSuburb: "Fremantle",
  sampleState: "WA",
  agencyName: "Northbank Realty",
  agentName: "Mia Hart",
  address: "13 Preston Point Road, Fremantle",
  propertyDetail: "seller preparation",
  resultDetail: "Owner checklist",
  sampleCardImagePath: "adstudio-samples/gold/meta_003.png"
},
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: meta003Designs(),
  evidenceScore: 93,
  winnerRationale: "Standalone local TypeScript module for feed-first Meta creative. Built without provider calls and tuned for 4:5 plus 1:1 placement polish.",
  complianceNote: "Editable real estate ad template with replaceable copy, property imagery, brand logo, and CTA. No claims of guaranteed sale outcomes.",
  exemplars: ["meta_ad_candidates/local/meta_003.png"],
};

export const meta003Sample = {
  photoFile: "au-federation-bungalow.png",
  photoFiles: {
    secondary_photo: "au-family-rendered.png",
    agent_headshot: "au-federation-bungalow.png"
  },
  text: {
    eyebrow: "Seller Prep List",
    headline: "Before you list in Fremantle",
    body: "Use a practical checklist before timing, styling, or pricing your property.",
    cta: "Get checklist",
    address: "13 Preston Point Road, Fremantle",
    stat: "15 min read",
    handle: "@blockwiserealty",
    phone: "08 6111 2400"
  }
};

function meta003Designs(): TemplateDesignSet {
  return {
    "4:5": design("4:5", feedLayers("4:5")),
    "9:16": design("9:16", storyLayers()),
    "1:1": design("1:1", feedLayers("1:1")),
  };
}

function feedLayers(format: "4:5" | "1:1"): TemplateLayer[] {
  const square = format === "1:1";
  const imageHeight = square ? 0.58 : 0.62;
  return [
    shape("background", box(0, 0, 1, 1), PALETTE[3], "background"),
    image("primary_photo", box(0, 0, 1, imageHeight), "primary", "center"),
    shape("photo_scrim", box(0, 0, 1, imageHeight), PALETTE[5], "scrim", 0, 0.16),
    shape("copy_panel", box(0.055, square ? 0.49 : 0.535, 0.89, square ? 0.43 : 0.405), PALETTE[0], "panel", 34),
    shape("accent_bar", box(0.105, square ? 0.535 : 0.585, 0.035, square ? 0.235 : 0.22), PALETTE[2], "band", 999),
    logo("brand", box(0.16, square ? 0.54 : 0.585, 0.28, 0.04)),
    text("headline", "headline", box(0.16, square ? 0.6 : 0.645, 0.68, square ? 0.14 : 0.13), square ? 58 : 68, PALETTE[1], "ai_copy", undefined, 64, "left", FONTS[0], 900, 0.98),
    text("body", "body", box(0.16, square ? 0.755 : 0.785, 0.6, 0.07), square ? 23 : 26, PALETTE[4], "ai_copy", undefined, 118, "left", FONTS[1], 620, 1.17),
    text("address", "address", box(0.16, square ? 0.84 : 0.865, 0.37, 0.036), square ? 18 : 20, PALETTE[4], "static", SAMPLE_ADDRESS, 42, "left", FONTS[1], 700, 1),
    cta("cta", box(0.63, square ? 0.83 : 0.858, 0.24, square ? 0.068 : 0.058), PALETTE[1], PALETTE[3], 999, square ? 19 : 21),
  ];
}

function storyLayers(): TemplateLayer[] {
  return [
    shape("background", box(0, 0, 1, 1), PALETTE[0], "background"),
    image("primary_photo", box(0.06, 0.06, 0.88, 0.45), "primary", "center"),
    shape("story_panel", box(0.08, 0.54, 0.84, 0.33), PALETTE[3], "panel", 34),
    logo("brand", box(0.13, 0.58, 0.28, 0.03)),
    text("eyebrow", "eyebrow", box(0.13, 0.63, 0.52, 0.032), 20, PALETTE[2], "static", EYEBROW, 34, "left", FONTS[1], 800, 1),
    text("headline", "headline", box(0.13, 0.675, 0.68, 0.105), 58, PALETTE[1], "ai_copy", undefined, 64, "left", FONTS[0], 900, 0.98),
    text("body", "body", box(0.13, 0.795, 0.58, 0.052), 24, PALETTE[4], "ai_copy", undefined, 112, "left", FONTS[1], 620, 1.16),
    cta("cta", box(0.13, 0.89, 0.32, 0.047), PALETTE[1], PALETTE[3], 999, 21),
  ];
}

function design(format: "4:5" | "9:16" | "1:1", layers: TemplateLayer[]): TemplateDesign {
  const canvas = format === "9:16" ? { w: 1080, h: 1920 } : format === "1:1" ? { w: 1080, h: 1080 } : { w: 1080, h: 1350 };
  return { templateId: ID, version: 1, format, canvas, palette: PALETTE, fonts: FONTS, layers };
}

function box(x: number, y: number, w: number, h: number) {
  return { x, y, w, h };
}

function shape(id: string, rect: ReturnType<typeof box>, fill: string, role: "background" | "panel" | "band" | "scrim", radius = 0, opacity?: number): TemplateLayer {
  return { id, type: "shape", rect, fill, role, radius, opacity, locked: true };
}

function image(id: string, rect: ReturnType<typeof box>, role: "primary" | "secondary" | "agent_headshot", anchor: "center" | "top" | "bottom" | "left" | "right" | "top_left" | "top_right" | "bottom_left" | "bottom_right"): TemplateLayer {
  return {
    id,
    type: "image_slot",
    rect,
    role,
    fit: "cover",
    anchor,
    mask: role === "agent_headshot" ? "circle" : "none",
    editorLabel: imageLabel(id, role),
    guidance: imageGuidance(role),
    required: true,
  };
}

function logo(id: string, rect: ReturnType<typeof box>): TemplateLayer {
  return { id, type: "logo", rect, source: "brand_kit" };
}

function text(
  id: string,
  slot: "eyebrow" | "headline" | "subhead" | "body" | "cta" | "price" | "address" | "stat" | "handle" | "phone",
  rect: ReturnType<typeof box>,
  size: number,
  color: string,
  fill: "ai_copy" | "brand" | "static",
  copy: string | undefined,
  maxChars: number,
  align: "left" | "center" | "right",
  font: string,
  weight: number,
  lineHeight: number,
): TemplateLayer {
  return {
    id,
    type: "text",
    slot,
    rect,
    align,
    font,
    size: Math.max(size, slot === "headline" ? 46 : 18),
    lineHeight,
    weight,
    color,
    fill,
    text: copy,
    maxChars,
    maxLines: maxLinesForSlot(slot),
    editorLabel: editorLabelForSlot(slot),
    copyField: copyFieldForSlot(slot, fill),
    guidance: guidanceForSlot(slot),
    case: slot === "eyebrow" ? "upper" : "none",
  };
}

function cta(id: string, rect: ReturnType<typeof box>, fill: string, textColor: string, radius: number, size: number): TemplateLayer {
  return {
    id,
    type: "cta_button",
    rect,
    fill,
    radius,
    label: "cta",
    textColor,
    font: FONTS[1],
    size: Math.max(size, 18),
    maxChars: 24,
    maxLines: 1,
    editorLabel: "CTA",
    copyField: "cta",
    guidance: "Use a short action label that fits inside the button.",
  };
}

function maxLinesForSlot(slot: string): number {
  if (slot === "headline") return 2;
  if (slot === "body" || slot === "subhead") return 2;
  return 1;
}

function editorLabelForSlot(slot: string): string {
  if (slot === "eyebrow") return "Eyebrow";
  if (slot === "headline") return "Hero headline";
  if (slot === "body" || slot === "subhead") return "Supporting copy";
  if (slot === "cta") return "CTA";
  if (slot === "address") return "Location label";
  if (slot === "stat") return "Proof point";
  if (slot === "phone") return "Phone";
  if (slot === "handle") return "Social handle";
  if (slot === "price") return "Price label";
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
  if (slot === "headline") return "Keep this short and specific to the suburb or property moment.";
  if (slot === "body" || slot === "subhead") return "One concise supporting sentence for the visible creative.";
  if (slot === "cta") return "Short button label.";
  if (slot === "address") return "Short suburb, street, or local area label.";
  if (slot === "stat") return "Compact proof point or useful local signal.";
  return "Template-controlled label.";
}

function imageLabel(id: string, role: string): string {
  if (role === "primary") return "Primary property image";
  if (role === "agent_headshot") return "Agent headshot";
  if (id.includes("secondary")) return "Secondary property image";
  return "Supporting property image";
}

function imageGuidance(role: string): string {
  if (role === "primary") return "Use the strongest property image for this template frame.";
  if (role === "agent_headshot") return "Use a professional agent portrait with clear eye contact.";
  return "Use a supporting property detail or alternate angle.";
}
