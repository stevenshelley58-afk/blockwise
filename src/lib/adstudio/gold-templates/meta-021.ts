import type { TemplateDesign, TemplateDesignSet, TemplateLayer, TemplateRect, TextFill, TextSlot } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "meta_021";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#CCBCAD", "#0B1720", "#9D8671", "#FFFFFF", "#FBF7F4", "#F7F4F1", "#6F6258"];
const FONTS = ["Georgia, 'Times New Roman', serif", "Inter, Arial, sans-serif"];

export const meta021Template: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Feed 021 - New On The Market Collage",
  goal: "seller_leads",
  offerId: "recent_sales_report",
  imageBriefId: "IMG-JUST-LISTED",
  promptHint:
    "Rebuild the source listing ad as editable property-photo slots, headline, feature chips, price or address row, and a clear CTA. Source image: 01_feed_4x5_best/meta_021.png; original extraction: portrait_4x5/template_021.png.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "New on the market in Fremantle",
    primaryText: "A fresh local listing with the features owners and buyers are watching.",
    description: "Fresh listing context for local owners.",
    cta: "View listing",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "renovated_character",
    priceFeel: "affordable_entry",
    visualStyle: "guide_or_report_mockup",
    people: "none",
    copyDensity: "headline_overlay",
    tone: "urgent_listing",
    sampleSuburb: "Fremantle",
    sampleState: "WA",
    agencyName: "Bluestone Residential",
    agentName: "Leo Romano",
    address: "31 Fremantle Road, Fremantle",
    propertyDetail: "renovated family home",
    resultDetail: "local context sample",
    sampleCardImagePath: "adstudio-samples/gold/meta_021.png",
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: meta021Designs(),
  evidenceScore: 74,
  winnerRationale:
    "Direct hand rebuild of source meta_021: a soft new-on-market listing card with oversized editorial headline, compact feature row, and three-photo property collage.",
  complianceNote:
    "Editable listing ad template. Property imagery, headline, body copy, CTA, address, brand, and feature labels must be verified against the live listing before publishing.",
  exemplars: ["meta_ad_candidates/01_feed_4x5_best/meta_021.png", "public/adstudio-samples/extracted-meta/meta_021.png"],
};

export const meta021Sample = {
  photoFile: "au-character-cottage.jpg",
  photoFiles: {
    primary_photo: "au-character-cottage.jpg",
    secondary_left: "au-character-cottage.jpg",
    secondary_round: "au-limestone-coastal.png",
  },
  text: {
    eyebrow: "Bluestone Residential",
    headline: "New on the market in Fremantle",
    body: "A fresh local listing with the features owners and buyers are watching.",
    cta: "View listing",
    address: "31 Fremantle Road, Fremantle",
    stat: "4 Bed   3 Bath   3 Cars   Pool",
  },
};

function meta021Designs(): TemplateDesignSet {
  return {
    "4:5": design("4:5", [
      shape("card", b(0.028, 0.018, 0.944, 0.952), PALETTE[4], "background", 34),
      shape("edge", b(0.034, 0.024, 0.932, 0.94), "transparent", "panel", 32, 1),
      text("brand", "eyebrow", b(0.12, 0.096, 0.38, 0.032), 22, PALETTE[6], "brand", undefined, "left"),
      text("menu", "eyebrow", b(0.76, 0.096, 0.12, 0.032), 20, PALETTE[6], "static", "x x x x", "right"),
      text("headline", "headline", b(0.12, 0.15, 0.76, 0.185), 92, PALETTE[6], "ai_copy", undefined, "left"),
      text("address", "address", b(0.12, 0.37, 0.62, 0.034), 22, PALETTE[2], "static", "31 Fremantle Road, Fremantle", "left"),
      text("body", "body", b(0.12, 0.414, 0.58, 0.03), 17, PALETTE[2], "ai_copy", undefined, "left"),
      text("feature_strip", "stat", b(0.12, 0.455, 0.6, 0.034), 19, PALETTE[2], "static", "4 Bed     3 Bath     3 Cars     Pool", "left"),
      image("secondary_left", b(0.12, 0.565, 0.305, 0.335), "secondary", "Lower left living photo", "Interior or lifestyle photo that gives the listing collage warmth.", "center"),
      image("primary_photo", b(0.45, 0.565, 0.435, 0.335), "primary", "Main property photo", "Best hero property image, framed wide enough for the main listing view.", "center"),
      shape("round_photo_back", b(0.332, 0.625, 0.236, 0.19), PALETTE[3], "panel", 999),
      image("secondary_round", b(0.358, 0.646, 0.184, 0.148), "secondary", "Circular exterior inset", "Exterior or entry detail for the central circular inset.", "center", "circle"),
      cta("cta", b(0.62, 0.835, 0.18, 0.043), PALETTE[0], PALETTE[3], 0),
      text("site", "handle", b(0.57, 0.925, 0.31, 0.024), 15, PALETTE[2], "static", "www.realtygreatsite.com", "right"),
    ]),
    "9:16": design("9:16", [
      shape("card", b(0.05, 0.035, 0.9, 0.91), PALETTE[4], "background", 36),
      text("brand", "eyebrow", b(0.13, 0.08, 0.42, 0.026), 24, PALETTE[6], "brand", undefined, "left"),
      text("menu", "eyebrow", b(0.72, 0.08, 0.15, 0.026), 20, PALETTE[6], "static", "x x x x", "right"),
      text("headline", "headline", b(0.13, 0.135, 0.74, 0.16), 88, PALETTE[6], "ai_copy", undefined, "left"),
      text("address", "address", b(0.13, 0.325, 0.7, 0.028), 23, PALETTE[2], "static", "31 Fremantle Road, Fremantle", "left"),
      text("body", "body", b(0.13, 0.36, 0.66, 0.024), 17, PALETTE[2], "ai_copy", undefined, "left"),
      text("feature_strip", "stat", b(0.13, 0.418, 0.68, 0.026), 20, PALETTE[2], "static", "4 Bed     3 Bath     3 Cars     Pool", "left"),
      image("primary_photo", b(0.18, 0.48, 0.64, 0.245), "primary", "Main property photo", "Wide hero listing image for the strongest photo position.", "center"),
      image("secondary_left", b(0.18, 0.75, 0.31, 0.13), "secondary", "Lower supporting photo", "Secondary interior or lifestyle image with simple composition.", "center"),
      image("secondary_round", b(0.53, 0.742, 0.23, 0.13), "secondary", "Exterior inset photo", "Exterior or entry detail cropped as a soft circular inset.", "center", "circle"),
      cta("cta", b(0.56, 0.848, 0.22, 0.036), PALETTE[0], PALETTE[3], 0),
      text("site", "handle", b(0.31, 0.91, 0.38, 0.018), 16, PALETTE[2], "static", "www.realtygreatsite.com", "center"),
    ]),
    "1:1": design("1:1", [
      shape("card", b(0.035, 0.035, 0.93, 0.91), PALETTE[4], "background", 34),
      text("brand", "eyebrow", b(0.115, 0.092, 0.38, 0.034), 21, PALETTE[6], "brand", undefined, "left"),
      text("menu", "eyebrow", b(0.73, 0.092, 0.15, 0.034), 19, PALETTE[6], "static", "x x x x", "right"),
      text("headline", "headline", b(0.115, 0.16, 0.77, 0.18), 78, PALETTE[6], "ai_copy", undefined, "left"),
      text("address", "address", b(0.115, 0.38, 0.67, 0.035), 20, PALETTE[2], "static", "31 Fremantle Road, Fremantle", "left"),
      text("body", "body", b(0.115, 0.42, 0.62, 0.028), 16, PALETTE[2], "ai_copy", undefined, "left"),
      text("feature_strip", "stat", b(0.115, 0.468, 0.68, 0.034), 18, PALETTE[2], "static", "4 Bed     3 Bath     3 Cars     Pool", "left"),
      image("secondary_left", b(0.115, 0.57, 0.32, 0.25), "secondary", "Left supporting photo", "Interior or lifestyle image that balances the main listing photo.", "center"),
      image("primary_photo", b(0.465, 0.57, 0.42, 0.25), "primary", "Main property photo", "Primary listing photo with room for the CTA to sit over the lower edge.", "center"),
      shape("round_photo_back", b(0.335, 0.622, 0.23, 0.18), PALETTE[3], "panel", 999),
      image("secondary_round", b(0.36, 0.642, 0.18, 0.14), "secondary", "Circular exterior inset", "Exterior or entry detail cropped as a central circular inset.", "center", "circle"),
      cta("cta", b(0.635, 0.782, 0.18, 0.044), PALETTE[0], PALETTE[3], 0),
      text("site", "handle", b(0.54, 0.875, 0.34, 0.026), 14, PALETTE[2], "static", "www.realtygreatsite.com", "right"),
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

function shape(id: string, rect: TemplateRect, fill: string, role: "background" | "panel" | "band" | "scrim", radius = 0, opacity?: number): TemplateLayer {
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
    guidance: guidance("image", slotGuidance),
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
    font: slot === "headline" ? FONTS[0] : FONTS[1],
    size: slot === "headline" ? Math.max(size, 46) : Math.max(size, 18),
    lineHeight: slot === "headline" ? 0.95 : 1.15,
    weight: slot === "headline" ? 400 : 550,
    color,
    fill,
    text: copy,
    maxChars: copyLimit.maxChars,
    maxLines: copyLimit.maxLines,
    editorLabel: labels(slot),
    copyField: slot === "headline" ? "headline" : slot === "body" ? "description" : fill === "brand" ? "brand" : "static",
    guidance: guidance("text", labels(slot)),
    case: slot === "eyebrow" ? "none" : "none",
  };
}

function cta(id: string, rect: TemplateRect, fill: string, textColor: string, radius: number): TemplateLayer {
  return {
    id,
    type: "cta_button",
    rect,
    fill,
    radius,
    label: "cta",
    textColor,
    font: FONTS[1],
    size: 18,
    maxChars: limits("cta").maxChars,
    maxLines: limits("cta").maxLines,
    editorLabel: labels("cta"),
    copyField: "cta",
    guidance: guidance("cta", "CTA"),
  };
}

function labels(slot: TextSlot): string {
  if (slot === "headline") return "Hero headline";
  if (slot === "body") return "Supporting copy";
  if (slot === "cta") return "CTA";
  if (slot === "address") return "Address row";
  if (slot === "stat") return "Feature row";
  if (slot === "handle") return "Website";
  if (slot === "eyebrow") return "Brand label";
  return "Template text";
}

function guidance(kind: "image" | "text" | "cta", value: string): string {
  if (kind === "image") return value;
  if (kind === "cta") return "Use a short action label that stays inside the button.";
  if (value === "Hero headline") return "Keep to one clear listing announcement so the oversized headline does not overflow.";
  if (value === "Address row") return "Use a short address or suburb line only.";
  if (value === "Feature row") return "Keep features compact, such as beds, baths, cars, and one amenity.";
  return "Keep this field short enough for the designed frame.";
}

function limits(slot: TextSlot): { maxChars: number; maxLines: number } {
  if (slot === "headline") return { maxChars: 42, maxLines: 2 };
  if (slot === "body") return { maxChars: 84, maxLines: 2 };
  if (slot === "address") return { maxChars: 48, maxLines: 1 };
  if (slot === "stat") return { maxChars: 42, maxLines: 1 };
  if (slot === "cta") return { maxChars: 16, maxLines: 1 };
  if (slot === "handle") return { maxChars: 34, maxLines: 1 };
  return { maxChars: 32, maxLines: 1 };
}
