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

type DefaultCreativeMessage = {
  label: string;
  headline: string;
  primaryText: string;
  description: string;
  notes: string[];
};

type OfferCopySeed = {
  finalUrl: string;
  urlPath: string;
  metaHeadlines: string[];
  metaDescriptions: string[];
  googleHeadlines: string[];
  googleDescriptions: string[];
  keywords: string[];
  leadFormHeadline: string;
  leadFormQuestions: string[];
  thankYouTitle: string;
  thankYouBody: string;
  landingHeadline: string;
  landingSubheadline: string;
  landingCta: string;
  followUpSms: string[];
  followUpEmail: Array<{ subject: string; body: string }>;
  assetLongHeadline: string;
};

const FALLBACK_FORMATS: AdStudioFormat[] = ["1:1", "4:5", "9:16", "1.91:1"];
const FIRST_AD_FORMATS: AdStudioFormat[] = ["9:16", "4:5", "1:1"];

export function generateAdStudioCampaignPack(input: GenerateCampaignPackInput): AdStudioCampaignPack {
  if (input.brandKit.reviewStatus !== "approved") {
    throw new Error("Brand kit must be approved before campaign generation.");
  }

  const template = input.firstAd?.mode === "template" ? resolveAdStudioTemplate(input.firstAd.templateId) : null;
  const requestedOfferId = template?.offerId ?? inferOfferIdFromFirstAd(input.firstAd?.description, input.offerId);
  const offer = getOfferTemplate(requestedOfferId);
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
  const messages = input.firstAd
    ? buildFirstAdMessages(template, offer.offerId, input.suburb)
    : buildFallbackMessages(offer.offerId, input.suburb);
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
  const copyPacks = variants.map((variant, index) =>
    buildCopyPack({
      campaign,
      variant,
      brandKit: input.brandKit,
      message: messages[index] ?? messages[0]!,
    }),
  );
  const sourceImageDataUrl = input.sourceImageDataUrl ?? input.firstAd?.imageDataUrl;
  const creatives = variants.flatMap((variant, index) =>
    formats.map((format) => buildCreative({
      campaign,
      variant,
      brandKit: input.brandKit,
      format,
      sourceImageDataUrl,
      subheadline: copyPacks[index]?.landingPage.subheadline ?? messages[index]?.description,
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

function inferOfferIdFromFirstAd(description: string | undefined, fallbackOfferId: string): string {
  const brief = description?.toLowerCase() ?? "";

  if (!brief) return fallbackOfferId;
  if (/\b(open home|home open|inspection|inspect)\b/.test(brief)) return "open_home_followup";
  if (/\b(just sold|sold|auction result|sale result)\b/.test(brief)) return "recent_sales_report";
  if (/\b(market update|market report|suburb report|market snapshot)\b/.test(brief)) return "suburb_market_report";
  if (/\b(appraisal|price update|home value|property value|worth)\b/.test(brief)) return "home_value_update";
  if (/\b(renovate|as-is|as is)\b/.test(brief)) return "renovate_or_sell";
  if (/\b(auction|private treaty)\b/.test(brief)) return "auction_vs_private_treaty";
  if (/\b(mistake|cost sellers)\b/.test(brief)) return "seller_mistakes_guide";
  if (/\b(timeline|pre-listing|prelisting)\b/.test(brief)) return "prelisting_timeline";

  return fallbackOfferId;
}

function buildFallbackMessages(offerId: string, suburb: string): DefaultCreativeMessage[] {
  if (/home_value_update|appraisal/.test(offerId)) {
    return [
      {
        label: "Price clarity",
        headline: "What could your home be worth?",
        primaryText: `Get a practical price update for your ${suburb} property before you decide what to do next.`,
        description: "A local price update without the sales pressure.",
        notes: ["High-intent appraisal offer", "Clear owner benefit", "No blocking compliance issues"],
      },
      {
        label: "Next-move planning",
        headline: "Plan your next property move",
        primaryText: `Thinking through your next move in ${suburb}? Start with current local context and a practical price update.`,
        description: "Useful context before you renovate, hold, or sell.",
        notes: ["Decision-support angle", "Local relevance", "No blocking compliance issues"],
      },
      {
        label: "Local context",
        headline: "Get a clearer local view",
        primaryText: `See how local activity around ${suburb} may shape your options before you make property plans.`,
        description: "Local context for owners weighing their options.",
        notes: ["Plain-language positioning", "Broad audience fit"],
      },
      {
        label: "Renovate or sell",
        headline: "Renovate, hold, or sell?",
        primaryText: `Before you choose a path for your ${suburb} property, start with a practical local price update.`,
        description: "A useful first step before bigger property decisions.",
        notes: ["Decision-support angle", "High-intent owner action"],
      },
      {
        label: "Calm appraisal CTA",
        headline: "Start with a local price update",
        primaryText: `Get a clearer view of your ${suburb} property before photos, renovations, or campaign decisions.`,
        description: "Practical local context before you make plans.",
        notes: ["Simple CTA", "Low-pressure positioning"],
      },
    ];
  }

  if (/recent_sales_report|market_report|suburb_market_report|snapshot/.test(offerId)) {
    return [
      {
        label: "Recent sales context",
        headline: "See recent local sales",
        primaryText: `See recent local sales around ${suburb} before you decide what to do next with your property.`,
        description: "Recent sales context for local owners.",
        notes: ["Evidence-led hook", "Local relevance", "No blocking compliance issues"],
      },
      {
        label: "Market signal",
        headline: "Read the local market faster",
        primaryText: `${suburb} market activity is easier to read with the right context. Get a plain-English local update.`,
        description: "A simple local update before you make plans.",
        notes: ["Useful market education", "Good nurture bridge"],
      },
      {
        label: "Owner confidence",
        headline: "Make property plans with context",
        primaryText: `Before you renovate, hold, or sell, get a clearer view of recent activity around ${suburb}.`,
        description: "Local property context without the guesswork.",
        notes: ["Decision-support angle", "No hype"],
      },
      {
        label: "Comparable sales",
        headline: "Compare recent local activity",
        primaryText: `Recent sales around ${suburb} can give owners a better starting point before the next property decision.`,
        description: "A practical read on recent local activity.",
        notes: ["Evidence-led positioning", "Local owner relevance"],
      },
      {
        label: "Plain-English report",
        headline: "A simpler local property update",
        primaryText: `Get the ${suburb} property context that matters before you make plans around timing, value, or preparation.`,
        description: "Plain-English property context for local owners.",
        notes: ["Clear report CTA", "Broad audience fit"],
      },
    ];
  }

  if (/open_home/.test(offerId)) {
    return [
      {
        label: "Inspection follow-up",
        headline: "Know what to ask after inspection",
        primaryText: "Get a simple follow-up guide before your next inspection, enquiry, or offer conversation.",
        description: "Practical next steps after a property inspection.",
        notes: ["Inspection-intent angle", "Clear follow-up CTA", "No blocking compliance issues"],
      },
      {
        label: "Buyer next steps",
        headline: "After the open home, start here",
        primaryText: "Use a plain-English checklist to compare the property, clarify questions, and plan your next step.",
        description: "A simple guide for the next property conversation.",
        notes: ["Helpful buyer education", "Broad audience fit"],
      },
      {
        label: "Property questions",
        headline: "Bring better questions",
        primaryText: "Before you follow up on a property, get the questions worth asking about timing, terms, and next steps.",
        description: "Inspect and enquire with clearer next steps.",
        notes: ["Useful inspection prep", "No pressure language"],
      },
      {
        label: "Inspection comparison",
        headline: "Compare the home more clearly",
        primaryText: "Use a simple guide to compare the property, note follow-up questions, and decide what to clarify next.",
        description: "A clearer way to compare property details.",
        notes: ["Buyer education angle", "Practical next step"],
      },
      {
        label: "Follow-up confidence",
        headline: "Plan your property follow-up",
        primaryText: "After an inspection, organise your questions around condition, timing, terms, and next steps.",
        description: "Simple follow-up prompts after inspection.",
        notes: ["Helpful follow-up CTA", "No pressure language"],
      },
    ];
  }

  return [
    {
      label: "Preparation gap",
      headline: "Avoid costly seller prep gaps",
      primaryText: `Before you list in ${suburb}, get a practical prep checklist that helps you spot jobs, questions, and timing choices early.`,
      description: "Spot the prep work worth sorting before photos and opens.",
      notes: ["Strong seller intent", "Clear checklist CTA", "No blocking compliance issues"],
    },
    {
      label: "Seller clarity",
      headline: "Know what to sort before you list",
      primaryText: `Planning a sale in ${suburb}? Use a simple checklist to make the first steps clearer before your campaign begins.`,
      description: "A calmer starting point for local sellers.",
      notes: ["Low-friction education offer", "Good brand fit"],
    },
    {
      label: "Buyer perception",
      headline: "Make the first impression count",
      primaryText: "See the practical tasks sellers often handle before photos, open homes, and price conversations.",
      description: "Prepare the basics before your campaign goes live.",
      notes: ["Problem-aware hook", "Careful claim wording"],
    },
    {
      label: "Low-friction CTA",
      headline: "Selling soon? Start here",
      primaryText: `Get the ${suburb} seller prep checklist before you organise photos, opens, or price discussions.`,
      description: "A practical pre-sale checklist for local owners.",
      notes: ["Simple CTA", "Good for broad audiences"],
    },
    {
      label: "Local planning",
      headline: "Plan your sale with context",
      primaryText: `Use local context and a practical preparation list to make a calmer plan for selling in ${suburb}.`,
      description: "Local seller preparation without the overwhelm.",
      notes: ["Local relevance", "Good nurture bridge"],
    },
  ];
}

function buildFirstAdMessages(
  template: AdStudioTemplate | null,
  offerId: string,
  suburb: string,
): DefaultCreativeMessage[] {
  if (!template) {
    return buildFallbackMessages(offerId, suburb)
      .slice(0, 3)
      .map((message) => ({
        ...message,
        notes: ["Uses uploaded image", ...message.notes],
      }));
  }

  return [
    {
      label: template.name,
      headline: templateHeroHeadline(template.name),
      primaryText: templatePrimaryText(template, suburb),
      description: templateDescription(template.name),
      notes: ["Template selected", "Uses uploaded image", "No blocking compliance issues"],
    },
    {
      label: `${template.name} local`,
      headline: localTemplateHeadline(template.name),
      primaryText: localTemplatePrimaryText(template, suburb),
      description: "Useful local context before the next step.",
      notes: ["Local relevance", "Plain-language positioning", "No blocking compliance issues"],
    },
    {
      label: `${template.name} simple`,
      headline: simpleTemplateHeadline(template.name),
      primaryText: simpleTemplatePrimaryText(template, suburb),
      description: "A simple next step without the hard sell.",
      notes: ["Simple CTA", "Broad audience fit", "No blocking compliance issues"],
    },
  ];
}

function templateHeroHeadline(templateName: string): string {
  if (/appraisal|price/i.test(templateName)) return "What could your home be worth?";
  if (/open home/i.test(templateName)) return "See this home this weekend";
  if (/sold/i.test(templateName)) return "What did this sale show?";
  if (/coming soon/i.test(templateName)) return "A local home worth watching";
  if (/market/i.test(templateName)) return "Your local market, made simple";
  if (/checklist/i.test(templateName)) return "Avoid costly seller prep gaps";
  if (/buyer demand/i.test(templateName)) return "Get a clearer local view";
  return "A fresh local listing to watch";
}

function localTemplateHeadline(templateName: string): string {
  if (/appraisal|price/i.test(templateName)) return "A clearer view of your home's value";
  if (/open home/i.test(templateName)) return "Open-home questions to ask";
  if (/sold/i.test(templateName)) return "Curious what your home could achieve?";
  if (/market/i.test(templateName)) return "Read the local market faster";
  if (/checklist/i.test(templateName)) return "Know what to sort before you list";
  return `${templateName} in your area`;
}

function simpleTemplateHeadline(templateName: string): string {
  if (/checklist/i.test(templateName)) return "Start with a seller checklist";
  if (/buyer demand/i.test(templateName)) return "Plan with local context";
  if (/just listed|new to market/i.test(templateName)) return "A fresh local listing to watch";
  if (/open home/i.test(templateName))