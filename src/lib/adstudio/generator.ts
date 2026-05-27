import { runAdStudioComplianceReview } from "./compliance.ts";
import { deterministicUuid } from "./id.ts";
import { getOfferTemplate } from "./offers.ts";
import { getCanvasSize, renderCreativeSvg } from "./renderer.ts";
import { scoreAdStudioVariant } from "./scoring.ts";
import type {
  AdStudioBrandKit,
  AdStudioCampaign,
  AdStudioCampaignPack,
  AdStudioCampaignVariant,
  AdStudioCreative,
  AdStudioFormat,
  AdStudioGoal,
  AdStudioPlatform,
  AdStudioPlatformCopyPack,
  GoogleAssetPack,
  GoogleSearchPack,
  MetaLeadAdPack,
} from "./types.ts";

export type GenerateCampaignPackInput = {
  workspaceId: string;
  brandKit: AdStudioBrandKit;
  goal: AdStudioGoal;
  suburb: string;
  city: string;
  state: string;
  offerId: string;
  platforms: AdStudioPlatform[];
  creativeFormats?: AdStudioFormat[];
  variantCount?: number;
};

const DEFAULT_FORMATS: AdStudioFormat[] = ["1:1", "4:5", "9:16", "1.91:1"];

const ANGLES = [
  {
    label: "Preparation mistakes",
    headline: "Before you list, fix these 10 things",
    copy: "Use this checklist before photos, opens, or price discussions.",
    notes: ["Strong seller intent", "Clear checklist CTA", "No blocking compliance issues"],
  },
  {
    label: "Helpful local advisor",
    headline: "Seller checklist for local homeowners",
    copy: "A practical guide for owners planning their next move.",
    notes: ["Low-friction education offer", "Good brand fit"],
  },
  {
    label: "Buyer perception",
    headline: "Small prep can improve buyer interest",
    copy: "See the tasks sellers often handle before going live.",
    notes: ["Problem-aware hook", "Careful claim wording"],
  },
  {
    label: "Low-friction CTA",
    headline: "Selling soon? Start with this checklist",
    copy: "Get a simple pre-sale checklist before you organise your campaign.",
    notes: ["Simple CTA", "Good for broad audiences"],
  },
  {
    label: "Local market confidence",
    headline: "Plan your sale with local context",
    copy: "Use recent activity and preparation steps to make a calmer plan.",
    notes: ["Local relevance", "Good nurture bridge"],
  },
];

export function generateAdStudioCampaignPack(input: GenerateCampaignPackInput): AdStudioCampaignPack {
  if (input.brandKit.reviewStatus !== "approved") {
    throw new Error("Brand kit must be approved before campaign generation.");
  }

  const offer = getOfferTemplate(input.offerId);
  const formats = input.creativeFormats ?? DEFAULT_FORMATS;
  const campaignId = deterministicUuid(`${input.workspaceId}:${input.offerId}:${input.suburb}`);
  const campaign: AdStudioCampaign = {
    campaignId,
    workspaceId: input.workspaceId,
    brandKitId: input.brandKit.brandKitId,
    name: `${input.suburb} ${offer.name}`,
    goal: input.goal,
    market: {
      country: "AU",
      state: input.state,
      city: input.city,
      suburb: input.suburb,
    },
    audienceIntent: offer.expectedLeadIntent,
    offerId: offer.offerId,
    platforms: input.platforms,
    creativeFormats: formats,
    status: "ready",
  };
  const variantCount = Math.max(1, Math.min(input.variantCount ?? 5, 8));
  const variants = ANGLES.slice(0, variantCount).map((angle, index): AdStudioCampaignVariant => {
    const complianceSafety = angle.headline.includes("improve") ? 18 : 20;
    const score = scoreAdStudioVariant({
      offerClarity: index === 0 ? 20 : 18,
      localRelevance: 13 + (index % 2),
      leadIntentStrength: index === 0 ? 20 : 17,
      brandFit: 13,
      complianceSafety,
      visualHierarchy: index === 0 ? 9 : 8,
      notes: angle.notes,
      warnings: complianceSafety < 20 ? ["Keep performance wording conservative."] : [],
    });

    return {
      variantId: deterministicUuid(`${campaignId}:${angle.label}`),
      campaignId,
      angle: angle.label,
      headline: localizeHeadline(angle.headline, input.suburb),
      offer: offer.name,
      cta: offer.defaultCta,
      score,
      status: index === 0 ? "approved" : "draft",
      lockedFields: [],
    };
  });
  const copyPacks = variants.map((variant) => buildCopyPack({ campaign, variant, brandKit: input.brandKit }));
  const creatives = variants.flatMap((variant) =>
    formats.map((format) => buildCreative({ campaign, variant, brandKit: input.brandKit, format })),
  );
  const compliance = runAdStudioComplianceReview({ campaign, copyPacks });

  return {
    brandKit: input.brandKit,
    campaign: {
      ...campaign,
      status: compliance.status === "blocked" ? "blocked" : "ready",
    },
    variants,
    creatives,
    copyPacks,
    compliance,
  };
}

function buildCopyPack(input: {
  campaign: AdStudioCampaign;
  variant: AdStudioCampaignVariant;
  brandKit: AdStudioBrandKit;
}): AdStudioPlatformCopyPack {
  const privacyUrl = input.brandKit.compliance.privacyPolicyUrl ?? `${input.brandKit.source.url}/privacy`;
  const suburb = input.campaign.market.suburb;
  const finalUrl = `${input.brandKit.source.url}/seller-checklist`;
  const primary = `Thinking about selling in ${suburb}? Download the ${input.variant.offer.toLowerCase()} before photos, open homes, or price discussions.`;
  const meta: MetaLeadAdPack = {
    platform: "meta",
    specialAdCategory: "housing",
    primaryText: [primary],
    headlines: [shorten(`${suburb} seller checklist`, 40), "Before you list, start here", "Free seller prep guide"],
    descriptions: ["Free checklist for local sellers."],
    cta: "LEARN_MORE",
    leadForm: {
      headline: "Get the seller checklist",
      questions: ["What suburb is your property in?", "When are you considering selling?", "Would you like a local price update?"],
      privacyPolicyUrl: privacyUrl,
      thankYouScreen: {
        title: "Your checklist is on the way",
        body: `${input.brandKit.identity.businessName} may send practical local selling tips.`,
      },
    },
  };
  const googleSearch: GoogleSearchPack = {
    platform: "google_search",
    finalUrl,
    headlines: [
      "Seller Checklist",
      "Selling Soon?",
      "Home Sale Guide",
      "Prep Before Listing",
      "Local Seller Guide",
      "Property Checklist",
    ],
    descriptions: [
      `Download a practical checklist before selling in ${suburb}.`,
      "Plan photos, opens and preparation with a simple guide.",
      "Get local selling tips before you start your campaign.",
    ],
    paths: ["sell", slugPath(suburb)],
    keywords: [`sell house ${suburb}`, `real estate appraisal ${suburb}`, `${suburb} seller guide`],
    negativeKeywords: ["jobs", "course", "rental"],
  };
  const googlePmax = buildGoogleAssetPack("google_pmax", input.brandKit, finalUrl, suburb);
  const googleDemandGen = buildGoogleAssetPack("google_demand_gen", input.brandKit, finalUrl, suburb);

  return {
    copyPackId: deterministicUuid(`copypack:${input.variant.variantId}`),
    campaignId: input.campaign.campaignId,
    variantId: input.variant.variantId,
    meta,
    googleSearch,
    googlePmax,
    googleDemandGen,
    landingPage: {
      headline: `${suburb} seller checklist`,
      subheadline: "Get a practical preparation guide before you organise photos, opens, or price discussions.",
      cta: "Download checklist",
    },
    followUp: {
      sms: [
        `Thanks for requesting the ${suburb} seller checklist. I can send a local price update if useful.`,
        "A quick tip: preparation usually starts before photos are booked. Reply if you want the timeline.",
      ],
      email: [
        {
          subject: `Your ${suburb} seller checklist`,
          body: "Here is the checklist. Use it as a practical starting point, then seek property-specific advice when you are ready.",
        },
        {
          subject: "Planning your next step",
          body: "If you are comparing renovate, hold, or sell options, a local appraisal can help you understand current conditions.",
        },
      ],
    },
    lockedFields: [],
  };
}

function buildGoogleAssetPack(
  platform: "google_pmax" | "google_demand_gen",
  brandKit: AdStudioBrandKit,
  finalUrl: string,
  suburb: string,
): GoogleAssetPack {
  return {
    platform,
    businessName: brandKit.identity.businessName,
    finalUrl,
    headlines: ["Seller checklist", "Selling soon?", "Plan before listing"],
    longHeadlines: [`Download the ${suburb} seller preparation checklist`],
    descriptions: ["A practical guide for homeowners thinking about selling.", "Prepare before photos, opens, or price discussions."],
    images: {
      landscape_1_91: ["landscape_1_91.svg"],
      square_1_1: ["square_1_1.svg"],
      portrait_4_5: ["portrait_4_5.svg"],
      vertical_9_16: ["vertical_9_16.svg"],
    },
    logos: {
      square: [brandKit.logos.faviconUrl ?? "logo-square.svg"],
      landscape: [brandKit.logos.primaryLogoUrl ?? "logo-landscape.svg"],
    },
  };
}

function buildCreative(input: {
  campaign: AdStudioCampaign;
  variant: AdStudioCampaignVariant;
  brandKit: AdStudioBrandKit;
  format: AdStudioFormat;
}): AdStudioCreative {
  const size = getCanvasSize(input.format);
  const headlineSize = input.format === "9:16" ? 68 : input.format === "1.91:1" ? 48 : 62;
  const creativeBase: Omit<AdStudioCreative, "previewSvg"> = {
    creativeId: deterministicUuid(`${input.variant.variantId}:${input.format}`),
    campaignId: input.campaign.campaignId,
    variantId: input.variant.variantId,
    format: input.format,
    canvas: {
      ...size,
      backgroundAssetId: `background_${input.variant.variantId}`,
      objects: [
        {
          objectId: "background",
          type: "shape",
          role: "background_shape",
          x: 0,
          y: 0,
          width: size.width,
          height: size.height,
          fill: input.brandKit.colours.secondary,
          locked: true,
        },
        {
          objectId: "headline",
          type: "text",
          role: "headline",
          content: input.variant.headline,
          x: Math.round(size.width * 0.08),
          y: Math.round(size.height * 0.18),
          width: Math.round(size.width * 0.72),
          font: "brand_heading",
          size: headlineSize,
          fill: input.brandKit.colours.text,
          locked: false,
        },
        {
          objectId: "subhead",
          type: "text",
          role: "subheadline",
          content: `Download the ${input.campaign.market.suburb} seller prep checklist.`,
          x: Math.round(size.width * 0.08),
          y: Math.round(size.height * 0.29),
          width: Math.round(size.width * 0.68),
          font: "brand_body",
          size: Math.max(28, Math.round(headlineSize * 0.42)),
          fill: input.brandKit.colours.text,
          locked: false,
        },
        {
          objectId: "cta",
          type: "shape",
          role: "cta_button",
          content: input.variant.cta,
          x: Math.round(size.width * 0.08),
          y: Math.round(size.height * 0.41),
          width: 260,
          height: 78,
          fill: input.brandKit.colours.primary,
          locked: false,
        },
        {
          objectId: "cta_text",
          type: "text",
          role: "cta_text",
          content: input.variant.cta,
          x: Math.round(size.width * 0.1),
          y: Math.round(size.height * 0.41 + 50),
          width: 220,
          font: "brand_body",
          size: 28,
          fill: "#FFFFFF",
          locked: false,
        },
        {
          objectId: "agent_headshot",
          type: "image",
          role: "agent_headshot",
          assetId: input.brandKit.assets.headshots[0] ?? undefined,
          x: Math.round(size.width * 0.72),
          y: Math.round(size.height * 0.66),
          width: Math.round(size.width * 0.18),
          height: Math.round(size.width * 0.18),
          locked: false,
        },
        {
          objectId: "brand_logo",
          type: "logo",
          role: "brand_logo",
          assetId: input.brandKit.logos.primaryLogoUrl ?? undefined,
          x: Math.round(size.width * 0.08),
          y: Math.round(size.height * 0.88),
          width: 180,
          height: 64,
          locked: true,
        },
      ],
    },
    safeZones: {
      metaStory: input.format === "9:16",
      googleDemandGen: input.format !== "1.91:1",
    },
  };

  return {
    ...creativeBase,
    previewSvg: renderCreativeSvg(creativeBase),
  };
}

function localizeHeadline(headline: string, suburb: string): string {
  if (/local homeowners/i.test(headline)) {
    return headline.replace(/local homeowners/i, `${suburb} homeowners`);
  }

  return headline;
}

function shorten(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit - 1).trimEnd();
}

function slugPath(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 15);
}
