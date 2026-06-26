import type { TemplateDesign, TemplateDesignSet, TemplateLayer, TemplateRect, TextFill, TextSlot } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "meta_001";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#31363C", "#FFFFFF", "#0B1720", "#BABBBB", "#939495"];
const FONTS = ["Inter, Arial, sans-serif", "Georgia, 'Times New Roman', serif"];

export const meta001Template: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Meta 001 - Listing Hero",
  goal: "seller_leads",
  offerId: "recent_sales_report",
  imageBriefId: "IMG-JUST-LISTED",
  promptHint:
    "Rebuild the source listing ad as editable property-photo slots, headline, feature chips, price or address row, and a clear CTA. Source image: 02_stories_reels_9x16/meta_001.png; original extraction: portrait_9x16/template_001.png.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Just listed in Scarborough",
    primaryText: "A new townhouse with the details local owners watch: price guide, features, and buyer interest in Scarborough.",
    description: "Fresh listing context for local owners.",
    cta: "See recent sales",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "renovated_character",
    priceFeel: "affordable_entry",
    visualStyle: "guide_or_report_mockup",
    people: "owner_lifestyle",
    copyDensity: "headline_overlay",
    tone: "urgent_listing",
    sampleSuburb: "Scarborough",
    sampleState: "WA",
    agencyName: "Maison West",
    agentName: "Daniel Price",
    address: "11 Scarborough Road, Scarborough",
    propertyDetail: "new townhouse",
    resultDetail: "local context sample",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: meta001Designs(),
  evidenceScore: 71,
  winnerRationale:
    "Direct-best extracted Meta source: full-screen Stories/Reels listing hero with a three-sided photo frame (left column, right column, bottom strip), a dark central info panel, and a bold headline anchoring the listing.",
  complianceNote:
    "Editable listing ad template. Property imagery, headline, address, feature row, CTA, and agency brand must be verified against the live listing before publishing.",
  exemplars: ["meta_ad_candidates/02_stories_reels_9x16/meta_001.png"],
};

export const meta001Sample = {
  photoFile: "au-riverside-townhouse.jpg",
  photoFiles: {
    primary_photo: "au-riverside-townhouse.jpg",
    secondary_left: "au-modern-coastal.png",
    secondary_bottom: "au-limestone-coastal.png",
  },
  text: {
    eyebrow: "Maison West",
    headline: "Just listed in Scarborough",
    body: "A new townhouse with the details local owners watch.",
    cta: "See recent sales",
    address: "11 Scarborough Road, Scarborough",
    stat: "3 Bed   2 Bath   1 Car",
  },
};

function meta001Designs(): TemplateDesignSet {
  return {
    "9:16": design("9:16", [
      shape("background", b(0, 0, 1, 1), PALETTE[0], "background", 0),
      image("secondary_left", b(0.0, 0.0, 0.345, 1.0), "secondary", "Left column photo", "A secondary property or lifestyle image filling the left column.", "center"),
      shape("left_scrim", b(0.0, 0.0, 0.345, 1.0), "#000000", "scrim", 0, 0.18),
      image("primary_photo", b(0.37, 0.0, 0.63, 0.82), "primary", "Main property photo", "Hero listing photo occupying the upper-right zone.", "center"),
      shape("primary_scrim", b(0.37, 0.72, 0.63, 0.1), PALETTE[2], "scrim", 0, 0.38),
      image("secondary_bottom", b(0.37, 0.84, 0.63, 0.16), "secondary", "Bottom strip photo", "Lower-right strip photo adding depth to the listing collage.", "center"),
      shape("info_panel", b(0.37, 0.62, 0.63, 0.22), PALETTE[2], "panel", 0, 0.92),
      shape("accent_bar", b(0.42, 0.635, 0.12, 0.006), PALETTE[1], "band", 4),
      text("brand", "eyebrow", b(0.42, 0.652, 0.5, 0.024), 20, PALETTE[3], "brand", undefined, "left"),
      text("headline", "headline", b(0.38, 0.685, 0.58, 0.115), 52, PALETTE[1], "ai_copy", undefined, "left"),
      text("address", "address", b(0.42, 0.808, 0.54, 0.026), 20, PALETTE[3], "static", "11 Scarborough Road, Scarborough", "left"),
      text("stat", "stat", b(0.42, 0.842, 0.52, 0.026), 19, PALETTE[3], "static", "3 Bed   2 Bath   1 Car", "left"),
      cta("cta", b(0.42, 0.878, 0.28, 0.046), PALETTE[1], PALETTE[2], 4),
    ]),
    "4:5": design("4:5", [
      shape("background", b(0, 0, 1, 1), PALETTE[0], "background", 0),
      image("primary_photo", b(0.0, 0.0, 1.0, 0.58), "primary", "Main property photo", "Hero listing photo spanning the full width at the top.", "center"),
      shape("primary_scrim", b(0.0, 0.48, 1.0, 0.1), PALETTE[2], "scrim", 0, 0.4),
      shape("info_panel", b(0.0, 0.58, 1.0, 0.42), PALETTE[2], "panel", 0, 1),
      shape("accent_bar", b(0.07, 0.606, 0.14, 0.006), PALETTE[1], "band", 4),
      text("brand", "eyebrow", b(0.07, 0.624, 0.55, 0.026), 20, PALETTE[3], "brand", undefined, "left"),
      text("headline", "headline", b(0.07, 0.662, 0.86, 0.12), 54, PALETTE[1], "ai_copy", undefined, "left"),
      text("address", "address", b(0.07, 0.8, 0.7, 0.028), 21, PALETTE[3], "static", "11 Scarborough Road, Scarborough", "left"),
      text("stat", "stat", b(0.07, 0.836, 0.68, 0.028), 20, PALETTE[3], "static", "3 Bed   2 Bath   1 Car", "left"),
      image("secondary_left", b(0.69, 0.615, 0.28, 0.24), "secondary", "Side panel photo", "A secondary property image inset on the right of the info panel.", "center"),
      cta("cta", b(0.07, 0.882, 0.3, 0.048), PALETTE[1], PALETTE[2], 4),
    ]),
    "1:1": design("1:1", [
      shape("background", b(0, 0, 1, 1), PALETTE[0], "background", 0),
      image("primary_photo", b(0.0, 0.0, 1.0, 0.54), "primary", "Main property photo", "Hero listing photo spanning the full width at the top.", "center"),
      shape("primary_scrim", b(0.0, 0.44, 1.0, 0.1), PALETTE[2], "scrim", 0, 0.4),
      shape("info_panel", b(0.0, 0.54, 1.0, 0.46), PALETTE[2], "panel", 0, 1),
      shape("accent_bar", b(0.065, 0.566, 0.13, 0.007), PALETTE[1], "band", 4),
      text("brand", "eyebrow", b(0.065, 0.586, 0.52, 0.03), 20, PALETTE[3], "brand", undefined, "left"),
      text("headline", "headline", b(0.065, 0.626, 0.87, 0.13), 50, PALETTE[1], "ai_copy", undefined, "left"),
      text("address", "address", b(0.065, 0.77, 0.72, 0.03), 21, PALETTE[3], "static", "11 Scarborough Road, Scarborough", "left"),
      text("stat", "stat", b(0.065, 0.808, 0.68, 0.03), 20, PALETTE[3], "static", "3 Bed   2 Bath   1 Car", "left"),
      image("secondary_left", b(0.7, 0.555, 0.26, 0.24), "secondary", "Side panel photo", "A secondary property image inset on the right of the info panel.", "center"),
      cta("cta", b(0.065, 0.862, 0.3, 0.05), PALETTE[1], PALETTE[2], 4),
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
  id: string,
  rect: TemplateRect,
  role: "primary" | "secondary",
  editorLabel: string,
  slotGuidance: string,
  anchor: "center" | "top" | "bottom" | "left" | "right" = "center",
  mask: "none" | "circle" = "none",
): TemplateLayer {
  return {
    id,
    type: "image_slot",
    rect,
    role,
    fit: "cover",
    anchor,
    mask,
    editorLabel,
    guidance: slotGuidance,
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
  align: "left" | "center" | "right",
): TemplateLayer {
  const copyLimit = limits(slot);
  return {
    id,
    type: "text",
    slot,
    rect,
    align,
    font: slot === "headline" ? FONTS[1] : FONTS[0],
    size: slot === "headline" ? Math.max(size, 46) : Math.max(size, 18),
    lineHeight: slot === "headline" ? 0.96 : 1.15,
    weight: slot === "headline" ? 700 : 550,
    color,
    fill,
    text: copy,
    maxChars: copyLimit.maxChars,
    maxLines: copyLimit.maxLines,
    editorLabel: editorLabels(slot),
    copyField: slot === "headline" ? "headline" : slot === "body" ? "description" : fill === "brand" ? "brand" : "static",
    guidance: textGuidance(slot),
    case: slot === "eyebrow" ? "none" : "none",
  };
}

function cta(
  id: string,
  rect: TemplateRect,
  fill: string,
  textColor: string,
  radius: number,
): TemplateLayer {
  return {
    id,
    type: "cta_button",
    rect,
    fill,
    radius,
    label: "cta",
    textColor,
    font: FONTS[0],
    size: 18,
    maxChars: 18,
    maxLines: 1,
    editorLabel: "CTA",
    copyField: "cta",
    guidance: "Use a short action label that fits inside the button.",
  };
}

function editorLabels(slot: TextSlot): string {
  if (slot === "headline") return "Hero headline";
  if (slot === "body") return "Supporting copy";
  if (slot === "eyebrow") return "Brand label";
  if (slot === "address") return "Address row";
  if (slot === "stat") return "Feature row";
  if (slot === "handle") return "Agent name";
  return "Template text";
}

function textGuidance(slot: TextSlot): string {
  if (slot === "headline") return "One clear listing announcement; keep to two lines so the headline does not overflow the dark panel.";
  if (slot === "eyebrow") return "Agency name or short brand label shown above the headline.";
  if (slot === "address") return "Short address or suburb line only.";
  if (slot === "stat") return "Keep features compact: beds, baths, cars, and one amenity.";
  if (slot === "body") return "Brief supporting copy for the listing; keep it short to avoid crowding the CTA.";
  return "Keep this field short enough for the designed frame.";
}

function limits(slot: TextSlot): { maxChars: number; maxLines: number } {
  if (slot === "headline") return { maxChars: 38, maxLines: 2 };
  if (slot === "body") return { maxChars: 84, maxLines: 2 };
  if (slot === "address") return { maxChars: 48, maxLines: 1 };
  if (slot === "stat") return { maxChars: 38, maxLines: 1 };
  if (slot === "eyebrow") return { maxChars: 28, maxLines: 1 };
  if (slot === "handle") return { maxChars: 32, maxLines: 1 };
  return { maxChars: 32, maxLines: 1 };
}
