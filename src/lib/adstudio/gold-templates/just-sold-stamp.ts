import type { TemplateDesignSet } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";
import { cta, design, fullRect, image, logo, rect, rel, shape, text, type GoldFormat, type GoldTemplateRenderSample, GOLD_SAMPLE_CARD_VERSION } from "./primitives.ts";

const ID = "gold_just_sold_stamp";
const PALETTE = ["#F7F0E5", "#1B1A17", "#9E2F2E", "#FFFFFF", "#DBCBAE"];
const FONTS = ["Georgia, 'Times New Roman', serif", "Inter, Arial, sans-serif"];

export const justSoldStampTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Just Sold Stamp",
  goal: "listing_nurture",
  offerId: "home_value_update",
  imageBriefId: "IMG-GOLD-JUST-SOLD-STAMP",
  promptHint: "Just-sold template with property photo, strong stamp treatment, result proof, and appraisal CTA.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Another deal closed",
    primaryText: "Strong local buyer demand helped deliver a standout result.",
    description: "Seller nurture creative for recent sale proof.",
    cta: "Get appraisal",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "renovated_character",
    priceFeel: "mid_market_family",
    visualStyle: "polished_meta_ad",
    people: "none",
    copyDensity: "small_badge",
    tone: "quiet_editorial",
    sampleSuburb: "Mount Lawley",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Marcus Bell",
    address: "42 Clifton Crescent, Mount Lawley",
    propertyDetail: "renovated federation bungalow",
    resultDetail: "sold above reserve",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${GOLD_SAMPLE_CARD_VERSION}`,
  designs: justSoldStampDesigns(),
  evidenceScore: 97,
  winnerRationale: "Individually authored just-sold mini-template with a red stamp, image scrim, proof chip, and appraisal CTA.",
  complianceNote: "Editable Australian real estate result-proof template. Customer photo, brand, copy, address, and CTA remain replaceable.",
  exemplars: ["Reference-board just-sold stamp card with bold sale proof and a compact appraisal CTA."],
};

export const justSoldStampSample: GoldTemplateRenderSample = {
  photoFile: "au-federation-bungalow.png",
  text: {
    eyebrow: "JUST SOLD",
    headline: "Another deal closed",
    body: "Strong local buyer demand helped deliver a standout result.",
    cta: "Get appraisal",
    address: "42 Clifton Crescent, Mount Lawley",
    stat: "Sold in 9 days",
  },
};

function justSoldStampDesigns(): TemplateDesignSet {
  return {
    "9:16": design({ templateId: ID, format: "9:16", palette: PALETTE, fonts: FONTS, layers: layers("9:16") }),
    "4:5": design({ templateId: ID, format: "4:5", palette: PALETTE, fonts: FONTS, layers: layers("4:5") }),
    "1:1": design({ templateId: ID, format: "1:1", palette: PALETTE, fonts: FONTS, layers: layers("1:1") }),
  };
}

function layers(format: GoldFormat) {
  const story = format === "9:16";
  const square = format === "1:1";
  const photo = story ? rect(0.07, 0.08, 0.86, 0.56) : square ? rect(0.07, 0.07, 0.86, 0.48) : rect(0.07, 0.07, 0.86, 0.54);
  const card = story ? rect(0.09, 0.59, 0.82, 0.31) : square ? rect(0.09, 0.53, 0.82, 0.38) : rect(0.09, 0.56, 0.82, 0.34);
  const stamp = story ? rect(0.12, 0.52, 0.4, 0.09) : square ? rect(0.11, 0.48, 0.4, 0.095) : rect(0.11, 0.5, 0.4, 0.095);
  const headline = story ? 70 : square ? 49 : 60;
  const body = story ? 29 : square ? 22 : 25;
  const small = story ? 23 : square ? 18 : 20;
  return [
    shape("background", fullRect(), PALETTE[0], "background"),
    image("primary_photo", photo, "primary", "top"),
    shape("photo_scrim", rect(photo.x, photo.y + photo.h * 0.66, photo.w, photo.h * 0.34), PALETTE[1], "scrim", 0, 0.24),
    logo(rect(0.085, 0.03, story ? 0.34 : 0.3, story ? 0.034 : 0.04)),
    shape("stamp_box", stamp, PALETTE[2], "band", 0, 0.96),
    text("stamp_text", "eyebrow", rel(stamp, 0.08, 0.24, 0.84, 0.5), story ? 28 : square ? 21 : 23, "#FFFFFF", "static", "JUST SOLD", 18, "upper", "center", FONTS[1], 950),
    shape("copy_card", card, "#FFFFFF", "panel", 22),
    text("headline", "headline", rel(card, 0.07, 0.22, 0.62, 0.26), headline, PALETTE[1], "ai_copy", undefined, 34, "none", "left", FONTS[0], 850),
    text("body", "body", rel(card, 0.07, 0.52, 0.55, 0.12), body, "#4B5563", "ai_copy", undefined, 76),
    shape("stat_card", rel(card, 0.68, 0.18, 0.24, 0.2), PALETTE[0], "panel", 14),
    text("stat", "stat", rel(card, 0.7, 0.25, 0.2, 0.07), small, PALETTE[2], "static", "Sold in 9 days", 24, "none", "center", FONTS[1], 900),
    text("address", "address", rel(card, 0.07, 0.8, 0.44, 0.08), small, PALETTE[1], "static", "42 Clifton Crescent, Mount Lawley", 44),
    cta("cta", rel(card, 0.64, 0.74, 0.28, 0.13), PALETTE[2], "#FFFFFF", story ? 24 : square ? 19 : 22),
  ];
}
