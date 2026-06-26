import type { TemplateDesign, TemplateDesignSet, TemplateLayer, TemplateRect, TextFill, TextSlot } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "meta_044";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#FFFFFF", "#0B1720", "#E7B24B", "#1B1C1C", "#CDCCC8", "#252626"];
const FONTS = ["Georgia, 'Times New Roman', serif", "Inter, Arial, sans-serif"];

export const meta044Template: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Feed 044 - Open House Detail Card",
  goal: "open_home_followup",
  offerId: "open_home_followup",
  imageBriefId: "IMG-OPEN-HOME",
  promptHint:
    "Rebuild the source open-home ad with date/time, property photo, address strip, and inspection CTA as editable layers. Source image: 01_feed_4x5_best/meta_044.png; original extraction: portrait_4x5/template_044.png.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Open house this Saturday",
    primaryText: "Inspect the property, see the key spaces, and plan your follow-up questions.",
    description: "Open-home details with a clear CTA.",
    cta: "Plan your visit",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "older_affordable",
    priceFeel: "mid_market_family",
    visualStyle: "property_photo_first",
    people: "buyer_activity",
    copyDensity: "minimal_no_overlay",
    tone: "quiet_editorial",
    sampleSuburb: "Joondalup",
    sampleState: "WA",
    agencyName: "Jarrah Property",
    agentName: "Grace Okafor",
    address: "54 Joondalup Road, Joondalup",
    propertyDetail: "modern family home",
    resultDetail: "local context sample",
    sampleCardImagePath: "adstudio-samples/gold/meta_044.png",
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: meta044Designs(),
  evidenceScore: 80,
  winnerRationale:
    "Direct rebuild of the extracted open-house detail card: strong property hero, date/time stack, white detail panel, supporting interior photo, address strip, and inspection CTA.",
  complianceNote:
    "Editable open-home invitation. Replace property imagery, address, inspection time, feature copy, and CTA with accurate listing details before publishing.",
  exemplars: ["01_feed_4x5_best/meta_044.png", "portrait_4x5/template_044.png"],
};

export const meta044Sample = {
  photoFile: "au-family-rendered.png",
  photoFiles: {
    primary_photo: "au-family-rendered.png",
    detail_photo: "au-character-cottage.jpg",
  },
  text: {
    eyebrow: "REAL ESTATE",
    headline: "OPEN HOUSE",
    subhead: "SATURDAY 20 OCTOBER",
    stat: "Start at 09 AM - 8 PM",
    body: "Spacious layouts. Outdoor spaces. Gourmet kitchen.",
    address: "54 Joondalup Road, Joondalup",
    cta: "Plan your visit",
  },
};

function meta044Designs(): TemplateDesignSet {
  return {
    "4:5": design("4:5", [
      shape("canvas", b(0, 0, 1, 1), PALETTE[0], "background"),
      image("primary_photo", b(0.02, 0.02, 0.96, 0.5), "primary", "center"),
      shape("hero_scrim", b(0.02, 0.28, 0.96, 0.24), "#000000", "scrim", 0, 0.46),
      text("eyebrow", "eyebrow", b(0.1, 0.31, 0.34, 0.06), 46, PALETTE[0], "static", "REAL ESTATE", 22, "left", FONTS[0], 500, 0.95),
      text("subhead", "subhead", b(0.59, 0.315, 0.31, 0.035), 20, PALETTE[0], "ai_copy", undefined, 26, "left", FONTS[1], 800, 1),
      text("stat", "stat", b(0.59, 0.35, 0.32, 0.032), 17, PALETTE[0], "static", "START AT 09 AM - 8 PM", 28, "left", FONTS[1], 700, 1),
      text("headline", "headline", b(0.1, 0.39, 0.8, 0.105), 72, PALETTE[0], "ai_copy", undefined, 22, "left", FONTS[0], 700, 0.95),
      shape("detail_panel", b(0, 0.52, 1, 0.34), PALETTE[0], "panel"),
      text("body", "body", b(0.1, 0.58, 0.34, 0.16), 20, PALETTE[3], "ai_copy", undefined, 96, "left", FONTS[1], 500, 1.24),
      text("address", "address", b(0.1, 0.755, 0.36, 0.034), 15, PALETTE[3], "static", "54 Joondalup Road, Joondalup", 42, "left", FONTS[1], 800, 1),
      image("detail_photo", b(0.49, 0.55, 0.43, 0.26), "secondary", "center"),
      shape("footer", b(0, 0.86, 1, 0.12), PALETTE[3], "band"),
      cta("cta", b(0.1, 0.9, 0.28, 0.045), PALETTE[0], PALETTE[3], 0, 18),
      text("handle", "handle", b(0.52, 0.902, 0.34, 0.042), 15, PALETTE[0], "brand", "jarrahproperty.com.au", 34, "left", FONTS[1], 600, 1.1),
    ]),
    "9:16": design("9:16", [
      shape("canvas", b(0, 0, 1, 1), PALETTE[0], "background"),
      image("primary_photo", b(0.03, 0.02, 0.94, 0.44), "primary", "center"),
      shape("hero_scrim", b(0.03, 0.27, 0.94, 0.19), "#000000", "scrim", 0, 0.5),
      text("eyebrow", "eyebrow", b(0.1, 0.295, 0.42, 0.044), 48, PALETTE[0], "static", "REAL ESTATE", 22, "left", FONTS[0], 500, 0.95),
      text("subhead", "subhead", b(0.1, 0.35, 0.44, 0.025), 23, PALETTE[0], "ai_copy", undefined, 26, "left", FONTS[1], 800, 1),
      text("stat", "stat", b(0.1, 0.378, 0.5, 0.024), 18, PALETTE[0], "static", "START AT 09 AM - 8 PM", 28, "left", FONTS[1], 700, 1),
      text("headline", "headline", b(0.1, 0.41, 0.78, 0.056), 66, PALETTE[0], "ai_copy", undefined, 22, "left", FONTS[0], 700, 0.95),
      shape("detail_panel", b(0.05, 0.5, 0.9, 0.29), PALETTE[0], "panel"),
      text("body", "body", b(0.11, 0.535, 0.42, 0.105), 23, PALETTE[3], "ai_copy", undefined, 96, "left", FONTS[1], 500, 1.22),
      text("address", "address", b(0.11, 0.66, 0.42, 0.026), 17, PALETTE[3], "static", "54 Joondalup Road, Joondalup", 42, "left", FONTS[1], 800, 1),
      image("detail_photo", b(0.56, 0.535, 0.31, 0.18), "secondary", "center"),
      shape("footer", b(0.05, 0.82, 0.9, 0.09), PALETTE[3], "band"),
      cta("cta", b(0.11, 0.845, 0.34, 0.04), PALETTE[0], PALETTE[3], 0, 19),
      text("handle", "handle", b(0.53, 0.846, 0.32, 0.034), 15, PALETTE[0], "brand", "jarrahproperty.com.au", 34, "left", FONTS[1], 600, 1.1),
    ]),
    "1:1": design("1:1", [
      shape("canvas", b(0, 0, 1, 1), PALETTE[0], "background"),
      image("primary_photo", b(0.03, 0.03, 0.94, 0.47), "primary", "center"),
      shape("hero_scrim", b(0.03, 0.29, 0.94, 0.21), "#000000", "scrim", 0, 0.48),
      text("eyebrow", "eyebrow", b(0.08, 0.31, 0.35, 0.055), 42, PALETTE[0], "static", "REAL ESTATE", 22, "left", FONTS[0], 500, 0.95),
      text("subhead", "subhead", b(0.58, 0.322, 0.32, 0.033), 18, PALETTE[0], "ai_copy", undefined, 26, "left", FONTS[1], 800, 1),
      text("stat", "stat", b(0.58, 0.357, 0.32, 0.03), 15, PALETTE[0], "static", "START AT 09 AM - 8 PM", 28, "left", FONTS[1], 700, 1),
      text("headline", "headline", b(0.08, 0.397, 0.84, 0.085), 58, PALETTE[0], "ai_copy", undefined, 22, "left", FONTS[0], 700, 0.95),
      shape("detail_panel", b(0.05, 0.54, 0.9, 0.27), PALETTE[0], "panel"),
      text("body", "body", b(0.1, 0.58, 0.36, 0.105), 19, PALETTE[3], "ai_copy", undefined, 84, "left", FONTS[1], 500, 1.2),
      text("address", "address", b(0.1, 0.705, 0.38, 0.032), 14, PALETTE[3], "static", "54 Joondalup Road, Joondalup", 42, "left", FONTS[1], 800, 1),
      image("detail_photo", b(0.53, 0.57, 0.35, 0.18), "secondary", "center"),
      shape("footer", b(0.05, 0.84, 0.9, 0.1), PALETTE[3], "band"),
      cta("cta", b(0.1, 0.872, 0.28, 0.042), PALETTE[0], PALETTE[3], 0, 16),
      text("handle", "handle", b(0.52, 0.875, 0.35, 0.036), 14, PALETTE[0], "brand", "jarrahproperty.com.au", 34, "left", FONTS[1], 600, 1.1),
    ]),
  };
}

function design(format: "4:5" | "9:16" | "1:1", layers: TemplateLayer[]): TemplateDesign {
  return {
    templateId: ID,
    version: 1,
    format,
    canvas: format === "9:16" ? { w: 1080, h: 1920 } : format === "1:1" ? { w: 1080, h: 1080 } : { w: 1080, h: 1350 },
    palette: PALETTE,
    fonts: FONTS,
    layers,
  };
}

function b(x: number, y: number, w: number, h: number): TemplateRect {
  return box(x, y, w, h);
}

function box(x: number, y: number, w: number, h: number): TemplateRect {
  return { x, y, w, h };
}

function shape(
  id: string,
  rect: TemplateRect,
  fill: string,
  role: "background" | "panel" | "band" | "scrim",
  radius = 0,
  opacity?: number,
): TemplateLayer {
  return { id, type: "shape", rect, fill, role, radius, locked: true, ...(opacity === undefined ? {} : { opacity }) };
}

function image(
  id: "primary_photo" | "detail_photo",
  rect: TemplateRect,
  role: "primary" | "secondary",
  anchor: "center" | "top" | "bottom" | "left" | "right" = "center",
): TemplateLayer {
  return {
    id,
    type: "image_slot",
    rect,
    role,
    fit: "cover",
    anchor,
    mask: "none",
    editorLabel: imageLabel(id),
    guidance: imageGuidance(id),
    required: true,
  };
}

function text(
  id: string,
  slot: TextSlot,
  rect: TemplateRect,
  size: number,
  color: string,
  fill: TextFill,
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
    size: slot === "headline" ? Math.max(size, 46) : Math.max(size, 18),
    lineHeight,
    weight,
    color,
    fill,
    text: copy,
    maxChars,
    maxLines: maxLinesForSlot(slot),
    editorLabel: textLabel(slot),
    copyField: copyFieldForSlot(slot, fill),
    guidance: textGuidance(slot),
    case: slot === "eyebrow" || slot === "headline" || slot === "subhead" || slot === "stat" ? "upper" : "none",
  };
}

function cta(id: string, rect: TemplateRect, fill: string, textColor: string, radius: number, size: number): TemplateLayer {
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
    maxChars: 18,
    maxLines: 1,
    editorLabel: textLabel("cta"),
    copyField: "cta",
    guidance: textGuidance("cta"),
  };
}

function imageLabel(id: "primary_photo" | "detail_photo"): string {
  if (id === "primary_photo") return "Hero exterior photo";
  return "Supporting detail photo";
}

function textLabel(slot: TextSlot): string {
  if (slot === "eyebrow") return "Category label";
  if (slot === "headline") return "Open-home headline";
  if (slot === "subhead") return "Inspection date";
  if (slot === "stat") return "Inspection time";
  if (slot === "body") return "Feature copy";
  if (slot === "address") return "Property address";
  if (slot === "cta") return "CTA";
  if (slot === "handle") return "Website";
  return "Template text";
}

function copyFieldForSlot(slot: TextSlot, fill: TextFill): "headline" | "description" | "cta" | "static" | "brand" {
  if (fill === "brand") return "brand";
  if (fill === "static") return "static";
  if (slot === "headline" || slot === "subhead") return "headline";
  if (slot === "body") return "description";
  if (slot === "cta") return "cta";
  return "static";
}

function imageGuidance(id: "primary_photo" | "detail_photo"): string {
  if (id === "primary_photo") return "Main open-home property photo. Use a wide exterior or hero room with clear negative space for the title.";
  return "Supporting interior or feature detail photo that reinforces the inspection invite.";
}

function textGuidance(slot: TextSlot): string {
  if (slot === "headline") return "Keep to a very short open-home title so it stays inside the hero frame.";
  if (slot === "subhead") return "Use a compact inspection date, such as Saturday 20 October.";
  if (slot === "stat") return "Use a short inspection time range.";
  if (slot === "body") return "List two or three concise property features. Avoid long sentences.";
  if (slot === "address") return "Use the property address or suburb in one short line.";
  if (slot === "cta") return "Short inspection action. Keep it under three words when possible.";
  if (slot === "handle") return "Agency website or contact handle.";
  return "Template-controlled text.";
}

function maxLinesForSlot(slot: TextSlot): number {
  if (slot === "body") return 4;
  if (slot === "headline") return 1;
  return 1;
}
