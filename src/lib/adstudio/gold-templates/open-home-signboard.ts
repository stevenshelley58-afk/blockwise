import type { TemplateDesignSet } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";
import { cta, design, fullRect, image, logo, rect, rel, shape, text, type GoldFormat, type GoldTemplateRenderSample, GOLD_SAMPLE_CARD_VERSION } from "./primitives.ts";

const ID = "gold_open_home_signboard";
const PALETTE = ["#E9DFCF", "#102E44", "#E2B24B", "#FFFFFF", "#C94D35"];
const FONTS = ["Inter, Arial, sans-serif", "Inter, Arial, sans-serif"];

export const openHomeSignboardTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Open Home Signboard",
  goal: "open_home_followup",
  offerId: "open_home_followup",
  imageBriefId: "IMG-GOLD-OPEN-HOME-SIGN",
  promptHint: "Open-home flyer with framed photo, signboard headline, schedule chip, address, and inspection CTA.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Open house this weekend",
    primaryText: "Walk through the rooms, light, and outdoor space before offers close.",
    description: "Inspection reminder creative for open homes.",
    cta: "Book inspection",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "new_build",
    priceFeel: "mid_market_family",
    visualStyle: "polished_meta_ad",
    people: "none",
    copyDensity: "headline_overlay",
    tone: "practical_local",
    sampleSuburb: "Victoria Park",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Leo Romano",
    address: "31 Teague Street, Victoria Park",
    propertyDetail: "modern family home",
    resultDetail: "open home inspection",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${GOLD_SAMPLE_CARD_VERSION}`,
  designs: openHomeSignboardDesigns(),
  evidenceScore: 95,
  winnerRationale: "Individually authored open-home mini-template: framed photo, signboard block, schedule card, address, and inspection CTA.",
  complianceNote: "Editable Australian real estate open-home template. Customer photo, brand, copy, address, and CTA remain replaceable.",
  exemplars: ["Reference-board open-house flyer with a strong signboard block and visible schedule card."],
};

export const openHomeSignboardSample: GoldTemplateRenderSample = {
  photoFile: "au-brick-family-home.jpg",
  text: {
    eyebrow: "OPEN HOME",
    headline: "Open house this weekend",
    body: "Walk through the rooms, light, and outdoor space before offers close.",
    cta: "Book inspection",
    address: "31 Teague Street, Victoria Park",
    stat: "Sat 11:00",
  },
};

function openHomeSignboardDesigns(): TemplateDesignSet {
  return {
    "9:16": design({ templateId: ID, format: "9:16", palette: PALETTE, fonts: FONTS, layers: layers("9:16") }),
    "4:5": design({ templateId: ID, format: "4:5", palette: PALETTE, fonts: FONTS, layers: layers("4:5") }),
    "1:1": design({ templateId: ID, format: "1:1", palette: PALETTE, fonts: FONTS, layers: layers("1:1") }),
  };
}

function layers(format: GoldFormat) {
  const story = format === "9:16";
  const square = format === "1:1";
  const photo = story ? rect(0.07, 0.08, 0.86, 0.52) : square ? rect(0.07, 0.07, 0.86, 0.45) : rect(0.07, 0.07, 0.86, 0.5);
  const board = story ? rect(0.08, 0.49, 0.58, 0.36) : square ? rect(0.08, 0.45, 0.58, 0.41) : rect(0.08, 0.48, 0.58, 0.37);
  const side = story ? rect(0.7, 0.62, 0.22, 0.18) : square ? rect(0.7, 0.62, 0.22, 0.2) : rect(0.7, 0.62, 0.22, 0.18);
  const headline = story ? 67 : square ? 48 : 58;
  const body = story ? 29 : square ? 22 : 25;
  const small = story ? 23 : square ? 18 : 20;
  return [
    shape("background", fullRect(), PALETTE[0], "background"),
    shape("photo_frame", rect(photo.x - 0.012, photo.y - 0.012, photo.w + 0.024, photo.h + 0.024), "#FFFFFF", "panel", 8),
    image("primary_photo", photo, "primary", "top"),
    logo(rect(0.08, 0.028, story ? 0.34 : 0.3, story ? 0.034 : 0.04)),
    shape("board", board, PALETTE[1], "panel", 0, 0.96),
    shape("accent", rel(board, 0.08, 0.12, 0.22, 0.018), PALETTE[2], "band", 0),
    text("eyebrow", "eyebrow", rel(board, 0.08, 0.24, 0.58, 0.08), story ? 28 : square ? 21 : 23, PALETTE[2], "static", "OPEN HOME", 24, "upper", "left", FONTS[1], 900),
    text("headline", "headline", rel(board, 0.08, 0.37, 0.74, 0.28), headline, "#FFFFFF", "ai_copy", undefined, 34, "none", "left", FONTS[0], 950),
    text("body", "body", rel(board, 0.08, 0.69, 0.76, 0.1), body, "#E8F1F4", "ai_copy", undefined, 74),
    text("address", "address", rel(board, 0.08, 0.84, 0.62, 0.07), small, "#FFFFFF", "static", "31 Teague Street, Victoria Park", 44),
    shape("schedule_card", side, "#FFFFFF", "panel", 14),
    text("stat", "stat", rel(side, 0.1, 0.22, 0.8, 0.2), small, PALETTE[1], "static", "Sat 11:00", 24, "none", "center", FONTS[1], 900),
    cta("cta", rect(side.x, side.y + side.h + 0.045, side.w, story ? 0.052 : 0.058), PALETTE[2], PALETTE[1], story ? 24 : square ? 19 : 22),
  ];
}
