import type { TemplateDesign, TemplateDesignSet, TemplateLayer } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "meta_040";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#593D34", "#FFFFFF", "#0B1720", "#F0F5F8", "#FDFDFD", "#63443A"];
const FONTS = ["Georgia, 'Times New Roman', serif", "Inter, Arial, sans-serif"];

export const meta040Template: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Square 040 - Luxury Apartments",
  goal: "seller_leads",
  offerId: "recent_sales_report",
  imageBriefId: "IMG-DEV-HERO",
  promptHint:
    "Rebuild the source development ad with architectural image slots, feature chips, release badge, and enquiry CTA. Source image: 03_square_feed_carousel_marketplace/meta_040.png; original extraction: square_1x1/template_040.png.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Luxury apartments in North Perth",
    primaryText: "Showcase premium amenities, hero imagery, and a direct enquiry path.",
    description: "Premium apartment campaign creative.",
    cta: "View release",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "luxury_architectural",
    priceFeel: "premium_coastal",
    visualStyle: "data_card",
    people: "agent_portrait",
    copyDensity: "full_sales_poster",
    tone: "practical_local",
    sampleSuburb: "North Perth",
    sampleState: "WA",
    agencyName: "Harbour Lane Property",
    agentName: "Mia Hart",
    address: "50 North Perth Road, North Perth",
    propertyDetail: "boutique apartment release",
    resultDetail: "premium development enquiry",
    sampleCardImagePath: "adstudio-samples/gold/meta_040.png",
  },
  sampleCardImageUrl: `/adstudio-samples/gold/meta_040.png?v=${VERSION}`,
  designs: meta040Designs(),
  evidenceScore: 76,
  winnerRationale:
    "Direct-good source template rebuilt as an editable luxury development card: strong curved editorial header, architectural hero image, amenity chips, and a compact enquiry footer.",
  complianceNote:
    "Editable development template. Keep project claims factual, replace all imagery with licensed property media, and keep enquiry copy clear rather than implying guaranteed outcomes.",
  exemplars: ["meta_ad_candidates/03_square_feed_carousel_marketplace/meta_040.png"],
};

export const meta040Sample = {
  photoFile: "au-coastal-luxury.jpg",
  photoFiles: {
    primary_photo: "au-coastal-luxury.jpg",
    secondary_photo: "au-urban-townhouse.png",
  },
  text: {
    eyebrow: "NEW RELEASE",
    headline: "Luxury apartments in North Perth",
    body: "Sophisticated living, premium finishes, and a direct path to the release details.",
    cta: "View release",
    address: "North Perth",
    phone: "+123-456-7890",
    stat: "Master suite",
  },
};

function meta040Designs(): TemplateDesignSet {
  return {
    "4:5": design("4:5", [
      shape("background", b(0.03, 0.03, 0.94, 0.91), PALETTE[3], "background", 34),
      shape("header_curve", b(0.04, 0.03, 0.92, 0.36), PALETTE[0], "panel", 34),
      shape("header_depth", b(0.08, 0.35, 0.84, 0.018), PALETTE[5], "band", 999),
      text("eyebrow", "eyebrow", b(0.22, 0.075, 0.56, 0.034), 19, PALETTE[1], "static", "NEW RELEASE", 26, "center", FONTS[1], 800, 1),
      text("headline", "headline", b(0.17, 0.1, 0.66, 0.132), 56, PALETTE[1], "ai_copy", undefined, 58, "center", FONTS[0], 760, 1.02),
      shape("rule", b(0.42, 0.252, 0.16, 0.003), PALETTE[1], "band", 999),
      text("body", "body", b(0.18, 0.27, 0.64, 0.05), 20, PALETTE[1], "ai_copy", undefined, 90, "center", FONTS[1], 520, 1.18),
      text("feature_one", "stat", b(0.15, 0.334, 0.17, 0.036), 15, PALETTE[1], "static", "MASTER BATHS", 18, "center", FONTS[1], 850, 1.05),
      text("feature_two", "stat", b(0.35, 0.334, 0.17, 0.036), 15, PALETTE[1], "static", "MASTER SUITE", 18, "center", FONTS[1], 850, 1.05),
      text("feature_three", "stat", b(0.55, 0.334, 0.17, 0.036), 15, PALETTE[1], "static", "GRAND LIVING", 20, "center", FONTS[1], 850, 1.05),
      text("feature_four", "stat", b(0.75, 0.334, 0.12, 0.036), 15, PALETTE[1], "static", "POOL", 12, "center", FONTS[1], 850, 1.05),
      image("primary_photo", b(0.08, 0.39, 0.84, 0.37), "primary", "center"),
      image("secondary_photo", b(0.58, 0.615, 0.28, 0.13), "secondary", "center"),
      shape("footer_panel", b(0.08, 0.755, 0.84, 0.1), PALETTE[4], "panel", 2),
      text("phone", "phone", b(0.12, 0.785, 0.25, 0.035), 15, PALETTE[2], "static", "+123-456-7890", 18, "left", FONTS[1], 650, 1),
      cta("cta", b(0.41, 0.782, 0.22, 0.046), PALETTE[0], PALETTE[1], 999, 17),
      text("address", "address", b(0.67, 0.791, 0.21, 0.026), 14, PALETTE[2], "static", "North Perth", 24, "right", FONTS[1], 650, 1),
    ]),
    "9:16": design("9:16", [
      shape("background", b(0.05, 0.05, 0.9, 0.86), PALETTE[3], "background", 34),
      shape("header_curve", b(0.07, 0.06, 0.86, 0.27), PALETTE[0], "panel", 34),
      text("eyebrow", "eyebrow", b(0.23, 0.092, 0.54, 0.025), 18, PALETTE[1], "static", "NEW RELEASE", 26, "center", FONTS[1], 800, 1),
      text("headline", "headline", b(0.14, 0.122, 0.72, 0.095), 54, PALETTE[1], "ai_copy", undefined, 54, "center", FONTS[0], 760, 1.02),
      shape("rule", b(0.38, 0.238, 0.24, 0.002), PALETTE[1], "band", 999),
      text("body", "body", b(0.16, 0.254, 0.68, 0.043), 21, PALETTE[1], "ai_copy", undefined, 86, "center", FONTS[1], 520, 1.17),
      text("feature_one", "stat", b(0.17, 0.317, 0.2, 0.03), 15, PALETTE[1], "static", "MASTER BATHS", 18, "center", FONTS[1], 850, 1.05),
      text("feature_two", "stat", b(0.4, 0.317, 0.2, 0.03), 15, PALETTE[1], "static", "MASTER SUITE", 18, "center", FONTS[1], 850, 1.05),
      text("feature_three", "stat", b(0.63, 0.317, 0.2, 0.03), 15, PALETTE[1], "static", "GRAND LIVING", 20, "center", FONTS[1], 850, 1.05),
      image("primary_photo", b(0.08, 0.36, 0.84, 0.34), "primary", "center"),
      image("secondary_photo", b(0.56, 0.675, 0.28, 0.135), "secondary", "center"),
      shape("footer_panel", b(0.1, 0.735, 0.8, 0.105), PALETTE[4], "panel", 2),
      text("address", "address", b(0.15, 0.758, 0.32, 0.028), 16, PALETTE[2], "static", "North Perth", 24, "left", FONTS[1], 720, 1),
      text("phone", "phone", b(0.15, 0.792, 0.32, 0.026), 14, PALETTE[2], "static", "+123-456-7890", 18, "left", FONTS[1], 620, 1),
      cta("cta", b(0.52, 0.77, 0.28, 0.043), PALETTE[0], PALETTE[1], 999, 17),
    ]),
    "1:1": design("1:1", [
      shape("background", b(0.02, 0.02, 0.96, 0.94), PALETTE[3], "background", 34),
      shape("header_curve", b(0.02, 0.02, 0.96, 0.42), PALETTE[0], "panel", 34),
      text("eyebrow", "eyebrow", b(0.22, 0.065, 0.56, 0.038), 18, PALETTE[1], "static", "NEW RELEASE", 26, "center", FONTS[1], 800, 1),
      text("headline", "headline", b(0.22, 0.085, 0.56, 0.145), 58, PALETTE[1], "ai_copy", undefined, 54, "center", FONTS[0], 760, 1.02),
      shape("rule", b(0.44, 0.268, 0.12, 0.004), PALETTE[1], "band", 999),
      text("body", "body", b(0.18, 0.292, 0.64, 0.052), 19, PALETTE[1], "ai_copy", undefined, 82, "center", FONTS[1], 520, 1.18),
      text("feature_one", "stat", b(0.18, 0.38, 0.15, 0.045), 14, PALETTE[1], "static", "MASTER BATHS", 18, "center", FONTS[1], 850, 1.05),
      text("feature_two", "stat", b(0.38, 0.38, 0.15, 0.045), 14, PALETTE[1], "static", "MASTER SUITE", 18, "center", FONTS[1], 850, 1.05),
      text("feature_three", "stat", b(0.58, 0.38, 0.16, 0.045), 14, PALETTE[1], "static", "GRAND LIVING", 20, "center", FONTS[1], 850, 1.05),
      text("feature_four", "stat", b(0.78, 0.38, 0.08, 0.045), 14, PALETTE[1], "static", "POOL", 12, "center", FONTS[1], 850, 1.05),
      image("primary_photo", b(0.08, 0.44, 0.84, 0.35), "primary", "center"),
      image("secondary_photo", b(0.56, 0.62, 0.28, 0.135), "secondary", "center"),
      shape("footer_panel", b(0.08, 0.8, 0.84, 0.105), PALETTE[4], "panel", 2),
      text("phone", "phone", b(0.12, 0.836, 0.25, 0.03), 13, PALETTE[2], "static", "+123-456-7890", 18, "left", FONTS[1], 650, 1),
      cta("cta", b(0.39, 0.828, 0.22, 0.05), PALETTE[0], PALETTE[1], 999, 16),
      text("address", "address", b(0.66, 0.839, 0.22, 0.028), 13, PALETTE[2], "static", "North Perth", 24, "right", FONTS[1], 650, 1),
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
  return box(x, y, w, h);
}

function box(x: number, y: number, w: number, h: number) {
  return { x, y, w, h };
}

function shape(id: string, rect: ReturnType<typeof box>, fill: string, role: "background" | "panel" | "band" | "scrim", radius = 0): TemplateLayer {
  return { id, type: "shape", rect, fill, role, radius, locked: true };
}

function image(
  id: string,
  rect: ReturnType<typeof box>,
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
    editorLabel: labels(id, role),
    guidance: guidance(role),
    required: true,
  };
}

function text(
  id: string,
  slot: "eyebrow" | "headline" | "body" | "address" | "stat" | "phone",
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
    font: FONTS[1],
    size: Math.max(size, 18),
    maxChars: 18,
    maxLines: 1,
    editorLabel: labels("cta"),
    copyField: "cta",
    guidance: guidance("cta"),
  };
}

function labels(key: string, role?: string): string {
  if (role === "primary") return "Hero property image";
  if (role === "secondary") return "Supporting property image";
  if (key === "headline") return "Luxury headline";
  if (key === "body") return "Supporting copy";
  if (key === "cta") return "CTA";
  if (key === "eyebrow") return "Release badge";
  if (key === "address") return "Location label";
  if (key === "phone") return "Contact number";
  if (key === "stat") return "Feature chip";
  return "Template text";
}

function guidance(key: string): string {
  if (key === "primary") return "Use the strongest exterior or hero render. Keep the building centered and clear of the footer.";
  if (key === "secondary") return "Optional supporting apartment, amenity, or lifestyle image for the narrow story format.";
  if (key === "headline") return "Short luxury development headline. Keep to two lines in the designed frame.";
  if (key === "body") return "One concise proof or lifestyle line. Avoid long suburb lists or legal fine print here.";
  if (key === "cta") return "Short enquiry action. Two or three words works best.";
  if (key === "address") return "Short suburb or project location only.";
  if (key === "phone") return "Use a direct contact number only when approved for the campaign.";
  if (key === "stat") return "Amenity label with one or two compact words.";
  return "Template-controlled text.";
}

function limits(slot: string): number {
  if (slot === "headline") return 2;
  if (slot === "body") return 2;
  return 1;
}
