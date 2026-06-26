import type { TemplateDesign, TemplateDesignSet, TemplateLayer } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "meta_051";
const VERSION = "gold-local-50-v1";
const PALETTE = [
  "#2A261D",
  "#FFFFFF",
  "#C99B55",
  "#F6EDDE",
  "#4B4233",
  "#15130F"
];
const FONTS = [
  "Georgia, 'Times New Roman', serif",
  "Inter, Arial, sans-serif"
];
const EYEBROW = "Story Listing Launch";
const SAMPLE_STAT = "3 local signals";
const SAMPLE_ADDRESS = "61 Preston Point Road, Applecross";

export const meta051Template: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Story 051 - Story Listing Launch",
  goal: "seller_leads",
  offerId: "listing_inquiries",
  imageBriefId: "IMG-STORY-LISTING",
  promptHint: "Story 051 - Story Listing Launch: local standalone full-screen story-led real estate ad template with editable copy, property photo slots, brand logo, and CTA.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "New opportunity in Applecross",
    primaryText: "A vertical listing reveal with strong photo focus and simple enquiry copy.",
    description: "listing launch",
    cta: "Enquire now",
  },
  sampleStyle: {
  version: "template-samples-v1",
  propertyAge: "older_affordable",
  priceFeel: "premium_coastal",
  visualStyle: "organic_agent_post",
  people: "none",
  copyDensity: "small_badge",
  tone: "practical_local",
  sampleSuburb: "Applecross",
  sampleState: "WA",
  agencyName: "Northbank Realty",
  agentName: "Zara Hughes",
  address: "61 Preston Point Road, Applecross",
  propertyDetail: "listing launch",
  resultDetail: "New listing",
  sampleCardImagePath: "adstudio-samples/gold/meta_051.png"
},
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: meta051Designs(),
  evidenceScore: 93,
  winnerRationale: "Standalone local TypeScript module for story-first Meta creative. Built without provider calls and tuned for 9:16 placement polish.",
  complianceNote: "Editable real estate ad template with replaceable copy, property imagery, brand logo, and CTA. No claims of guaranteed sale outcomes.",
  exemplars: ["meta_ad_candidates/local/meta_051.png"],
};

export const meta051Sample = {
  photoFile: "au-family-rendered.png",
  photoFiles: {
    secondary_photo: "au-riverside-townhouse.jpg",
    agent_headshot: "au-family-rendered.png"
  },
  text: {
    eyebrow: "Story Listing Launch",
    headline: "New opportunity in Applecross",
    body: "A vertical listing reveal with strong photo focus and simple enquiry copy.",
    cta: "Enquire now",
    address: "61 Preston Point Road, Applecross",
    stat: "3 local signals",
    handle: "@blockwiserealty",
    phone: "08 6111 2400"
  }
};

function meta051Designs(): TemplateDesignSet {
  return {
    "4:5": design("4:5", feedLayers("4:5")),
    "9:16": design("9:16", storyLayers()),
    "1:1": design("1:1", feedLayers("1:1")),
  };
}

function storyLayers(): TemplateLayer[] {
  return [
    shape("background", box(0, 0, 1, 1), PALETTE[1], "background"),
    shape("top_panel", box(0.06, 0.055, 0.88, 0.27), PALETTE[3], "panel", 34),
    logo("brand", box(0.11, 0.095, 0.28, 0.032)),
    text("headline", "headline", box(0.11, 0.155, 0.68, 0.105), 62, PALETTE[5], "ai_copy", undefined, 62, "left", FONTS[0], 900, 0.98),
    image("primary_photo", box(0.06, 0.35, 0.88, 0.48), "primary", "center"),
    shape("bottom_bar", box(0.06, 0.855, 0.88, 0.09), PALETTE[3], "panel", 26),
    text("body", "body", box(0.11, 0.882, 0.5, 0.04), 22, PALETTE[5], "ai_copy", undefined, 96, "left", FONTS[1], 620, 1.12),
    cta("cta", box(0.66, 0.878, 0.23, 0.044), PALETTE[5], PALETTE[1], 999, 18),
  ];
}

function feedLayers(format: "4:5" | "1:1"): TemplateLayer[] {
  const square = format === "1:1";
  return [
    shape("background", box(0, 0, 1, 1), PALETTE[3], "background"),
    image("primary_photo", box(0.07, 0.06, 0.86, square ? 0.5 : 0.54), "primary", "center"),
    shape("copy_panel", box(0.1, square ? 0.62 : 0.66, 0.8, square ? 0.29 : 0.24), PALETTE[1], "panel", 30),
    logo("brand", box(0.14, square ? 0.655 : 0.695, 0.28, 0.035)),
    text("headline", "headline", box(0.14, square ? 0.71 : 0.745, 0.62, square ? 0.095 : 0.08), square ? 47 : 54, PALETTE[5], "ai_copy", undefined, 60, "left", FONTS[0], 900, 0.98),
    text("body", "body", box(0.14, square ? 0.815 : 0.835, 0.5, 0.045), square ? 19 : 21, PALETTE[5], "ai_copy", undefined, 96, "left", FONTS[1], 620, 1.12),
    cta("cta", box(0.65, square ? 0.82 : 0.835, 0.21, square ? 0.052 : 0.048), PALETTE[2], PALETTE[5], 999, 18),
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
