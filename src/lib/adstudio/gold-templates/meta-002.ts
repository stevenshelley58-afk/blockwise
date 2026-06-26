import type { TemplateDesign, TemplateDesignSet, TemplateLayer } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "meta_002";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#8B8176", "#FFFFFF", "#E7B24B", "#0B1720", "#D4D5D4", "#C0BDB9"];
const FONTS = ["Inter, Arial, sans-serif", "Georgia, 'Times New Roman', serif"];

export const meta002Template: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Feed 002 - Buying or Selling Agent Ad",
  goal: "seller_leads",
  offerId: "prelisting_timeline",
  imageBriefId: "IMG-AGENT-INTRO",
  promptHint:
    "Rebuild the source agent-led ad with a portrait slot, service bullets, signature/name block, and compact contact CTA. Source image: 01_feed_4x5_best/meta_002.png; original extraction: portrait_4x5/template_002.png.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Buying or selling in Bicton?",
    primaryText: "Work with Priya Nair for clear local advice before your next move.",
    description: "Agent-led property help for local owners.",
    cta: "Start planning",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "apartment_townhouse",
    priceFeel: "investor_rental",
    visualStyle: "organic_agent_post",
    people: "buyer_activity",
    copyDensity: "small_badge",
    tone: "simple_super_premium",
    sampleSuburb: "Bicton",
    sampleState: "WA",
    agencyName: "Northbank Realty",
    agentName: "Priya Nair",
    address: "12 Bicton Road, Bicton",
    propertyDetail: "architect-designed residence",
    resultDetail: "local context sample",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: meta002Designs(),
  evidenceScore: 72,
  winnerRationale:
    "Direct-best extracted Meta source: agent-led local buying/selling ad with a wide property image, centered service panel, portrait anchor, and compact contact CTA.",
  complianceNote:
    "Editable agent-service layout. Property image, agent portrait, headline, service copy, CTA, agency name, and contact text remain replaceable.",
  exemplars: ["meta_ad_candidates/01_feed_4x5_best/meta_002.png"],
};

export const meta002Sample = {
  photoFile: "au-riverside-townhouse.jpg",
  photoFiles: {
    primary_photo: "au-riverside-townhouse.jpg",
    agent_headshot: "au-urban-townhouse.png",
  },
  text: {
    eyebrow: "BUYING / SELLING",
    headline: "Buying or selling in Bicton?",
    body: "Clear local advice before your next move.",
    cta: "Start planning",
    address: "Bicton property help",
    phone: "08 6111 2400",
    handle: "Priya Nair",
  },
};

function meta002Designs(): TemplateDesignSet {
  return {
    "4:5": design("4:5", [
      shape("background", b(0, 0, 1, 1), PALETTE[4], "background"),
      shape("outer_card", b(0.035, 0.025, 0.93, 0.94), PALETTE[1], "panel", 8),
      image("primary_photo", b(0.055, 0.045, 0.89, 0.36), "primary", "center"),
      shape("hero_shadow", b(0.055, 0.36, 0.89, 0.045), PALETTE[3], "scrim", 0, 0.16),
      shape("service_panel", b(0.09, 0.47, 0.82, 0.28), PALETTE[1], "panel", 4),
      shape("accent_bar", b(0.16, 0.49, 0.2, 0.009), PALETTE[2], "band", 999),
      text("eyebrow", "eyebrow", b(0.16, 0.515, 0.45, 0.035), 18, PALETTE[0], "static", "BUYING / SELLING", 24, "left", FONTS[0], 800, 1),
      text("headline", "headline", b(0.16, 0.555, 0.54, 0.09), 38, PALETTE[3], "ai_copy", undefined, 44, "left", FONTS[0], 850, 1.05),
      text("body", "body", b(0.16, 0.665, 0.46, 0.055), 20, "#5C5751", "ai_copy", undefined, 82, "left", FONTS[0], 560, 1.18),
      image("agent_headshot", b(0.68, 0.64, 0.23, 0.24), "agent_headshot", "top"),
      shape("portrait_rule", b(0.675, 0.635, 0.24, 0.008), PALETTE[2], "band", 999),
      text("handle", "handle", b(0.16, 0.782, 0.32, 0.035), 20, PALETTE[3], "brand", undefined, 32, "left", FONTS[1], 700, 1),
      text("address", "address", b(0.16, 0.825, 0.41, 0.035), 16, PALETTE[0], "static", "Bicton property help", 34, "left", FONTS[0], 650, 1),
      cta("cta", b(0.16, 0.875, 0.27, 0.05), PALETTE[3], PALETTE[1], 999, 18),
      text("phone", "phone", b(0.48, 0.887, 0.32, 0.028), 16, PALETTE[3], "brand", undefined, 24, "left", FONTS[0], 700, 1),
    ]),
    "9:16": design("9:16", [
      shape("background", b(0, 0, 1, 1), PALETTE[4], "background"),
      shape("outer_card", b(0.055, 0.055, 0.89, 0.845), PALETTE[1], "panel", 8),
      image("primary_photo", b(0.08, 0.08, 0.84, 0.305), "primary", "center"),
      shape("service_panel", b(0.11, 0.44, 0.78, 0.255), PALETTE[1], "panel", 4),
      shape("accent_bar", b(0.17, 0.46, 0.22, 0.007), PALETTE[2], "band", 999),
      text("eyebrow", "eyebrow", b(0.17, 0.485, 0.5, 0.025), 18, PALETTE[0], "static", "BUYING / SELLING", 24, "left", FONTS[0], 800, 1),
      text("headline", "headline", b(0.17, 0.52, 0.58, 0.075), 42, PALETTE[3], "ai_copy", undefined, 44, "left", FONTS[0], 850, 1.04),
      text("body", "body", b(0.17, 0.612, 0.48, 0.045), 21, "#5C5751", "ai_copy", undefined, 78, "left", FONTS[0], 560, 1.16),
      image("agent_headshot", b(0.63, 0.64, 0.26, 0.18), "agent_headshot", "top"),
      text("handle", "handle", b(0.17, 0.72, 0.36, 0.028), 20, PALETTE[3], "brand", undefined, 32, "left", FONTS[1], 700, 1),
      text("address", "address", b(0.17, 0.758, 0.38, 0.025), 16, PALETTE[0], "static", "Bicton property help", 34, "left", FONTS[0], 650, 1),
      cta("cta", b(0.17, 0.81, 0.34, 0.043), PALETTE[3], PALETTE[1], 999, 18),
      text("phone", "phone", b(0.55, 0.82, 0.3, 0.024), 15, PALETTE[3], "brand", undefined, 24, "left", FONTS[0], 700, 1),
    ]),
    "1:1": design("1:1", [
      shape("background", b(0, 0, 1, 1), PALETTE[4], "background"),
      shape("outer_card", b(0.045, 0.045, 0.91, 0.91), PALETTE[1], "panel", 8),
      image("primary_photo", b(0.07, 0.07, 0.86, 0.34), "primary", "center"),
      shape("service_panel", b(0.095, 0.48, 0.81, 0.245), PALETTE[1], "panel", 4),
      shape("accent_bar", b(0.15, 0.505, 0.18, 0.008), PALETTE[2], "band", 999),
      text("eyebrow", "eyebrow", b(0.15, 0.535, 0.43, 0.03), 17, PALETTE[0], "static", "BUYING / SELLING", 24, "left", FONTS[0], 800, 1),
      text("headline", "headline", b(0.15, 0.57, 0.53, 0.085), 36, PALETTE[3], "ai_copy", undefined, 42, "left", FONTS[0], 850, 1.04),
      text("body", "body", b(0.15, 0.665, 0.43, 0.045), 18, "#5C5751", "ai_copy", undefined, 72, "left", FONTS[0], 560, 1.14),
      image("agent_headshot", b(0.68, 0.64, 0.22, 0.22), "agent_headshot", "top"),
      text("handle", "handle", b(0.15, 0.765, 0.35, 0.033), 19, PALETTE[3], "brand", undefined, 32, "left", FONTS[1], 700, 1),
      text("address", "address", b(0.15, 0.805, 0.36, 0.027), 15, PALETTE[0], "static", "Bicton property help", 34, "left", FONTS[0], 650, 1),
      cta("cta", b(0.15, 0.865, 0.27, 0.052), PALETTE[3], PALETTE[1], 999, 17),
      text("phone", "phone", b(0.47, 0.878, 0.29, 0.026), 15, PALETTE[3], "brand", undefined, 24, "left", FONTS[0], 700, 1),
    ]),
  };
}

function design(format: "4:5" | "9:16" | "1:1", layers: TemplateLayer[]): TemplateDesign {
  const canvas = format === "9:16" ? { w: 1080, h: 1920 } : format === "1:1" ? { w: 1080, h: 1080 } : { w: 1080, h: 1350 };
  return { templateId: ID, version: 1, format, canvas, palette: PALETTE, fonts: FONTS, layers };
}

function b(x: number, y: number, w: number, h: number) {
  return { x, y, w, h };
}

const box = b;

function shape(id: string, rect: ReturnType<typeof box>, fill: string, role: "background" | "panel" | "band" | "scrim", radius = 0, opacity?: number): TemplateLayer {
  return { id, type: "shape", rect, fill, role, radius, opacity, locked: true };
}

function image(id: string, rect: ReturnType<typeof box>, role: "primary" | "secondary" | "agent_headshot", anchor: "center" | "top" | "bottom" | "left" | "right" | "top_left" | "top_right" | "bottom_left" | "bottom_right"): TemplateLayer {
  return { id, type: "image_slot", rect, role, fit: "cover", anchor, mask: "none", editorLabel: labels(id, role), guidance: guidance(role), required: true };
}

function text(id: string, slot: "eyebrow" | "headline" | "body" | "address" | "handle" | "phone", rect: ReturnType<typeof box>, size: number, color: string, fill: "ai_copy" | "brand" | "static", copy: string | undefined, maxChars: number, align: "left" | "center" | "right", font: string, weight: number, lineHeight: number): TemplateLayer {
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
    maxLines: limits(slot),
    editorLabel: labels(slot),
    copyField: slot === "headline" ? "headline" : slot === "body" ? "description" : fill === "brand" ? "brand" : "static",
    guidance: guidance(slot),
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
    font: FONTS[0],
    size: Math.max(size, 18),
    maxChars: 18,
    maxLines: 1,
    editorLabel: "CTA",
    copyField: "cta",
    guidance: "Use a short action label that fits inside the button.",
  };
}

function labels(id: string, role?: string): string {
  if (role === "primary") return "Hero property image";
  if (role === "agent_headshot") return "Agent headshot";
  if (id === "headline") return "Hero headline";
  if (id === "body") return "Service copy";
  if (id === "eyebrow") return "Service label";
  if (id === "handle") return "Agent name";
  if (id === "address") return "Local context";
  if (id === "phone") return "Contact line";
  return "Template field";
}

function guidance(id: string): string {
  if (id === "primary") return "Wide property or suburb image used as the ad's opening visual.";
  if (id === "agent_headshot") return "Agent portrait for the lower-right portrait slot.";
  if (id === "headline") return "One short local buying-or-selling question; keep it to two lines.";
  if (id === "body") return "Brief service promise for local owners, capped to avoid crowding the portrait.";
  if (id === "eyebrow") return "Short category label for the service panel.";
  if (id === "handle") return "Agent name or concise agency signature.";
  if (id === "address") return "Short suburb or local service context.";
  if (id === "phone") return "Compact phone or contact detail.";
  return "Replaceable template content.";
}

function limits(slot: string): number {
  if (slot === "headline") return 2;
  if (slot === "body") return 2;
  return 1;
}
