import type { TemplateDesign, TemplateDesignSet, TemplateLayer } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "meta_055";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#8E8C6B", "#FFFFFF", "#0B1720", "#FAF7F2", "#F0EBE5", "#DBE0E7"];
const FONTS = ["Georgia, 'Times New Roman', serif", "Inter, Arial, sans-serif"];

export const meta055Template: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Feed 055 - Editorial Just Sold",
  goal: "seller_leads",
  offerId: "recent_sales_report",
  imageBriefId: "IMG-JUST-SOLD",
  promptHint:
    "Rebuild the source sold-result ad with sold badge, property slot, result strip, and compliant local context CTA. Source image: 01_feed_4x5_best/meta_055.png; original extraction: portrait_4x5/template_055.png.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Just sold in North Perth",
    primaryText: "Use the latest local sale as context before you decide your next property step.",
    description: "Recent sale context without over-claiming.",
    cta: "Get local context",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "luxury_architectural",
    priceFeel: "premium_coastal",
    visualStyle: "data_card",
    people: "owner_lifestyle",
    copyDensity: "full_sales_poster",
    tone: "practical_local",
    sampleSuburb: "North Perth",
    sampleState: "WA",
    agencyName: "Coastal & Co Realty",
    agentName: "Elliot Marsh",
    address: "65 North Perth Road, North Perth",
    propertyDetail: "coastal apartment",
    resultDetail: "local context sample",
    sampleCardImagePath: "adstudio-samples/gold/meta_055.png",
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: meta055Designs(),
  evidenceScore: 74,
  winnerRationale:
    "Source candidate meta_055 is a direct-best editorial sold proof layout: oversized serif proof words, central property image, agent portrait inset, and a restrained contact/result strip.",
  complianceNote:
    "Editable just-sold proof template. Copy should present recent local sale context only and avoid promises about price, speed, leads, or future outcomes.",
  exemplars: ["meta_ad_candidates/01_feed_4x5_best/meta_055.png", "portrait_4x5/template_055.png"],
};

export const meta055Sample = {
  photoFile: "au-limestone-coastal.png",
  photoFiles: {
    primary_photo: "au-limestone-coastal.png",
    agent_headshot: "au-urban-townhouse.png",
  },
  text: {
    eyebrow: "A NEW CHAPTER STARTS HERE",
    headline: "Just sold in North Perth",
    body: "Use the latest local sale as context before you decide your next property step.",
    cta: "Get local context",
    address: "65 North Perth Road, North Perth",
    stat: "Recent local sale",
    handle: "Elliot Marsh",
  },
};

function meta055Designs(): TemplateDesignSet {
  return {
    "4:5": design("4:5", [
      shape("paper", b(0.024, 0.018, 0.952, 0.962), PALETTE[3], "background", 34),
      shape("inner_rule", b(0.044, 0.036, 0.912, 0.926), "transparent", "panel", 26, 1),
      text("proof_just", "eyebrow", b(0.11, 0.105, 0.36, 0.14), 166, "#3D3A31", "static", "Just", 8, "left", FONTS[0], 400, 0.86),
      text("eyebrow", "eyebrow", b(0.66, 0.13, 0.24, 0.06), 21, "#3E3D35", "static", "A NEW CHAPTER STARTS HERE", 28, "center", FONTS[1], 800, 1.1),
      image("primary_photo", b(0.052, 0.266, 0.896, 0.392), "primary", "center"),
      shape("lower_panel", b(0.052, 0.658, 0.896, 0.194), PALETTE[4], "panel", 0),
      image("agent_headshot", b(0.142, 0.604, 0.198, 0.158), "agent_headshot", "center", "circle"),
      text("proof_sold", "stat", b(0.485, 0.642, 0.378, 0.128), 142, "#3D3A31", "static", "sold", 8, "left", FONTS[0], 400, 0.9),
      text("headline", "headline", b(0.105, 0.782, 0.35, 0.045), 22, PALETTE[2], "ai_copy", undefined, 34, "left", FONTS[1], 800, 1.05),
      text("body", "body", b(0.49, 0.782, 0.36, 0.052), 18, "#4B4840", "ai_copy", undefined, 86, "left", FONTS[1], 500, 1.16),
      shape("footer_rule", b(0.48, 0.868, 0.002, 0.052), PALETTE[0], "band", 0),
      text("handle", "handle", b(0.555, 0.855, 0.29, 0.026), 18, "#5A574F", "static", "Elliot Marsh", 34, "right", FONTS[1], 750, 1),
      text("address", "address", b(0.515, 0.887, 0.33, 0.027), 16, "#5A574F", "static", "65 North Perth Road, North Perth", 46, "right", FONTS[1], 500, 1),
      cta("cta", b(0.13, 0.873, 0.245, 0.046), PALETTE[0], PALETTE[1], 999, 17),
    ]),
    "9:16": design("9:16", [
      shape("paper", b(0.045, 0.035, 0.91, 0.895), PALETTE[3], "background", 36),
      text("proof_just", "eyebrow", b(0.12, 0.082, 0.43, 0.112), 150, "#3D3A31", "static", "Just", 8, "left", FONTS[0], 400, 0.88),
      text("eyebrow", "eyebrow", b(0.61, 0.102, 0.25, 0.05), 20, "#3E3D35", "static", "A NEW CHAPTER STARTS HERE", 28, "center", FONTS[1], 800, 1.1),
      image("primary_photo", b(0.085, 0.218, 0.83, 0.342), "primary", "center"),
      shape("lower_panel", b(0.085, 0.56, 0.83, 0.186), PALETTE[4], "panel", 0),
      image("agent_headshot", b(0.14, 0.51, 0.21, 0.118), "agent_headshot", "center", "circle"),
      text("proof_sold", "stat", b(0.44, 0.574, 0.42, 0.098), 132, "#3D3A31", "static", "sold", 8, "left", FONTS[0], 400, 0.9),
      text("headline", "headline", b(0.14, 0.705, 0.35, 0.052), 26, PALETTE[2], "ai_copy", undefined, 34, "left", FONTS[1], 800, 1.05),
      text("body", "body", b(0.14, 0.772, 0.68, 0.06), 22, "#4B4840", "ai_copy", undefined, 86, "left", FONTS[1], 500, 1.16),
      cta("cta", b(0.14, 0.85, 0.3, 0.046), PALETTE[0], PALETTE[1], 999, 18),
      text("handle", "handle", b(0.55, 0.846, 0.27, 0.026), 18, "#5A574F", "static", "Elliot Marsh", 34, "right", FONTS[1], 750, 1),
      text("address", "address", b(0.49, 0.878, 0.33, 0.024), 15, "#5A574F", "static", "65 North Perth Road, North Perth", 46, "right", FONTS[1], 500, 1),
    ]),
    "1:1": design("1:1", [
      shape("paper", b(0.034, 0.034, 0.932, 0.932), PALETTE[3], "background", 30),
      text("proof_just", "eyebrow", b(0.1, 0.092, 0.34, 0.138), 138, "#3D3A31", "static", "Just", 8, "left", FONTS[0], 400, 0.88),
      text("eyebrow", "eyebrow", b(0.61, 0.116, 0.27, 0.058), 18, "#3E3D35", "static", "A NEW CHAPTER STARTS HERE", 28, "center", FONTS[1], 800, 1.1),
      image("primary_photo", b(0.066, 0.284, 0.868, 0.33), "primary", "center"),
      shape("lower_panel", b(0.066, 0.614, 0.868, 0.18), PALETTE[4], "panel", 0),
      image("agent_headshot", b(0.135, 0.568, 0.19, 0.19), "agent_headshot", "center", "circle"),
      text("proof_sold", "stat", b(0.472, 0.635, 0.37, 0.118), 118, "#3D3A31", "static", "sold", 8, "left", FONTS[0], 400, 0.9),
      text("headline", "headline", b(0.11, 0.822, 0.31, 0.048), 21, PALETTE[2], "ai_copy", undefined, 30, "left", FONTS[1], 800, 1.05),
      text("body", "body", b(0.46, 0.814, 0.37, 0.058), 17, "#4B4840", "ai_copy", undefined, 72, "left", FONTS[1], 500, 1.14),
      cta("cta", b(0.11, 0.888, 0.24, 0.045), PALETTE[0], PALETTE[1], 999, 16),
      text("handle", "handle", b(0.55, 0.89, 0.28, 0.024), 15, "#5A574F", "static", "Elliot Marsh", 34, "right", FONTS[1], 750, 1),
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

function b(x: number, y: number, w: number, h: number) {
  return { x, y, w, h };
}

function shape(
  id: string,
  rect: ReturnType<typeof b>,
  fill: string,
  role: "background" | "panel" | "band" | "scrim",
  radius = 0,
  opacity?: number,
): TemplateLayer {
  return { id, type: "shape", rect, fill, role, radius, opacity, locked: true };
}

function image(
  id: "primary_photo" | "agent_headshot",
  rect: ReturnType<typeof b>,
  role: "primary" | "agent_headshot",
  anchor: "center" | "top" | "bottom" | "left" | "right" = "center",
  mask: "none" | "circle" | "shape" = "none",
): TemplateLayer {
  return {
    id,
    type: "image_slot",
    rect,
    role,
    fit: "cover",
    anchor,
    mask,
    editorLabel: imageLabel(id),
    guidance: imageGuidance(role),
    required: role === "primary",
  };
}

function text(
  id: string,
  slot: "eyebrow" | "headline" | "body" | "address" | "stat" | "handle",
  rect: ReturnType<typeof b>,
  size: number,
  color: string,
  fill: "ai_copy" | "static",
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
    editorLabel: textLabel(slot, id),
    copyField: fill === "ai_copy" ? (slot === "headline" ? "headline" : "description") : "static",
    guidance: textGuidance(slot),
    case: slot === "eyebrow" ? "upper" : "none",
  };
}

function cta(id: string, rect: ReturnType<typeof b>, fill: string, textColor: string, radius: number, size: number): TemplateLayer {
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
    maxChars: ctaMaxChars(),
    maxLines: 1,
    editorLabel: "CTA",
    copyField: "cta",
    guidance: ctaGuidance(),
  };
}

function imageLabel(id: string): string {
  if (id === "primary_photo") return "Sold property image";
  if (id === "agent_headshot") return "Agent portrait";
  return "Template image";
}

function textLabel(slot: string, id: string): string {
  if (id === "proof_just") return "Proof word: Just";
  if (id === "proof_sold") return "Proof word: sold";
  if (slot === "headline") return "Local sold headline";
  if (slot === "body") return "Local context copy";
  if (slot === "eyebrow") return "Editorial eyebrow";
  if (slot === "address") return "Sold address";
  if (slot === "handle") return "Agent name";
  return "Template text";
}

function imageGuidance(role: string): string {
  if (role === "primary") return "Main sold property photo. Use a clean exterior or hero listing image with the home centered.";
  if (role === "agent_headshot") return "Optional agent portrait cropped for a circular inset; keep the face centered.";
  return "Supporting image for this template.";
}

function textGuidance(slot: string): string {
  if (slot === "headline") return "Short just-sold headline with suburb or area. Avoid price, speed, or outcome promises.";
  if (slot === "body") return "One compliant sentence about local sale context for owners considering their next step.";
  if (slot === "address") return "Property address or suburb label, kept short enough for the footer.";
  if (slot === "handle") return "Agent name or team label.";
  if (slot === "stat") return "Static proof word from the source layout.";
  return "Template-controlled editorial label.";
}

function ctaGuidance(): string {
  return "Short CTA for local context or recent sales. Avoid guaranteed outcome wording.";
}

function ctaMaxChars(): number {
  return 20;
}

function maxLinesForSlot(slot: string): number {
  if (slot === "headline") return 2;
  if (slot === "body") return 2;
  return 1;
}
