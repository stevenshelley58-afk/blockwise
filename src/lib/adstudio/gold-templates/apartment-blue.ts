import type { TemplateDesignSet } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";
import { cta, design, fullRect, image, logo, rect, rel, shape, text, type GoldFormat, type GoldTemplateRenderSample, GOLD_SAMPLE_CARD_VERSION } from "./primitives.ts";

const ID = "gold_apartment_blue";
const PALETTE = ["#0A4F73", "#F7FAFC", "#F6C44F", "#FFFFFF", "#0F2431"];
const FONTS = ["Inter, Arial, sans-serif", "Inter, Arial, sans-serif"];

export const apartmentBlueTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Apartment Blue Feature",
  goal: "buyer_leads",
  offerId: "buyer_inspection_checklist",
  imageBriefId: "IMG-GOLD-APARTMENT-BLUE",
  promptHint: "Blue apartment feature ad with bold price-style band, feature cards, hero photo, and inspection CTA.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Apartment for sale",
    primaryText: "A refined apartment close to cafes, parks, and the city.",
    description: "Buyer inspection creative with apartment listing structure.",
    cta: "Book inspection",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "apartment_townhouse",
    priceFeel: "luxury_architectural",
    visualStyle: "super_premium_polished",
    people: "none",
    copyDensity: "stat_heavy",
    tone: "simple_super_premium",
    sampleSuburb: "South Perth",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Priya Nair",
    address: "7 Harper Terrace, South Perth",
    propertyDetail: "river-view apartment",
    resultDetail: "premium inspection campaign",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${GOLD_SAMPLE_CARD_VERSION}`,
  designs: apartmentBlueDesigns(),
  evidenceScore: 96,
  winnerRationale: "Individually authored apartment mini-template with blue commercial-listing header, price band, feature stat, and inspection CTA.",
  complianceNote: "Editable Australian real estate apartment template. Customer photo, brand, copy, address, and CTA remain replaceable.",
  exemplars: ["Reference-board apartment ad with a blue commercial-listing feel, feature chips, and clear CTA."],
};

export const apartmentBlueSample: GoldTemplateRenderSample = {
  photoFile: "au-riverside-townhouse.jpg",
  text: {
    eyebrow: "APARTMENT",
    headline: "Apartment for sale",
    body: "A refined apartment close to cafes, parks, and the city.",
    cta: "Book inspection",
    address: "7 Harper Terrace, South Perth",
    stat: "2 bed / 2 bath",
  },
};

function apartmentBlueDesigns(): TemplateDesignSet {
  return {
    "9:16": design({ templateId: ID, format: "9:16", palette: PALETTE, fonts: FONTS, layers: layers("9:16") }),
    "4:5": design({ templateId: ID, format: "4:5", palette: PALETTE, fonts: FONTS, layers: layers("4:5") }),
    "1:1": design({ templateId: ID, format: "1:1", palette: PALETTE, fonts: FONTS, layers: layers("1:1") }),
  };
}

function layers(format: GoldFormat) {
  const story = format === "9:16";
  const square = format === "1:1";
  const header = story ? rect(0, 0, 1, 0.16) : square ? rect(0, 0, 1, 0.17) : rect(0, 0, 1, 0.16);
  const photo = story ? rect(0.07, 0.15, 0.86, 0.47) : square ? rect(0.07, 0.15, 0.86, 0.38) : rect(0.07, 0.15, 0.86, 0.44);
  const panel = story ? rect(0.07, 0.63, 0.86, 0.3) : square ? rect(0.07, 0.56, 0.86, 0.36) : rect(0.07, 0.6, 0.86, 0.32);
  const headline = story ? 67 : square ? 48 : 58;
  const body = story ? 29 : square ? 22 : 25;
  const small = story ? 23 : square ? 18 : 20;
  return [
    shape("background", fullRect(), PALETTE[0], "background"),
    shape("header", header, PALETTE[0], "band"),
    shape("logo_plate", rect(0.07, header.h * 0.28, 0.34, header.h * 0.42), "#FFFFFF", "panel", 10),
    logo(rect(0.09, header.h * 0.36, 0.29, header.h * 0.24)),
    image("primary_photo", photo, "primary", "center"),
    shape("price_band", rect(photo.x, photo.y + photo.h - 0.06, photo.w, 0.06), PALETTE[2], "band"),
    text("stat", "stat", rect(photo.x + 0.04, photo.y + photo.h - 0.044, 0.34, 0.026), small, PALETTE[4], "static", "2 bed / 2 bath", 24, "none", "left", FONTS[1], 900),
    shape("info_panel", panel, PALETTE[1], "panel", 18),
    text("eyebrow", "eyebrow", rel(panel, 0.07, 0.12, 0.42, 0.08), story ? 28 : square ? 21 : 23, PALETTE[0], "static", "APARTMENT", 24, "upper", "left", FONTS[1], 900),
    text("headline", "headline", rel(panel, 0.07, 0.25, 0.58, 0.23), headline, PALETTE[4], "ai_copy", undefined, 34, "none", "left", FONTS[0], 950),
    text("body", "body", rel(panel, 0.07, 0.52, 0.55, 0.12), body, "#40515A", "ai_copy", undefined, 74),
    text("address", "address", rel(panel, 0.07, 0.82, 0.44, 0.07), small, PALETTE[4], "static", "7 Harper Terrace, South Perth", 44),
    cta("cta", rel(panel, 0.66, 0.74, 0.26, 0.13), PALETTE[0], "#FFFFFF", story ? 24 : square ? 19 : 22),
  ];
}
