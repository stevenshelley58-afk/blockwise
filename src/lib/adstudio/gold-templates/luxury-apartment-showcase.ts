import type { TemplateDesign, TemplateDesignSet, TemplateLayer } from "../template-design.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "gold_luxury_apartment_showcase";
const VERSION = "reference-board-pack-v1";
const PALETTE = ["#FFFFFF", "#303235", "#D9D0C4", "#746052", "#F4C35B"];
const FONTS = ["Inter, Arial, sans-serif", "Georgia, 'Times New Roman', serif"];

export const luxuryApartmentShowcaseTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Luxury Apartment Showcase",
  goal: "investor_leads",
  offerId: "listing_inquiries",
  imageBriefId: "IMG-REFERENCE-LUXURY-APARTMENT",
  promptHint: "Reference sample 05: white luxury apartment collage with one tall hero image, stacked circular room images, and a dark feature footer.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Luxury apartment living",
    primaryText: "Three refined spaces, one premium address.",
    description: "Luxury apartment collage based on the uploaded reference sample.",
    cta: "View details",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "apartment_townhouse",
    priceFeel: "luxury_architectural",
    visualStyle: "super_premium_polished",
    people: "agent_portrait",
    copyDensity: "small_badge",
    tone: "simple_super_premium",
    sampleSuburb: "South Perth",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Mia Chen",
    address: "88 Terrace Road, South Perth",
    propertyDetail: "3 bed apartment",
    resultDetail: "premium apartment enquiry",
    sampleCardImagePath: `adstudio-samples/gold/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/gold/${ID}.png?v=${VERSION}`,
  designs: luxuryApartmentShowcaseDesigns(),
  evidenceScore: 99,
  winnerRationale: "Standalone mini-project copied from reference sample 05: white asymmetrical apartment showcase with round image stack and dark amenity bar.",
  complianceNote: "Editable apartment showcase. All media slots and copy remain replaceable.",
  exemplars: ["Reference sample 05 from the uploaded board."],
};

export const luxuryApartmentShowcaseSample = {
  photoFile: "au-coastal-luxury.jpg",
  photoFiles: {
    primary_photo: "au-coastal-luxury.jpg",
    circle_one: "au-limestone-coastal.png",
    circle_two: "au-riverside-townhouse.jpg",
    circle_three: "au-urban-townhouse.png",
  },
  text: {
    eyebrow: "APARTMENT",
    headline: "Luxury apartment living",
    body: "Three refined spaces, one premium address.",
    cta: "View details",
    stat: "3 bed",
    address: "South Perth",
  },
};

function luxuryApartmentShowcaseDesigns(): TemplateDesignSet {
  return {
    "4:5": design("4:5", layout(0.08, 0.05, 0.84, 0.9, 52, 21)),
    "9:16": design("9:16", layout(0.08, 0.08, 0.84, 0.78, 55, 23)),
    "1:1": design("1:1", layout(0.07, 0.05, 0.86, 0.86, 46, 18)),
  };
}

function layout(x: number, y: number, w: number, h: number, headlineSize: number, bodySize: number): TemplateLayer[] {
  return [
    shape("white_card", box(x, y, w, h), PALETTE[0], "background", 24),
    image("primary_photo", box(x + w * 0.11, y + h * 0.08, w * 0.52, h * 0.52), "primary", "center"),
    shape("hero_frame", box(x + w * 0.1, y + h * 0.07, w * 0.54, h * 0.54), "none", "panel", 0),
    image("circle_one", box(x + w * 0.69, y + h * 0.08, w * 0.23, w * 0.23), "secondary", "center", "circle"),
    image("circle_two", box(x + w * 0.69, y + h * 0.29, w * 0.23, w * 0.23), "secondary", "center", "circle"),
    image("circle_three", box(x + w * 0.69, y + h * 0.5, w * 0.23, w * 0.23), "secondary", "center", "circle"),
    shape("footer", box(x + w * 0.46, y + h * 0.77, w * 0.42, h * 0.1), PALETTE[1], "band", 999),
    text("stat", "stat", box(x + w * 0.58, y + h * 0.805, w * 0.18, h * 0.03), bodySize, "#FFFFFF", "static", "3 bed", 12, "center", FONTS[0], 800, 1),
    text("headline", "headline", box(x + w * 0.1, y + h * 0.67, w * 0.48, h * 0.08), headlineSize, PALETTE[1], "ai_copy", undefined, 50, "left", FONTS[1], 760, 1.05),
    text("body", "body", box(x + w * 0.1, y + h * 0.78, w * 0.34, h * 0.06), bodySize, PALETTE[3], "ai_copy", undefined, 72, "left", FONTS[0], 560, 1.18),
    cta("cta", box(x + w * 0.1, y + h * 0.87, w * 0.25, h * 0.047), PALETTE[1], "#FFFFFF", 999, bodySize * 0.76),
  ];
}

function design(format: "4:5" | "9:16" | "1:1", layers: TemplateLayer[]): TemplateDesign { return { templateId: ID, version: 1, format, canvas: format === "9:16" ? { w: 1080, h: 1920 } : format === "1:1" ? { w: 1080, h: 1080 } : { w: 1080, h: 1350 }, palette: PALETTE, fonts: FONTS, layers }; }
function box(x: number, y: number, w: number, h: number) { return { x, y, w, h }; }
function shape(id: string, rect: ReturnType<typeof box>, fill: string, role: "background" | "panel" | "band" | "scrim", radius = 0): TemplateLayer { return { id, type: "shape", rect, fill, role, radius, locked: true }; }
function image(id: string, rect: ReturnType<typeof box>, role: "primary" | "secondary", anchor: "center" | "top" | "bottom" = "center", mask: "none" | "circle" = "none"): TemplateLayer { return { id, type: "image_slot", rect, role, fit: "cover", anchor, mask }; }
function text(id: string, slot: "headline" | "body" | "stat", rect: ReturnType<typeof box>, size: number, color: string, fill: "ai_copy" | "static", copy: string | undefined, maxChars: number, align: "left" | "center" | "right", font: string, weight: number, lineHeight: number): TemplateLayer {
  return { id, type: "text", slot, rect, align, font, size: Math.max(size, slot === "headline" ? 46 : 18), lineHeight, weight, color, fill, text: copy, maxChars, case: "none" };
}
function cta(id: string, rect: ReturnType<typeof box>, fill: string, textColor: string, radius: number, size: number): TemplateLayer { return { id, type: "cta_button", rect, fill, radius, label: "cta", textColor, font: FONTS[0], size: Math.max(size, 18) }; }
