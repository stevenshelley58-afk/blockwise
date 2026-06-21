import type { TemplateDesignSet } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";
import { cta, design, fullRect, image, logo, rect, rel, shape, text, type GoldFormat, type GoldTemplateRenderSample, GOLD_SAMPLE_CARD_VERSION } from "./primitives.ts";

const ID = "gold_seller_checklist";
const PALETTE = ["#F2EEE7", "#20302C", "#B86543", "#FFFFFF", "#A8B49B"];
const FONTS = ["Inter, Arial, sans-serif", "Inter, Arial, sans-serif"];

export const sellerChecklistTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Seller Checklist",
  goal: "seller_leads",
  offerId: "seller_prep_checklist",
  imageBriefId: "IMG-GOLD-SELLER-CHECKLIST",
  promptHint: "Seller lead magnet poster with photo cover, checklist blocks, guide headline, suburb cue, and download CTA.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "3 smart tips for sellers",
    primaryText: "Prepare your home, price the launch, and choose the right campaign window.",
    description: "Seller checklist lead magnet creative.",
    cta: "Get checklist",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "renovated_character",
    priceFeel: "mid_market_family",
    visualStyle: "guide_or_report_mockup",
    people: "none",
    copyDensity: "full_sales_poster",
    tone: "practical_local",
    sampleSuburb: "Fremantle",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Mia Chen",
    address: "9 Quarry Lane, Fremantle",
    propertyDetail: "renovated character home",
    resultDetail: "seller checklist",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${GOLD_SAMPLE_CARD_VERSION}`,
  designs: sellerChecklistDesigns(),
  evidenceScore: 95,
  winnerRationale: "Individually authored seller-guide mini-template: cover image, paper card, checklist blocks, local address, and download CTA.",
  complianceNote: "Editable Australian real estate lead magnet template. Customer photo, brand, copy, address, and CTA remain replaceable.",
  exemplars: ["Reference-board checklist poster with tangible guide structure instead of a generic listing panel."],
};

export const sellerChecklistSample: GoldTemplateRenderSample = {
  photoFile: "au-character-cottage.jpg",
  text: {
    eyebrow: "SELLER GUIDE",
    headline: "3 smart tips for sellers",
    body: "Prepare your home, price the launch, and choose the right campaign window.",
    cta: "Get checklist",
    address: "9 Quarry Lane, Fremantle",
    stat: "Prep / Price / Launch",
  },
};

function sellerChecklistDesigns(): TemplateDesignSet {
  return {
    "9:16": design({ templateId: ID, format: "9:16", palette: PALETTE, fonts: FONTS, layers: layers("9:16") }),
    "4:5": design({ templateId: ID, format: "4:5", palette: PALETTE, fonts: FONTS, layers: layers("4:5") }),
    "1:1": design({ templateId: ID, format: "1:1", palette: PALETTE, fonts: FONTS, layers: layers("1:1") }),
  };
}

function layers(format: GoldFormat) {
  const story = format === "9:16";
  const square = format === "1:1";
  const photo = story ? rect(0.08, 0.08, 0.84, 0.38) : square ? rect(0.08, 0.07, 0.84, 0.32) : rect(0.08, 0.07, 0.84, 0.36);
  const card = story ? rect(0.08, 0.42, 0.84, 0.48) : square ? rect(0.08, 0.36, 0.84, 0.57) : rect(0.08, 0.4, 0.84, 0.5);
  const headline = story ? 65 : square ? 46 : 56;
  const body = story ? 29 : square ? 22 : 25;
  const small = story ? 23 : square ? 18 : 20;
  return [
    shape("background", fullRect(), PALETTE[0], "background"),
    image("primary_photo", photo, "primary", "top"),
    shape("copy_card", card, "#FFFFFF", "panel", 28),
    shape("left_bar", rel(card, 0, 0, 0.045, 1), PALETTE[4], "band", 28),
    logo(rect(0.095, 0.03, story ? 0.34 : 0.3, story ? 0.034 : 0.04)),
    text("eyebrow", "eyebrow", rel(card, 0.1, 0.1, 0.45, 0.07), story ? 28 : square ? 21 : 23, PALETTE[2], "static", "SELLER GUIDE", 24, "upper", "left", FONTS[1], 900),
    text("headline", "headline", rel(card, 0.1, 0.21, 0.62, 0.2), headline, PALETTE[1], "ai_copy", undefined, 34, "none", "left", FONTS[0], 950),
    text("body", "body", rel(card, 0.1, 0.44, 0.64, 0.11), body, "#49544F", "ai_copy", undefined, 78),
    shape("step_1", rel(card, 0.1, 0.61, 0.23, 0.1), PALETTE[0], "panel", 12),
    shape("step_2", rel(card, 0.37, 0.61, 0.23, 0.1), PALETTE[0], "panel", 12),
    shape("step_3", rel(card, 0.64, 0.61, 0.23, 0.1), PALETTE[0], "panel", 12),
    text("step_1_text", "stat", rel(card, 0.12, 0.64, 0.19, 0.04), small, PALETTE[1], "static", "1 Prepare", 18, "none", "center", FONTS[1], 850),
    text("step_2_text", "stat", rel(card, 0.39, 0.64, 0.19, 0.04), small, PALETTE[1], "static", "2 Price", 18, "none", "center", FONTS[1], 850),
    text("step_3_text", "stat", rel(card, 0.66, 0.64, 0.19, 0.04), small, PALETTE[1], "static", "3 Launch", 18, "none", "center", FONTS[1], 850),
    text("address", "address", rel(card, 0.1, 0.82, 0.42, 0.07), small, PALETTE[1], "static", "9 Quarry Lane, Fremantle", 44),
    cta("cta", rel(card, 0.62, 0.78, 0.28, 0.12), PALETTE[1], "#FFFFFF", story ? 24 : square ? 19 : 22),
  ];
}
