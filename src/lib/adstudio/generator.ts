import { runAdStudioComplianceReview } from "./compliance.ts";
import { deterministicUuid } from "./id.ts";
import { getOfferTemplate } from "./offers.ts";
import { getCanvasSize, renderCreativeSvg } from "./renderer.ts";
import { scoreAdStudioVariant } from "./scoring.ts";
import { resolveAdStudioTemplate, type AdStudioTemplate } from "./templates.ts";
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
  FirstAdInput,
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
  firstAd?: FirstAdInput;
  sourceImageDataUrl?: string;
};

const FALLBACK_FORMATS: AdStudioFormat[] = ["1:1", "4:5", "9:16", "1.91:1"];
const FIRST_AD_FORMATS: AdStudioFormat[] = ["9:16", "4:5", "1:1"];

const FALLBACK_MESSAGES = [
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

  const template = input.firstAd ? resolveAdStudioTemplate(input.firstAd.templateId) : null;
  const offer = getOfferTemplate(template?.offerId ?? input.offerId);
  const formats = input.firstAd ? [...FIRST_AD_FORMATS] : (input.creativeFormats ?? FALLBACK_FORMATS);
  const campaignId = deterministicUuid(`${input.workspaceId}:${offer.offerId}:${input.suburb}:${input.firstAd?.description ?? ""}`);
  const campaign: AdStudioCampaign = {
    campaignId,
    workspaceId: input.workspaceId,
    brandKitId: input.brandKit.brandKitId,
    name: input.firstAd && template ? `${input.suburb} ${template.name}` : `${input.suburb} ${offer.name}`,
    goal: template?.goal ?? input.goal,
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
  const messages = input.firstAd && template
    ? buildFirstAdMessages(template, input.firstAd.description)
    : FALLBACK_MESSAGES;
  const variantCount = Math.max(1, Math.min(input.variantCount ?? messages.length, 8));
  const variants = messages.slice(0, variantCount).map((message, index): AdStudioCampaignVariant => {
    const complianceSafety = message.headline.includes("improve") ? 18 : 20;
    const score = scoreAdStudioVariant({
      offerClarity: index === 0 ? 20 : 18,
      localRelevance: 13 + (index % 2),
      leadIntentStrength: index === 0 ? 20 : 17,
      brandFit: 13,
      complianceSafety,
      visualHierarchy: index === 0 ? 9 : 8,
      notes: message.notes,
      warnings: complianceSafety < 20 ? ["Keep performance wording conservative."] : [],
    });

    return {
      variantId: deterministicUuid(`${campaignId}:${message.label}`),
      campaignId,
      angle: message.label,
      headline: localizeHeadline(message.headline, input.suburb),
      offer: offer.name,
      cta: offer.defaultCta,
      score,
      status: index === 0 ? "approved" : "draft",
      lockedFields: [],
    };
  });
  const copyPacks = variants.map((variant) => buildCopyPack({ campaign, variant, brandKit: input.brandKit }));
  const sourceImageDataUrl = input.sourceImageDataUrl ?? input.firstAd?.imageDataUrl;
  const creatives = variants.flatMap((variant) =>
    formats.map((format) => buildCreative({
      campaign,
      variant,
      brandKit: input.brandKit,
      format,
      sourceImageDataUrl,
    })),
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

function buildFirstAdMessages(template: AdStudioTemplate, description: string) {
  const trimmed = description.trim();
  const shortDescription = shorten(trimmed, 64);
  return [
    {
      label: template.name,
      headline: shortDescription || template.name,
      copy: trimmed || template.promptHint,
      notes: ["Template selected", "Uses the uploaded brief", "No blocking compliance issues"],
    },
    {
      label: `${template.name} local`,
      headline: localTemplateHeadline(template.name),
      copy: template.promptHint,
      notes: ["Local relevance", "Plain-language positioning", "No blocking compliance issues"],
    },
    {
      label: `${template.name} simple`,
      headline: simpleTemplateHeadline(template.name),
      copy: trimmed || template.promptHint,
      notes: ["Simple CTA", "Broad audience fit", "No blocking compliance issues"],
    },
  ];
}

function localTemplateHeadline(templateName: string): string {
  if (/appraisal|price/i.test(templateName)) return "A clearer view of your home's value";
  if (/open home/i.test(templateName)) return "See this home this weekend";
  if (/sold/i.test(templateName)) return "Curious what your home could achieve?";
  if (/market/i.test(templateName)) return "Your local market, made simple";
  return `${templateName} in your area`;
}

function simpleTemplateHeadline(templateName: string): string {
  if (/checklist/i.test(templateName)) return "Start with a simple seller checklist";
  if (/buyer demand/i.test(templateName)) return "Buyer interest can start close to home";
  if (/just listed|new to market/i.test(templateName)) return "A fresh local listing to watch";
  return `Start with ${templateName.toLowerCase()}`;
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
  sourceImageDataUrl?: string;
}): AdStudioCreative {
  const size = getCanvasSize(input.format);
  const isStory = input.format === "9:16";
  const isLandscape = input.format === "1.91:1";
  const marginX = Math.round(size.width * (isLandscape ? 0.07 : 0.08));
  const copyWidth = Math.round(size.width * (isLandscape ? 0.55 : 0.76));
  const headlineSize = isStory ? 70 : isLandscape ? 50 : 64;
  const headlineY = Math.round(size.height * (isStory ? 0.53 : isLandscape ? 0.32 : 0.5));
  const subheadY = headlineY + Math.round(headlineSize * (isLandscape ? 1.55 : 1.8));
  const ctaHeight = isLandscape ? 66 : 78;
  const ctaY = Math.min(
    Math.round(size.height * (isStory ? 0.76 : isLandscape ? 0.66 : 0.73)),
    size.height - Math.round(size.height * (isStory ? 0.18 : 0.08)) - ctaHeight,
  );
  const ctaWidth = Math.min(Math.round(size.width * (isLandscape ? 0.28 : 0.36)), 360);
  const logoWidth = isLandscape ? 164 : 180;
  const logoHeight = isLandscape ? 58 : 64;
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
          objectId: "primary_image",
          type: "image",
          role: "primary_image",
          content: input.sourceImageDataUrl,
          assetId: input.sourceImageDataUrl ? undefined : input.brandKit.assets.listingImages[0] ?? input.brandKit.assets.headshots[0] ?? undefined,
          x: 0,
          y: 0,
          width: size.width,
          height: size.height,
          locked: false,
        },
        {
          objectId: "image_scrim",
          type: "shape",
          role: "image_scrim",
          x: 0,
          y: 0,
          width: size.width,
          height: size.height,
          fill: "rgba(7, 14, 25, 0.48)",
          locked: true,
        },
        {
          objectId: "headline",
          type: "text",
          role: "headline",
          content: input.variant.headline,
          x: marginX,
          y: headlineY,
          width: copyWidth,
          font: "brand_heading",
          size: headlineSize,
          fill: "#FFFFFF",
          locked: false,
        },
        {
          objectId: "subhead",
          type: "text",
          role: "subheadline",
          content: `Download the ${input.campaign.market.suburb} seller prep checklist.`,
          x: marginX,
          y: subheadY,
          width: Math.round(copyWidth * 0.9),
          font: "brand_body",
          size: Math.max(28, Math.round(headlineSize * 0.42)),
          fill: "#FFFFFF",
          locked: false,
        },
        {
          objectId: "cta",
          type: "shape",
          role: "cta_button",
          content: input.variant.cta,
          x: marginX,
          y: ctaY,
          width: ctaWidth,
          height: ctaHeight,
          fill: input.brandKit.colours.primary,
          locked: false,
        },
        {
          objectId: "cta_text",
          type: "text",
          role: "cta_text",
          content: input.variant.cta,
          x: marginX + Math.round(ctaWidth * 0.08),
          y: ctaY + Math.round(ctaHeight * 0.31),
          width: Math.round(ctaWidth * 0.84),
          font: "brand_body",
          size: isLandscape ? 24 : 28,
          fill: "#FFFFFF",
          locked: false,
        },
        {
          objectId: "brand_logo",
          type: "logo",
          role: "brand_logo",
          content: input.brandKit.identity.tradingName || input.brandKit.identity.businessName,
          assetId: input.brandKit.logos.primaryLogoUrl ?? undefined,
          x: marginX,
          y: Math.round(size.height * (isLandscape ? 0.08 : 0.07)),
          width: logoWidth,
          height: logoHeight,
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
    previewSvg: renderCreativeSvg(creativeBase, input.brandKit),
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
