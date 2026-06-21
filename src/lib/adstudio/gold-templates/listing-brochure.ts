import type { TemplateDesignSet } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";
import {
  cta,
  design,
  fullRect,
  image,
  logo,
  rect,
  rel,
  shape,
  text,
  type GoldFormat,
  type GoldTemplateRenderSample,
  GOLD_SAMPLE_CARD_VERSION,
} from "./primitives.ts";

const ID = "gold_listing_brochure";
const PALETTE = ["#F4EFE6", "#141414", "#9D3F2F", "#FFFFFF", "#D9CDBD"];
const FONTS = ["Georgia, 'Times New Roman', serif", "Inter, Arial, sans-serif"];

export const listingBrochureTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Listing Brochure",
  goal: "seller_leads",
  offerId: "recent_sales_report",
  imageBriefId: "IMG-GOLD-LISTING-BROCHURE",
  promptHint: "Clean real-estate flyer layout: hero property photo, white editorial panel, feature row, address, and listing CTA.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "New coastal listing",
    primaryText: "Fresh to market with light-filled living and a calm coastal finish.",
    description: "Premium listing card for Meta feed campaigns.",
    cta: "View listing",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "luxury_architectural",
    priceFeel: "premium_coastal",
    visualStyle: "super_premium_polished",
    people: "none",
    copyDensity: "minimal_no_overlay",
    tone: "simple_super_premium",
    sampleSuburb: "Cottesloe",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Ava Lindqvist",
    address: "18 Marine View, Cottesloe",
    propertyDetail: "modern coastal residence",
    resultDetail: "new listing launch",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${GOLD_SAMPLE_CARD_VERSION}`,
  designs: listingBrochureDesigns(),
  evidenceScore: 97,
  winnerRationale: "Individually authored mini-template based on clean listing flyer references: large hero image, crisp lower card, status pill, feature stat, and CTA.",
  complianceNote: "Editable Australian real estate listing template. Customer photo, brand, copy, address, and CTA remain replaceable.",
  exemplars: ["Reference-board clean listing flyer with a large hero, feature row, and crisp lower information card."],
};

export const listingBrochureSample: GoldTemplateRenderSample = {
  photoFile: "au-modern-coastal.png",
  text: {
    eyebrow: "NEW LISTING",
    headline: "New coastal listing",
    body: "Fresh to market with light-filled living and a calm coastal finish.",
    cta: "View listing",
    address: "18 Marine View, Cottesloe",
    stat: "4 bed / 2 bath",
  },
};

function listingBrochureDesigns(): TemplateDesignSet {
  return {
    "9:16": design({ templateId: ID, format: "9:16", palette: PALETTE, fonts: FONTS, layers: storyLayers() }),
    "4:5": design({ templateId: ID, format: "4:5", palette: PALETTE, fonts: FONTS, layers: feedLayers() }),
    "1:1": design({ templateId: ID, format: "1:1", palette: PALETTE, fonts: FONTS, layers: squareLayers() }),
  };
}

function storyLayers() {
  const photo = rect(0.06, 0.08, 0.88, 0.54);
  const panel = rect(0.06, 0.62, 0.88, 0.3);
  return layers("9:16", photo, panel, { eyebrow: 28, headline: 67, body: 29, small: 23, cta: 24 });
}

function feedLayers() {
  const photo = rect(0.06, 0.06, 0.88, 0.52);
  const panel = rect(0.06, 0.56, 0.88, 0.37);
  return layers("4:5", photo, panel, { eyebrow: 23, headline: 58, body: 25, small: 20, cta: 22 });
}

function squareLayers() {
  const photo = rect(0.06, 0.07, 0.88, 0.46);
  const panel = rect(0.06, 0.51, 0.88, 0.42);
  return layers("1:1", photo, panel, { eyebrow: 21, headline: 48, body: 22, small: 18, cta: 19 });
}

function layers(format: GoldFormat, photo: ReturnType<typeof rect>, panel: ReturnType<typeof rect>, s: { eyebrow: number; headline: number; body: number; small: number; cta: number }) {
  const story = format === "9:16";
  return [
    shape("background", fullRect(), PALETTE[0], "background"),
    shape("top_card", rect(photo.x - 0.014, photo.y - 0.014, photo.w + 0.028, photo.h + 0.028), "#FFFFFF", "panel", 18),
    image("primary_photo", photo, "primary", "top"),
    logo(rect(0.08, 0.027, story ? 0.32 : 0.28, story ? 0.032 : 0.038)),
    shape("status_pill", rect(0.66, 0.03, 0.25, story ? 0.035 : 0.042), PALETTE[1], "band", 999),
    text("status_text", "eyebrow", rect(0.685, story ? 0.039 : 0.041, 0.2, 0.024), 18, "#FFFFFF", "static", "NEW LISTING", 18, "upper", "center", "Inter, Arial, sans-serif", 850),
    shape("copy_panel", panel, "#FFFFFF", "panel", 14),
    text("eyebrow", "eyebrow", rel(panel, 0.07, 0.1, 0.42, 0.08), s.eyebrow, PALETTE[2], "static", "NEW LISTING", 26, "upper", "left", "Inter, Arial, sans-serif", 900),
    text("headline", "headline", rel(panel, 0.07, 0.23, 0.58, 0.25), s.headline, PALETTE[1], "ai_copy", undefined, 36, "none", "left", FONTS[0], 850),
    text("body", "body", rel(panel, 0.07, 0.51, 0.52, 0.12), s.body, "#4B5563", "ai_copy", undefined, 76),
    text("stat", "stat", rel(panel, 0.68, 0.17, 0.23, 0.08), s.small, PALETTE[2], "static", "4 bed / 2 bath", 24, "none", "right", FONTS[1], 850),
    text("address", "address", rel(panel, 0.07, 0.79, 0.44, 0.08), s.small, PALETTE[1], "static", "18 Marine View, Cottesloe", 44),
    cta("cta", rel(panel, 0.64, 0.74, 0.27, 0.13), PALETTE[1], "#FFFFFF", s.cta),
  ];
}
