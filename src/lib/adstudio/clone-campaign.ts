import { appendAdvertiserPath, resolveAdvertiserBaseUrl, resolveLeadFormPrivacyPolicyUrl } from "./advertiser-domain.ts";
import { runAdStudioComplianceReview } from "./compliance.ts";
import { deterministicUuid } from "./id.ts";
import { labelForMetaCta } from "./meta-cta.ts";
import { scoreAdStudioVariant } from "./scoring.ts";
import { resolveAdStudioTemplate, type AdStudioGalleryTemplate } from "./templates.ts";
import type {
  AdStudioBrandKit,
  AdStudioCampaign,
  AdStudioCampaignPack,
  AdStudioCloneQa,
  AdStudioCreative,
  AdStudioFormat,
  AdStudioPlatformCopyPack,
  FirstAdInput,
  GoogleAssetPack,
} from "./types.ts";

const CLONE_FORMATS = ["4:5", "9:16"] as const satisfies readonly AdStudioFormat[];
const CANVAS_SIZE: Record<(typeof CLONE_FORMATS)[number], { width: number; height: number }> = {
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

export type BuildCloneCampaignPackInput = {
  workspaceId: string;
  brandKit: AdStudioBrandKit;
  suburb: string;
  city: string;
  state: string;
  firstAd: FirstAdInput;
};

function buildLeadFormCopy(template: AdStudioGalleryTemplate, brandKit: AdStudioBrandKit): {
    headline: string;
    questions: string[];
    privacyPolicyUrl: string | null;
    thankYouScreen: { title: string; body: string };
  } {
  const goal = template.classification?.primary_intent ?? "";
  const offer = template.name ?? "";
  const agencyName = brandKit.identity.tradingName?.trim() || brandKit.identity.businessName || "the agency";

  let headline = "Request the property details";
  if (goal.includes("appraisal") || offer.toLowerCase().includes("appraisal")) {
    headline = "Request your free property appraisal";
  } else if (goal.includes("seller") || offer.toLowerCase().includes("seller")) {
    headline = "Request your free seller consultation";
  } else if (goal.includes("buyer") || offer.toLowerCase().includes("buyer")) {
    headline = "Register your interest in this property";
  } else if (goal.includes("rental") || offer.toLowerCase().includes("rental")) {
    headline = "Request your free rental appraisal";
  } else if (goal.includes("market") || offer.toLowerCase().includes("market")) {
    headline = "Request your free market report";
  } else if (goal.includes("downsizer") || offer.toLowerCase().includes("downsizer")) {
    headline = "Request your free downsizing consultation";
  } else if (goal.includes("investor") || offer.toLowerCase().includes("investor")) {
    headline = "Request your free investment consultation";
  } else if (goal.includes("offmarket") || offer.toLowerCase().includes("offmarket") || offer.toLowerCase().includes("off-market")) {
    headline = "Request off-market property alerts";
  }

  const templateQuestions = template.meta.leadForm.questions ?? [];
  const hasPhoneQuestion = templateQuestions.some((q) => q.toLowerCase().includes("phone") || q.toLowerCase().includes("call"));
  const questions = hasPhoneQuestion
    ? templateQuestions
    : [...templateQuestions, "What is your best contact number?"];

  const thankYouScreen = {
    title: "Request received",
    body: `${agencyName} will be in touch within 24 hours to arrange your ${goal.includes("appraisal") ? "appraisal" : goal.includes("seller") || goal.includes("buyer") || goal.includes("downsizer") ? "consultation" : "next steps"}.`,
  };

  return {
    headline,
    questions,
    privacyPolicyUrl: resolveLeadFormPrivacyPolicyUrl(brandKit),
    thankYouScreen,
  };
}

export function buildCloneCampaignPack(input: BuildCloneCampaignPackInput): AdStudioCampaignPack {
  const template = requireGalleryTemplate(input.firstAd.templateId);
  const cloneImages = input.firstAd.templateCloneImagesByFormat;
  // Feed-first contract: the 4:5 ad is the customer-facing headline and is
  // REQUIRED to create the campaign. The 9:16 story is OPTIONAL — it renders
  // in parallel and is patched into the already-persisted campaign once it
  // lands (Point 8: feed returns immediately, story persists in background).
  if (!cloneImages?.["4:5"]) {
    throw new Error("The finished feed (4:5) clone is required before an ad can be created.");
  }

  const campaignId = deterministicUuid(
    `${input.workspaceId}:${template.id}:${input.suburb}:${input.firstAd.description}`,
  );
  const readyFormats = CLONE_FORMATS.filter((format) => Boolean(cloneImages[format]));
  const campaign: AdStudioCampaign = {
    campaignId,
    workspaceId: input.workspaceId,
    brandKitId: input.brandKit.brandKitId,
    name: `${input.suburb || input.city} ${template.name}`.trim(),
    goal: template.goal,
    market: {
      country: "AU",
      state: input.state,
      city: input.city,
      suburb: input.suburb,
    },
    audienceIntent: template.audienceIntent,
    offerId: template.offerId,
    templateKey: template.id,
    templateSource: template.source ?? null,
    sourceObservedAdId: null,
    templateSnapshot: templateSnapshot(template),
    platforms: ["meta"],
    // Only formats that exist right now are declared; the story format is added
    // to this set when the background story render patches in.
    creativeFormats: [...readyFormats],
    status: "ready",
  };

  const headline = template.meta.headlines[0] || template.name;
  const variantId = deterministicUuid(`${campaignId}:${template.id}:clone`);
  const variant = {
    variantId,
    campaignId,
    angle: template.name,
    headline,
    offer: template.name,
    cta: labelForMetaCta(template.meta.cta),
    score: scoreAdStudioVariant({
      offerClarity: 20,
      localRelevance: 15,
      leadIntentStrength: 20,
      brandFit: 15,
      complianceSafety: 20,
      visualHierarchy: 10,
      notes: ["Cloned from the selected sample", "Reviewed automatically after creation"],
      warnings: [],
    }),
    status: "approved" as const,
    lockedFields: [],
  };
  const copyPack = buildCopyPack({ campaign, variantId, template, brandKit: input.brandKit });
  const creatives = readyFormats.map((format) => buildCloneCreative({
    campaignId,
    variantId,
    template,
    format,
    cloneImage: cloneImages[format]!,
    cloneQa: input.firstAd.templateCloneQaByFormat?.[format],
  }));
  const compliance = runAdStudioComplianceReview({ campaign, copyPacks: [copyPack] });

  return {
    brandKit: input.brandKit,
    campaign: { ...campaign, status: compliance.status === "blocked" ? "blocked" : "ready" },
    variants: [variant],
    creatives,
    copyPacks: [copyPack],
    compliance,
  };
}

function requireGalleryTemplate(templateId: string): AdStudioGalleryTemplate {
  const template = resolveAdStudioTemplate(templateId);
  if (!template?.sample || !template.inputs || !template.meta) {
    throw new Error("Selected sample was not found.");
  }
  return template as AdStudioGalleryTemplate;
}

function buildCopyPack(input: {
  campaign: AdStudioCampaign;
  variantId: string;
  template: AdStudioGalleryTemplate;
  brandKit: AdStudioBrandKit;
}): AdStudioPlatformCopyPack {
  const baseUrl = resolveAdvertiserBaseUrl(input.brandKit);
  const finalUrl = appendAdvertiserPath(baseUrl, "/contact");
  const businessName = input.brandKit.identity.tradingName || input.brandKit.identity.businessName;
  const headline = input.template.meta.headlines[0] || input.template.name;
  const description = input.template.meta.descriptions[0] || input.template.audienceIntent;
  const cta = labelForMetaCta(input.template.meta.cta);
  const emptyGoogleAssets = (platform: GoogleAssetPack["platform"]): GoogleAssetPack => ({
    platform,
    businessName,
    finalUrl,
    headlines: [headline],
    longHeadlines: [headline],
    descriptions: [description],
    images: { landscape_1_91: [], square_1_1: [], portrait_4_5: [], vertical_9_16: [] },
    logos: { square: [], landscape: [] },
  });

  return {
    copyPackId: deterministicUuid(`copypack:${input.variantId}`),
    campaignId: input.campaign.campaignId,
    variantId: input.variantId,
    meta: {
      platform: "meta",
      specialAdCategory: input.template.meta.specialAdCategory,
      primaryText: [...input.template.meta.primaryText],
      headlines: [...input.template.meta.headlines],
      descriptions: [...input.template.meta.descriptions],
      cta: input.template.meta.cta,
      leadForm: buildLeadFormCopy(input.template, input.brandKit),
    },
    googleSearch: {
      platform: "google_search",
      finalUrl,
      headlines: [],
      descriptions: [],
      paths: [],
      keywords: [],
      negativeKeywords: [],
    },
    googlePmax: emptyGoogleAssets("google_pmax"),
    googleDemandGen: emptyGoogleAssets("google_demand_gen"),
    landingPage: { headline, subheadline: description, cta },
    followUp: { sms: [], email: [] },
    lockedFields: [],
  };
}

export function buildCloneCreative(input: {
  campaignId: string;
  variantId: string;
  template: AdStudioGalleryTemplate;
  format: (typeof CLONE_FORMATS)[number];
  cloneImage: string;
  cloneQa?: AdStudioCloneQa;
}): AdStudioCreative {
  const size = CANVAS_SIZE[input.format];
  return {
    creativeId: deterministicUuid(
      `${input.campaignId}:${input.variantId}:${input.format}:${input.template.id}:clone`,
    ),
    campaignId: input.campaignId,
    variantId: input.variantId,
    format: input.format,
    canvas: {
      width: size.width,
      height: size.height,
      backgroundAssetId: null,
      cloneQa: input.cloneQa,
      objects: [{
        objectId: "template_clone_image",
        type: "image",
        role: "primary_image",
        content: input.cloneImage,
        assetId: input.cloneImage,
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        imageAnchor: "center",
        locked: false,
      }],
    },
    safeZones: { metaStory: input.format === "9:16", googleDemandGen: false },
    previewSvg: "",
  };
}

function templateSnapshot(template: AdStudioGalleryTemplate): Record<string, unknown> {
  return {
    id: template.id,
    name: template.name,
    goal: template.goal,
    offerId: template.offerId,
    source: template.source ?? null,
    audienceIntent: template.audienceIntent,
    format: template.format,
  };
}
