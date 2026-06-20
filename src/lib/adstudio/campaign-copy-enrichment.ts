import { generateAdStudioCopy, type AdStudioCopyFields } from "./copy-generation.ts";
import { renderCreativeSvg } from "./renderer.ts";
import { runAdStudioComplianceReview } from "./compliance.ts";
import { syncCreativeWithCopyAndImage } from "./creative-design-json.ts";
import { findPackCopySimilarityWarnings } from "./creative-qa.ts";
import { toMetaCta } from "./readiness.ts";
import { scoreCampaignPackVariantsWithAi } from "./scoring.ts";
import type {
  AdStudioCampaignPack,
  AdStudioCampaignVariant,
  AdStudioCreative,
  AdStudioPlatformCopyPack,
} from "./types.ts";

export async function enrichCampaignPackCopyWithAi(input: {
  pack: AdStudioCampaignPack;
  workspaceId: string;
  userId: string;
  brief?: string;
  templateName?: string;
  templateHint?: string;
  propertyType?: string;
  /** Resolved, model-consumable image (data: or absolute URL) to ground copy in. */
  sourceImageUrl?: string;
}): Promise<AdStudioCampaignPack> {
  let pack = input.pack;
  let changed = false;
  let firstError: unknown = null;

  const enrichable = pack.variants
    .map((variant) => ({
      variant,
      copyPack: pack.copyPacks.find((candidate) => candidate.variantId === variant.variantId),
    }))
    .filter((entry): entry is { variant: AdStudioCampaignVariant; copyPack: AdStudioPlatformCopyPack } =>
      Boolean(entry.copyPack),
    );

  // Generate copy for all variants in parallel; per-variant failures are already
  // recorded inside generateAdStudioCopy via recordAdStudioProviderRun.
  const results = await Promise.allSettled(
    enrichable.map(({ variant, copyPack }) =>
      generateAdStudioCopy({
        workspaceId: input.workspaceId,
        userId: input.userId,
        mode: input.brief ? "brief" : "generate",
        brief: input.brief,
        copy: copyFieldsFromPack(copyPack),
        sourceImageUrl: input.sourceImageUrl,
        context: {
          goal: pack.campaign.goal,
          offer: variant.offer,
          market: [pack.campaign.market.suburb, pack.campaign.market.state].filter(Boolean).join(", "),
          propertyType: input.propertyType ?? "Residential property",
          businessName: pack.brandKit.identity.tradingName ?? pack.brandKit.identity.businessName,
          templateName: input.templateName,
          templateHint: input.templateHint,
          voice: pack.brandKit.tone.voice,
          preferredPhrases: pack.brandKit.tone.preferredPhrases,
          neverSay: pack.brandKit.tone.avoid,
        },
      }),
    ),
  );

  results.forEach((result, index) => {
    const entry = enrichable[index];
    if (!entry) return;
    if (result.status === "fulfilled") {
      pack = applyGeneratedCopy(pack, entry.variant.variantId, result.value.copy);
      changed = true;
    } else if (firstError === null) {
      firstError = result.reason;
    }
  });

  // Surface a real failure instead of silently shipping the unwritten template copy.
  if (!changed) {
    if (firstError) throw firstError;
    return input.pack;
  }

  const compliance = runAdStudioComplianceReview({ campaign: pack.campaign, copyPacks: pack.copyPacks });
  const similarityWarnings = findPackCopySimilarityWarnings(pack);
  const enriched: AdStudioCampaignPack = {
    ...pack,
    campaign: {
      ...pack.campaign,
      status: compliance.status === "blocked" ? "blocked" : "ready",
    },
    compliance,
    similarityWarnings: similarityWarnings.length ? similarityWarnings : undefined,
  };

  // LLM-judge scoring of the enriched copy (one batched call); falls back
  // silently to the deterministic scores when the call fails.
  return scoreCampaignPackVariantsWithAi({
    pack: enriched,
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
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
    creatives: pack.creatives.map((creative) =>
      creative.variantId === variantId ? updateCreativeCopy(creative, copy, pack) : creative,
    ),
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

function updateCreativeCopy(
  creative: AdStudioCreative,
  copy: Pick<AdStudioCopyFields, "headline" | "description" | "cta">,
  pack: AdStudioCampaignPack,
): AdStudioCreative {
  const primaryImage = creative.canvas.objects.find((object) => object.role === "primary_image");
  const imageSrc = primaryImage?.content ?? primaryImage?.assetId ?? "";
  const updated = syncCreativeWithCopyAndImage(creative, copy, imageSrc);
  if (updated.canvas.composition) return updated;
  return {
    ...updated,
    previewSvg: renderCreativeSvg(updated, pack.brandKit),
  };
}

function copyFieldsFromPack(copyPack: AdStudioPlatformCopyPack): AdStudioCopyFields {
  return {
    primaryText: copyPack.meta.primaryText[0] ?? "",
    headline: copyPack.meta.headlines[0] ?? copyPack.landingPage.headline,
    description: copyPack.meta.descriptions[0] ?? copyPack.landingPage.subheadline,
    // Preserve the human CTA string (e.g. "Request price update") rather than
    // re-deriving it from the 4-value Meta enum, which collapses anything that
    // isn't download/contact/sign into "Learn more".
    cta: copyPack.landingPage.cta || ctaLabel(copyPack.meta.cta),
  };
}

function replaceFirst(values: string[], next: string): string[] {
  const trimmed = next.trim();
  if (!trimmed) return values;
  return [trimmed, ...values.filter((value) => value && value !== trimmed).slice(0, Math.max(0, values.length - 1))];
}

function ctaLabel(value: AdStudioPlatformCopyPack["meta"]["cta"]): string {
  if (value === "DOWNLOAD") return "Download";
  if (value === "CONTACT_US") return "Contact us";
  if (value === "SIGN_UP") return "Sign up";
  return "Learn more";
}
