import type { TextSlot } from "./template-design.ts";
import type { AdStudioTemplate } from "./templates.ts";
import { dreamHomeBrandSample, dreamHomeBrandTemplate } from "./gold-templates/dream-home-brand.ts";
import { elevatedLivingEditorialSample, elevatedLivingEditorialTemplate } from "./gold-templates/elevated-living-editorial.ts";
import { elevateResidencesSample, elevateResidencesTemplate } from "./gold-templates/elevate-residences.ts";
import { firstBuyerNotesSample, firstBuyerNotesTemplate } from "./gold-templates/first-buyer-notes.ts";
import { homeBuyerTipsSample, homeBuyerTipsTemplate } from "./gold-templates/home-buyer-tips.ts";
import { houseForRentBlueSample, houseForRentBlueTemplate } from "./gold-templates/house-for-rent-blue.ts";
import { interiorDesignCollageSample, interiorDesignCollageTemplate } from "./gold-templates/interior-design-collage.ts";
import { luxuryApartmentShowcaseSample, luxuryApartmentShowcaseTemplate } from "./gold-templates/luxury-apartment-showcase.ts";
import { luxuryVillaNightSample, luxuryVillaNightTemplate } from "./gold-templates/luxury-villa-night.ts";
import { marketTypesTableSample, marketTypesTableTemplate } from "./gold-templates/market-types-table.ts";
import { meta002Sample, meta002Template } from "./gold-templates/meta-002.ts";
import { meta021Sample, meta021Template } from "./gold-templates/meta-021.ts";
import { meta040Sample, meta040Template } from "./gold-templates/meta-040.ts";
import { meta044Sample, meta044Template } from "./gold-templates/meta-044.ts";
import { meta055Sample, meta055Template } from "./gold-templates/meta-055.ts";

export const GOLD_SAMPLE_CARD_VERSION = "reference-board-pack-v1";

export type GoldTemplateRenderSample = {
  photoFile: string;
  photoFiles?: Record<string, string>;
  text: Partial<Record<TextSlot, string>>;
};

export const GOLD_AD_STUDIO_TEMPLATES: AdStudioTemplate[] = [
  homeBuyerTipsTemplate,
  interiorDesignCollageTemplate,
  marketTypesTableTemplate,
  elevateResidencesTemplate,
  luxuryApartmentShowcaseTemplate,
  luxuryVillaNightTemplate,
  elevatedLivingEditorialTemplate,
  dreamHomeBrandTemplate,
  houseForRentBlueTemplate,
  firstBuyerNotesTemplate,
  meta002Template,
  meta021Template,
  meta040Template,
  meta044Template,
  meta055Template,
];

export const GOLD_TEMPLATE_RENDER_SAMPLES: Record<string, GoldTemplateRenderSample> = {
  [homeBuyerTipsTemplate.id]: homeBuyerTipsSample,
  [interiorDesignCollageTemplate.id]: interiorDesignCollageSample,
  [marketTypesTableTemplate.id]: marketTypesTableSample,
  [elevateResidencesTemplate.id]: elevateResidencesSample,
  [luxuryApartmentShowcaseTemplate.id]: luxuryApartmentShowcaseSample,
  [luxuryVillaNightTemplate.id]: luxuryVillaNightSample,
  [elevatedLivingEditorialTemplate.id]: elevatedLivingEditorialSample,
  [dreamHomeBrandTemplate.id]: dreamHomeBrandSample,
  [houseForRentBlueTemplate.id]: houseForRentBlueSample,
  [firstBuyerNotesTemplate.id]: firstBuyerNotesSample,
  [meta002Template.id]: meta002Sample,
  [meta021Template.id]: meta021Sample,
  [meta040Template.id]: meta040Sample,
  [meta044Template.id]: meta044Sample,
  [meta055Template.id]: meta055Sample,
};
