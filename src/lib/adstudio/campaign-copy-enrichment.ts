import type { AdStudioCopyFields } from "./copy-generation.ts";
import { runAdStudioComplianceReview } from "./compliance.ts";
import { toMetaCta } from "./meta-cta.ts";
import type {
  AdStudioCampaignPack,
  AdStudioPlatformCopyPack,
} from "./types.ts";

/**
 * Apply already-generated copy (e.g. the brief-grounded template copy produced
 * alongside a clone) to every variant, then re-run the deterministic compliance
 * review. Used by template mode, where AI enrichment is skipped but the
 * offer-library defaults must still be replaced with the user's copy.
 */
export function applyProvidedCopyToCampaignPack(
  pack: AdStudioCampaignPack,
  copy: AdStudioCopyFields,
): AdStudioCampaignPack {
  let next = pack;
  for (const variant of pack.variants) {
    next = applyGeneratedCopy(next, variant.variantId, copy);
  }
  const compliance = runAdStudioComplianceReview({ campaign: next.campaign, copyPacks: next.copyPacks });
  return {
    ...next,
    campaign: {
      ...next.campaign,
      status: compliance.status === "blocked" ? "blocked" : "ready",
    },
    compliance,
  };
}

function applyGeneratedCopy(
  pack: AdStudioCampaignPack,
  variantId: string,
  copy: AdStudioCopyFields,
): AdStudioCampaignPack {
  return {
    ...pack,
    variants: pack.variants.map((variant) =>
      variant.variantId === variantId
        ? { ...variant, headline: copy.headline || variant.headline, cta: copy.cta || variant.cta }
        : variant,
    ),
    copyPacks: pack.copyPacks.map((copyPack) =>
      copyPack.variantId === variantId ? updateCopyPack(copyPack, copy) : copyPack,
    ),
    creatives: pack.creatives,
  };
}

function updateCopyPack(copyPack: AdStudioPlatformCopyPack, copy: AdStudioCopyFields): AdStudioPlatformCopyPack {
  const cta = toMetaCta(copy.cta);
  return {
    ...copyPack,
    meta: {
      ...copyPack.meta,
      primaryText: replaceFirst(copyPack.meta.primaryText, copy.primaryText),
      headlines: replaceFirst(copyPack.meta.headlines, copy.headline),
      descriptions: replaceFirst(copyPack.meta.descriptions, copy.description),
      cta,
    },
    googleSearch: {
      ...copyPack.googleSearch,
      headlines: replaceFirst(copyPack.googleSearch.headlines, copy.headline),
      descriptions: replaceFirst(copyPack.googleSearch.descriptions, copy.description),
    },
    googlePmax: {
      ...copyPack.googlePmax,
      headlines: replaceFirst(copyPack.googlePmax.headlines, copy.headline),
      longHeadlines: replaceFirst(copyPack.googlePmax.longHeadlines, copy.headline),
      descriptions: replaceFirst(copyPack.googlePmax.descriptions, copy.description),
    },
    googleDemandGen: {
      ...copyPack.googleDemandGen,
      headlines: replaceFirst(copyPack.googleDemandGen.headlines, copy.headline),
      longHeadlines: replaceFirst(copyPack.googleDemandGen.longHeadlines, copy.headline),
      descriptions: replaceFirst(copyPack.googleDemandGen.descriptions, copy.description),
    },
    landingPage: {
      ...copyPack.landingPage,
      headline: copy.headline || copyPack.landingPage.headline,
      subheadline: copy.description || copyPack.landingPage.subheadline,
      cta: copy.cta || copyPack.landingPage.cta,
    },
  };
}

function replaceFirst(values: string[], next: string): string[] {
  const trimmed = next.trim();
  if (!trimmed) return values;
  return [trimmed, ...values.filter((value) => value && value !== trimmed).slice(0, Math.max(0, values.length - 1))];
}
