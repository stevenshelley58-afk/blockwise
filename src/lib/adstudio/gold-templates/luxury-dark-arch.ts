import type { TemplateDesignSet } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";
import { cta, design, fullRect, image, logo, rect, rel, shape, text, type GoldFormat, type GoldTemplateRenderSample, GOLD_SAMPLE_CARD_VERSION } from "./primitives.ts";

const ID = "gold_luxury_dark_arch";
const PALETTE = ["#0D0B09", "#F3E8D2", "#C6A15A", "#FFFFFF", "#2A241E"];
const FONTS = ["Georgia, 'Times New Roman', serif", "Inter, Arial, sans-serif"];

export const luxuryDarkArchTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Luxury Dark Arch",
  goal: "buyer_leads",
  offerId: "buyer_inspection_checklist",
  imageBriefId: "IMG-GOLD-LUXURY-DARK",
  promptHint: "Luxury black real-estate poster: arched property photo, oversized serif type, gold trim, and inspection CTA.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Luxury home release",
    primaryText: "Private inspections now open for a refined coastal residence.",
    description: "High-end buyer creative with editorial poster styling.",
    cta: "Book inspection",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "luxury_architectural",
    priceFeel: "luxury_architectural",
    visualStyle: "super_premium_polished",
    people: "none",
    copyDensity: "headline_overlay",
    tone: "simple_super_premium",
    sampleSuburb: "Peppermint Grove",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Priya Nair",
    address: "6 Bay View Road, Peppermint Grove",
    propertyDetail: "luxury architectural home",
    resultDetail: "private inspection campaign",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${GOLD_SAMPLE_CARD_VERSION}`,
  designs: luxuryDarkArchDesigns(),
  evidenceScore: 96,
  winnerRationale: "Individually authored luxury poster mini-template: black field, arched crop, gold trim, centred editorial type, and bottom CTA.",
  complianceNote: "Editable Australian real estate buyer template. Customer photo, brand, copy, address, and CTA remain replaceable.",
  exemplars: ["Reference-board luxury black poster with arched photo treatment and premium serif headline."],
};

export const luxuryDarkArchSample: GoldTemplateRenderSample = {
  photoFile: "au-coastal-luxury.jpg",
  text: {
    eyebrow: "PRIVATE SALE",
    headline: "Luxury home release",
    body: "Private inspections now open for a refined coastal residence.",
    cta: "Book inspection",
    address: "6 Bay View Road, Peppermint Grove",
    stat: "Inspections this week",
  },
};

function luxuryDarkArchDesigns(): TemplateDesignSet {
  return {
    "9:16": design({ templateId: ID, format: "9:16", palette: PALETTE, fonts: FONTS, layers: layers("9:16") }),
    "4:5": design({ templateId: ID, format: "4:5", palette: PALETTE, fonts: FONTS, layers: layers("4:5") }),
    "1:1": design({ templateId: ID, format: "1:1", palette: PALETTE, fonts: FONTS, layers: layers("1:1") }),
  };
}

function layers(format: GoldFormat) {
  const story = format === "9:16";
  const square = format === "1:1";
  const photo = story ? rect(0.12, 0.1, 0.76, 0.45) : square ? rect(0.14, 0.08, 0.72, 0.42) : rect(0.12, 0.08, 0.76, 0.46);
  const title = story ? rect(0.08, 0.58, 0.84, 0.2) : square ? rect(0.08, 0.52, 0.84, 0.22) : rect(0.08, 0.55, 0.84, 0.22);
  const footer = story ? rect(0.1, 0.83, 0.8, 0.085) : square ? rect(0.1, 0.82, 0.8, 0.09) : rect(0.1, 0.81, 0.8, 0.09);
  const headline = story ? 74 : square ? 52 : 64;
  const body = story ? 29 : square ? 22 : 25;
  const small = story ? 23 : square ? 18 : 20;
  const ctaSize = story ? 24 : square ? 19 : 22;
  return [
    shape("background", fullRect(), PALETTE[0], "background"),
    shape("photo_glow", rect(photo.x - 0.025, photo.y - 0.025, photo.w + 0.05, photo.h + 0.05), PALETTE[4], "panel", 999, 0.7),
    image("primary_photo", photo, "primary", "center", "shape"),
    shape("gold_rule_top", rect(0.16, story ? 0.585 : 0.55, 0.68, 0.006), PALETTE[2], "band"),
    logo(rect(0.08, 0.035, story ? 0.35 : 0.3, story ? 0.035 : 0.04)),
    text("eyebrow", "eyebrow", rect(0.08, title.y, 0.84, 0.04), story ? 28 : square ? 21 : 23, PALETTE[2], "static", "PRIVATE SALE", 24, "upper", "center", FONTS[1], 850),
    text("headline", "headline", rect(0.1, title.y + title.h * 0.18, 0.8, title.h * 0.45), headline, PALETTE[1], "ai_copy", undefined, 34, "none", "center", FONTS[0], 820),
    text("body", "body", rect(0.18, title.y + title.h * 0.68, 0.64, title.h * 0.16), body, "#D8CEBA", "ai_copy", undefined, 74, "none", "center"),
    shape("footer_panel", footer, "#17120E", "panel", 18),
    text("address", "address", rel(footer, 0.06, 0.28, 0.42, 0.34), small, PALETTE[1], "static", "6 Bay View Road, Peppermint Grove", 42),
    cta("cta", rel(footer, 0.62, 0.22, 0.3, 0.5), PALETTE[2], PALETTE[0], ctaSize),
  ];
}
