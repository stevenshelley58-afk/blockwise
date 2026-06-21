import type { TemplateDesignSet } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";
import { cta, design, fullRect, image, logo, rect, rel, shape, text, type GoldFormat, type GoldTemplateRenderSample, GOLD_SAMPLE_CARD_VERSION } from "./primitives.ts";

const ID = "gold_collage_listing";
const PALETTE = ["#EFE7DA", "#101A20", "#D49A3A", "#FFFFFF", "#6E4437"];
const FONTS = ["Inter, Arial, sans-serif", "Inter, Arial, sans-serif"];

export const collageListingTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Modern Listing Collage",
  goal: "seller_leads",
  offerId: "recent_sales_report",
  imageBriefId: "IMG-GOLD-COLLAGE-LISTING",
  promptHint: "Modern listing collage: hero property photo, two detail crops, black headline card, feature strip, and CTA.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Modern home for sale",
    primaryText: "Lead with the hero image, key features, and a simple enquiry path.",
    description: "Listing creative with collage-style image treatment.",
    cta: "Enquire now",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "luxury_architectural",
    priceFeel: "premium_coastal",
    visualStyle: "polished_meta_ad",
    people: "none",
    copyDensity: "stat_heavy",
    tone: "urgent_listing",
    sampleSuburb: "Scarborough",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Sarah Lin",
    address: "12 Brighton Road, Scarborough",
    propertyDetail: "modern beachside home",
    resultDetail: "listing enquiry campaign",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${GOLD_SAMPLE_CARD_VERSION}`,
  designs: collageListingDesigns(),
  evidenceScore: 95,
  winnerRationale: "Individually authored collage mini-template with a hero crop, two reusable detail crops, dark editorial card, feature strip, and CTA.",
  complianceNote: "Editable Australian real estate listing template. Customer photo, brand, copy, address, and CTA remain replaceable.",
  exemplars: ["Reference-board collage listing card with stacked image crops and a dark editorial headline block."],
};

export const collageListingSample: GoldTemplateRenderSample = {
  photoFile: "au-urban-townhouse.png",
  text: {
    eyebrow: "FOR SALE",
    headline: "Modern home for sale",
    body: "Lead with the hero image, key features, and a simple enquiry path.",
    cta: "Enquire now",
    address: "12 Brighton Road, Scarborough",
    stat: "Guide price on request",
  },
};

function collageListingDesigns(): TemplateDesignSet {
  return {
    "9:16": design({ templateId: ID, format: "9:16", palette: PALETTE, fonts: FONTS, layers: layers("9:16") }),
    "4:5": design({ templateId: ID, format: "4:5", palette: PALETTE, fonts: FONTS, layers: layers("4:5") }),
    "1:1": design({ templateId: ID, format: "1:1", palette: PALETTE, fonts: FONTS, layers: layers("1:1") }),
  };
}

function layers(format: GoldFormat) {
  const story = format === "9:16";
  const square = format === "1:1";
  const hero = story ? rect(0.06, 0.08, 0.88, 0.45) : square ? rect(0.06, 0.07, 0.88, 0.38) : rect(0.06, 0.06, 0.88, 0.43);
  const panel = story ? rect(0.08, 0.48, 0.56, 0.29) : square ? rect(0.08, 0.42, 0.56, 0.34) : rect(0.08, 0.44, 0.56, 0.31);
  const thumbA = story ? rect(0.68, 0.51, 0.24, 0.13) : square ? rect(0.68, 0.47, 0.24, 0.14) : rect(0.68, 0.49, 0.24, 0.13);
  const thumbB = story ? rect(0.68, 0.66, 0.24, 0.13) : square ? rect(0.68, 0.64, 0.24, 0.14) : rect(0.68, 0.64, 0.24, 0.13);
  const strip = story ? rect(0.08, 0.82, 0.84, 0.085) : square ? rect(0.08, 0.83, 0.84, 0.09) : rect(0.08, 0.82, 0.84, 0.09);
  const headline = story ? 67 : square ? 48 : 58;
  const body = story ? 29 : square ? 22 : 25;
  const small = story ? 23 : square ? 18 : 20;
  return [
    shape("background", fullRect(), PALETTE[0], "background"),
    image("primary_photo", hero, "primary", "top"),
    shape("panel", panel, PALETTE[1], "panel", 14, 0.97),
    text("eyebrow", "eyebrow", rel(panel, 0.08, 0.12, 0.5, 0.08), story ? 28 : square ? 21 : 23, PALETTE[2], "static", "FOR SALE", 24, "upper", "left", FONTS[1], 900),
    text("headline", "headline", rel(panel, 0.08, 0.28, 0.74, 0.28), headline, "#FFFFFF", "ai_copy", undefined, 34, "none", "left", FONTS[0], 950),
    text("body", "body", rel(panel, 0.08, 0.62, 0.76, 0.12), body, "#E7EDF0", "ai_copy", undefined, 76),
    text("address", "address", rel(panel, 0.08, 0.82, 0.58, 0.07), small, "#FFFFFF", "static", "12 Brighton Road, Scarborough", 44),
    image("detail_photo_top", thumbA, "secondary", "top_left"),
    image("detail_photo_bottom", thumbB, "secondary", "bottom_right"),
    shape("feature_strip", strip, "#FFFFFF", "panel", 14),
    text("stat", "stat", rel(strip, 0.06, 0.3, 0.32, 0.32), small, PALETTE[1], "static", "Guide price on request", 30, "none", "left", FONTS[1], 850),
    cta("cta", rel(strip, 0.68, 0.22, 0.25, 0.54), PALETTE[1], "#FFFFFF", story ? 24 : square ? 19 : 22),
    logo(rect(0.075, 0.028, story ? 0.34 : 0.3, story ? 0.034 : 0.04)),
  ];
}
