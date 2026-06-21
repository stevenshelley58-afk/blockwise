import type { AdStudioTemplate } from "./templates.ts";
import type { GoldTemplateRenderSample } from "./gold-templates/primitives.ts";
import { GOLD_SAMPLE_CARD_VERSION } from "./gold-templates/primitives.ts";
import { apartmentBlueSample, apartmentBlueTemplate } from "./gold-templates/apartment-blue.ts";
import { collageListingSample, collageListingTemplate } from "./gold-templates/collage-listing.ts";
import { justSoldStampSample, justSoldStampTemplate } from "./gold-templates/just-sold-stamp.ts";
import { listingBrochureSample, listingBrochureTemplate } from "./gold-templates/listing-brochure.ts";
import { luxuryDarkArchSample, luxuryDarkArchTemplate } from "./gold-templates/luxury-dark-arch.ts";
import { openHomeSignboardSample, openHomeSignboardTemplate } from "./gold-templates/open-home-signboard.ts";
import { sellerChecklistSample, sellerChecklistTemplate } from "./gold-templates/seller-checklist.ts";
import { underContractMinimalSample, underContractMinimalTemplate } from "./gold-templates/under-contract-minimal.ts";

export { GOLD_SAMPLE_CARD_VERSION };

export const GOLD_AD_STUDIO_TEMPLATES: AdStudioTemplate[] = [
  listingBrochureTemplate,
  luxuryDarkArchTemplate,
  justSoldStampTemplate,
  openHomeSignboardTemplate,
  collageListingTemplate,
  sellerChecklistTemplate,
  apartmentBlueTemplate,
  underContractMinimalTemplate,
];

export const GOLD_TEMPLATE_RENDER_SAMPLES: Record<string, GoldTemplateRenderSample> = {
  [listingBrochureTemplate.id]: listingBrochureSample,
  [luxuryDarkArchTemplate.id]: luxuryDarkArchSample,
  [justSoldStampTemplate.id]: justSoldStampSample,
  [openHomeSignboardTemplate.id]: openHomeSignboardSample,
  [collageListingTemplate.id]: collageListingSample,
  [sellerChecklistTemplate.id]: sellerChecklistSample,
  [apartmentBlueTemplate.id]: apartmentBlueSample,
  [underContractMinimalTemplate.id]: underContractMinimalSample,
};
