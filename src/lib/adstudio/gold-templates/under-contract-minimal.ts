import type { TemplateDesignSet } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";
import { cta, design, fullRect, image, logo, rect, shape, text, type GoldFormat, type GoldTemplateRenderSample, GOLD_SAMPLE_CARD_VERSION } from "./primitives.ts";

const ID = "gold_under_contract_minimal";
const PALETTE = ["#E8DFD2", "#2A2520", "#8D5D48", "#FFFFFF", "#C9BBA9"];
const FONTS = ["Georgia, 'Times New Roman', serif", "Inter, Arial, sans-serif"];

export const underContractMinimalTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Under Contract Minimal",
  goal: "listing_nurture",
  offerId: "home_value_update",
  imageBriefId: "IMG-GOLD-UNDER-CONTRACT",
  promptHint: "Minimal under-contract editorial ad: soft neutral field, large property image, serif result headline, and appraisal CTA.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Under contract",
    primaryText: "A strong local campaign moved this home from launch to signed contract.",
    description: "Result proof creative for appraisal follow-up.",
    cta: "Request update",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "renovated_character",
    priceFeel: "mid_market_family",
    visualStyle: "super_premium_polished",
    people: "none",
    copyDensity: "minimal_no_overlay",
    tone: "quiet_editorial",
    sampleSuburb: "Subiaco",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Oliver Grant",
    address: "28 Barker Road, Subiaco",
    propertyDetail: "renovated character residence",
    resultDetail: "under contract proof",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${GOLD_SAMPLE_CARD_VERSION}`,
  designs: underContractMinimalDesigns(),
  evidenceScore: 95,
  winnerRationale: "Individually authored minimal result mini-template with large framed property image, centered serif result copy, and appraisal CTA.",
  complianceNote: "Editable Australian real estate result-proof template. Customer photo, brand, copy, address, and CTA remain replaceable.",
  exemplars: ["Reference-board minimalist result card with upscale editorial spacing and a quiet appraisal CTA."],
};

export const underContractMinimalSample: GoldTemplateRenderSample = {
  photoFile: "au-limestone-coastal.png",
  text: {
    eyebrow: "UNDER CONTRACT",
    headline: "Under contract",
    body: "A strong local campaign moved this home from launch to signed contract.",
    cta: "Request update",
    address: "28 Barker Road, Subiaco",
    stat: "Result achieved",
  },
};

function underContractMinimalDesigns(): TemplateDesignSet {
  return {
    "9:16": design({ templateId: ID, format: "9:16", palette: PALETTE, fonts: FONTS, layers: layers("9:16") }),
    "4:5": design({ templateId: ID, format: "4:5", palette: PALETTE, fonts: FONTS, layers: layers("4:5") }),
    "1:1": design({ templateId: ID, format: "1:1", palette: PALETTE, fonts: FONTS, layers: layers("1:1") }),
  };
}

function layers(format: GoldFormat) {
  const story = format === "9:16";
  const square = format === "1:1";
  const photo = story ? rect(0.1, 0.12, 0.8, 0.5) : square ? rect(0.1, 0.1, 0.8, 0.43) : rect(0.1, 0.1, 0.8, 0.47);
  const title = story ? rect(0.12, 0.65, 0.76, 0.16) : square ? rect(0.12, 0.56, 0.76, 0.18) : rect(0.12, 0.6, 0.76, 0.18);
  const headline = story ? 77 : square ? 54 : 66;
  const body = story ? 29 : square ? 22 : 25;
  const small = story ? 23 : square ? 18 : 20;
  return [
    shape("background", fullRect(), PALETTE[0], "background"),
    shape("photo_frame", rect(photo.x - 0.016, photo.y - 0.016, photo.w + 0.032, photo.h + 0.032), "#FFFFFF", "panel", 0),
    image("primary_photo", photo, "primary", "center"),
    logo(rect(0.1, 0.035, story ? 0.34 : 0.3, story ? 0.034 : 0.04)),
    text("eyebrow", "eyebrow", rect(0.12, title.y, 0.76, 0.04), story ? 28 : square ? 21 : 23, PALETTE[2], "static", "UNDER CONTRACT", 24, "upper", "center", FONTS[1], 900),
    text("headline", "headline", rect(0.12, title.y + title.h * 0.22, 0.76, title.h * 0.42), headline, PALETTE[1], "ai_copy", undefined, 30, "none", "center", FONTS[0], 850),
    text("body", "body", rect(0.18, title.y + title.h * 0.72, 0.64, title.h * 0.14), body, "#51473D", "ai_copy", undefined, 76, "none", "center"),
    shape("bottom_rule", rect(0.2, story ? 0.85 : 0.83, 0.6, 0.006), PALETTE[2], "band"),
    text("address", "address", rect(0.16, story ? 0.875 : 0.86, 0.34, 0.035), small, PALETTE[1], "static", "28 Barker Road, Subiaco", 44),
    cta("cta", rect(0.58, story ? 0.865 : 0.85, 0.26, story ? 0.05 : 0.06), PALETTE[1], "#FFFFFF", story ? 24 : square ? 19 : 22),
  ];
}
