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
  if (/open home/i.test(templateName)) return "After the open home, start here";
  return `Start with ${templateName.toLowerCase()}`;
}

function templatePrimaryText(template: AdStudioTemplate, suburb: string): string {
  const name = template.name;
  if (/just listed|new to market/i.test(name)) {
    return `A fresh ${suburb} listing can help local owners read the market. See the details, then request a local price update.`;
  }
  if (/coming soon/i.test(name)) {
    return `A new ${suburb} campaign is close. Follow the launch and get local context if you are weighing your next move.`;
  }
  if (/open home/i.test(name)) {
    return "Planning to inspect? Get the key details and a simple follow-up path before your next property conversation.";
  }
  if (/sold/i.test(name)) {
    return `A recent ${suburb} sale can be useful context. See the result, then request a practical local price update.`;
  }
  if (/appraisal|price|free appraisal/i.test(name)) {
    return `Get a practical price update for your ${suburb} property before you decide what to do next.`;
  }
  if (/market/i.test(name)) {
    return `${suburb} market activity is easier to read with local context. Get a plain-English update before you make plans.`;
  }
  if (/buyer demand/i.test(name)) {
    return `See local enquiry context for ${suburb} without the hype, then request a practical price update.`;
  }
  return `Before you list in ${suburb}, get a practical prep checklist that helps you spot the right next steps early.`;
}

function localTemplatePrimaryText(template: AdStudioTemplate, suburb: string): string {
  if (/open home/i.test(template.name)) {
    return "Use a plain-English checklist to compare the property, clarify questions, and plan your next step.";
  }
  if (/sold|market|listed|coming soon|new to market/i.test(template.name)) {
    return `Use current ${suburb} activity as context before you make property plans.`;
  }
  return `Start with local ${suburb} context and a practical next step before you commit to a campaign.`;
}

function simpleTemplatePrimaryText(template: AdStudioTemplate, suburb: string): string {
  if (/open home/i.test(template.name)) {
    return "Get the questions worth asking before your next inspection, enquiry, or offer conversation.";
  }
  if (/appraisal|price/i.test(template.name)) {
    return `Request a local price update for your ${suburb} property without the hard sell.`;
  }
  return `Get a simple local guide before you make the next property decision in ${suburb}.`;
}

function templateDescription(templateName: string): string {
  if (/open home/i.test(templateName)) return "Inspect with clearer next steps.";
  if (/sold|market|listed|coming soon|new to market/i.test(templateName)) return "Local context before you make plans.";
  if (/appraisal|price/i.test(templateName)) return "A practical local price update.";
  return "A practical guide for the next property step.";
}

function buildCopyPack(input: {
  campaign: AdStudioCampaign;
  variant: AdStudioCampaignVariant;
  brandKit: AdStudioBrandKit;
  message: DefaultCreativeMessage;
}): AdStudioPlatformCopyPack {
  const privacyUrl = input.brandKit.compliance.privacyPolicyUrl ?? `${input.brandKit.source.url}/privacy`;
  const seed = buildOfferCopySeed(input);
  const meta: MetaLeadAdPack = {
    platform: "meta",
    specialAdCategory: "housing",
    primaryText: [shorten(input.message.primaryText, 125)],
    headlines: seed.metaHeadlines,
    descriptions: seed.metaDescriptions,
    cta: metaCtaFromLabel(input.variant.cta),
    leadForm: {
      headline: seed.leadFormHeadline,
      questions: seed.leadFormQuestions,
      privacyPolicyUrl: privacyUrl,
      thankYouScreen: {
        title: seed.thankYouTitle,
        body: seed.thankYouBody,
      },
    },
  };
  const googleSearch: GoogleSearchPack = {
    platform: "google_search",
    finalUrl: seed.finalUrl,
    headlines: seed.googleHeadlines,
    descriptions: seed.googleDescriptions,
    paths: [seed.urlPath, slugPath(input.campaign.market.suburb)],
    keywords: seed.keywords,
    negativeKeywords: ["jobs", "course", "rental"],
  };
  const googlePmax = buildGoogleAssetPack("google_pmax", input.brandKit, seed);
  const googleDemandGen = buildGoogleAssetPack("google_demand_gen", input.brandKit, seed);

  return {
    copyPackId: deterministicUuid(`copypack:${input.variant.variantId}`),
    campaignId: input.campaign.campaignId,
    variantId: input.variant.variantId,
    meta,
    googleSearch,
    googlePmax,
    googleDemandGen,
    landingPage: {
      headline: seed.landingHeadline,
      subheadline: seed.landingSubheadline,
      cta: seed.landingCta,
    },
    followUp: {
      sms: seed.followUpSms,
      email: seed.followUpEmail,
    },
    lockedFields: [],
  };
}

function buildOfferCopySeed(input: {
  campaign: AdStudioCampaign;
  variant: AdStudioCampaignVariant;
  brandKit: AdStudioBrandKit;
  message: DefaultCreativeMessage;
}): OfferCopySeed {
  const suburb = input.campaign.market.suburb;
  const businessName = input.brandKit.identity.tradingName || input.brandKit.identity.businessName;
  const offerId = input.campaign.offerId;
  const finalUrl = appendPath(input.brandKit.source.url, landingPathForOffer(offerId));
  const headline = input.variant.headline;
  const description = input.message.description;

  if (/home_value_update|appraisal/.test(offerId)) {
    return {
      finalUrl,
      urlPath: "value",
      metaHeadlines: uniqueShort([headline, "Request a price update", "Get local property context"], 40, 3),
      metaDescriptions: uniqueShort([description, "A practical local price update."], 90, 2),
      googleHeadlines: uniqueShort([
        "Home Value Update",
        "Property Price Update",
        "Local Price Update",
        "House Appraisal",
        `${suburb} Appraisal`,
        "Know Before You Sell",
      ], 30, 6),
      googleDescriptions: uniqueShort([
        `Request a practical price update for your ${suburb} property.`,
        "Get local context before you decide whether to renovate, hold, or sell.",
        "Plain-English property guidance from a local agency.",
      ], 90, 3),
      keywords: [`real estate appraisal ${suburb}`, `property value ${suburb}`, `house appraisal ${suburb}`],
      leadFormHeadline: "Request a price update",
      leadFormQuestions: ["What suburb is your property in?", "What type of property is it?", "When would you like an update?"],
      thankYouTitle: "Your request is in",
      thankYouBody: `${businessName} may follow up with practical local price context.`,
      landingHeadline: `${suburb} price update`,
      landingSubheadline: "Get practical local context before you decide whether to renovate, hold, or sell.",
      landingCta: input.variant.cta,
      followUpSms: [
        `Thanks for requesting a ${suburb} price update. I can send the next steps if useful.`,
        "A useful first step is comparing recent local activity with your property's condition.",
      ],
      followUpEmail: [
        {
          subject: `Your ${suburb} price update request`,
          body: "Thanks for getting in touch. I will share practical local context and the next steps for a property-specific update.",
        },
        {
          subject: "A useful comparison point",
          body: "Before making plans, compare recent local activity with your property condition, timing, and goals.",
        },
      ],
      assetLongHeadline: `Request a practical ${suburb} property price update`,
    };
  }

  if (/recent_sales_report|market_report|suburb_market_report|snapshot/.test(offerId)) {
    const marketReport = /market|snapshot/.test(offerId);
    return {
      finalUrl,
      urlPath: marketReport ? "market" : "sales",
      metaHeadlines: uniqueShort([headline, marketReport ? "Get the market update" : "See recent local sales", "Local property context"], 40, 3),
      metaDescriptions: uniqueShort([description, marketReport ? "A plain-English local market update." : "Recent sales context for local owners."], 90, 2),
      googleHeadlines: uniqueShort([
        marketReport ? "Local Market Update" : "Recent Sales Report",
        `${suburb} Property Update`,
        "Local Property Report",
        "Market Context",
        "Know Before You Plan",
        "Property Sales Context",
      ], 30, 6),
      googleDescriptions: uniqueShort([
        marketReport ? `Get a plain-English ${suburb} market update.` : `See recent local sales around ${suburb}.`,
        "Use local property context before you renovate, hold, or sell.",
        "Understand recent activity before your next property decision.",
      ], 90, 3),
      keywords: marketReport
        ? [`${suburb} property market`, `${suburb} market update`, `real estate ${suburb}`]
        : [`recent sales ${suburb}`, `${suburb} property sales`, `sold prices ${suburb}`],
      leadFormHeadline: marketReport ? "Get the market update" : "Get recent sales",
      leadFormQuestions: ["What suburb are you interested in?", "What type of property are you tracking?", "Would a local price update help?"],
      thankYouTitle: marketReport ? "Your update is on the way" : "Your report is on the way",
      thankYouBody: `${businessName} may send practical local property context.`,
      landingHeadline: marketReport ? `${suburb} market update` : `${suburb} recent sales`,
      landingSubheadline: marketReport
        ? "Get a plain-English local update before you make property plans."
        : "See recent local sales before you decide what to do next.",
      landingCta: input.variant.cta,
      followUpSms: [
        marketReport
          ? `Thanks for requesting the ${suburb} market update. I can send more local context if useful.`
          : `Thanks for requesting recent ${suburb} sales. I can send local context if useful.`,
        "A useful next step is comparing recent activity with your property's condition and timing.",
      ],
      followUpEmail: [
        {
          subject: marketReport ? `Your ${suburb} market update` : `Recent ${suburb} sales`,
          body: "Here is the local context you requested. Use it as a practical starting point before seeking property-specific advice.",
        },
        {
          subject: "Planning your next step",
          body: "If you are comparing renovate, hold, or sell options, a local price update can help you understand current conditions.",
        },
      ],
      assetLongHeadline: marketReport ? `Get a plain-English ${suburb} market update` : `See recent local sales around ${suburb}`,
    };
  }

  if (/open_home/.test(offerId)) {
    return {
      finalUrl,
      urlPath: "inspect",
      metaHeadlines: uniqueShort([headline, "Open-home next steps", "Know what to ask next"], 40, 3),
      metaDescriptions: uniqueShort([description, "A simple guide for property follow-up."], 90, 2),
      googleHeadlines: uniqueShort([
        "Open Home Guide",
        "Inspection Checklist",
        "Property Questions",
        "After The Open Home",
        "Buyer Follow-Up Guide",
        "Plan Your Next Step",
      ], 30, 6),
      googleDescriptions: uniqueShort([
        "Get practical questions to ask after an inspection.",
        "Compare the property and plan your next conversation.",
        "A plain-English follow-up guide for property inspections.",
      ], 90, 3),
      keywords: [`open home questions ${suburb}`, `property inspection checklist`, `home inspection questions`],
      leadFormHeadline: "Get the follow-up guide",
      leadFormQuestions: ["Which property did you inspect?", "What would you like to clarify?", "When are you planning your next step?"],
      thankYouTitle: "Your guide is on the way",
      thankYouBody: `${businessName} may send practical property follow-up tips.`,
      landingHeadline: "Open-home follow-up guide",
      landingSubheadline: "Get clearer questions and next steps before your next property conversation.",
      landingCta: input.variant.cta,
      followUpSms: [
        "Thanks for requesting the open-home follow-up guide. I can send the key questions if useful.",
        "A useful next step is comparing property condition, timing, and contract questions side by side.",
      ],
      followUpEmail: [
        {
          subject: "Your open-home follow-up guide",
          body: "Here is the guide. Use it to clarify practical property questions before your next conversation.",
        },
        {
          subject: "Questions worth asking",
          body: "Timing, conditions, comparable properties, and next steps are useful topics to clarify after an inspection.",
        },
      ],
      assetLongHeadline: "Get a practical open-home follow-up guide",
    };
  }

  return {
    finalUrl,
    urlPath: "sell",
    metaHeadlines: uniqueShort([headline, "Before you list, start here", `${suburb} seller checklist`], 40, 3),
    metaDescriptions: uniqueShort([description, "A practical pre-sale guide for local owners."], 90, 2),
    googleHeadlines: uniqueShort([
      "Seller Checklist",
      "Selling Soon?",
      "Home Sale Guide",
      "Prep Before Listing",
      "Local Seller Guide",
      "Property Checklist",
    ], 30, 6),
    googleDescriptions: uniqueShort([
      `Download a practical checklist before selling in ${suburb}.`,
      "Plan photos, opens, and preparation with a simple guide.",
      "Get local selling tips before your campaign starts.",
    ], 90, 3),
    keywords: [`sell house ${suburb}`, `real estate appraisal ${suburb}`, `${suburb} seller guide`],
    leadFormHeadline: "Get the seller checklist",
    leadFormQuestions: ["What suburb is your property in?", "When are you considering selling?", "Would a local price update help?"],
    thankYouTitle: "Your checklist is on the way",
    thankYouBody: `${businessName} may send practical local selling tips.`,
    landingHeadline: `${suburb} seller checklist`,
    landingSubheadline: "Get a practical preparation guide before you organise photos, opens, or price discussions.",
    landingCta: input.variant.cta,
    followUpSms: [
      `Thanks for requesting the ${suburb} seller checklist. I can send a local price update if useful.`,
      "A quick tip: preparation usually starts before photos are booked. Reply if you want the timeline.",
    ],
    followUpEmail: [
      {
        subject: `Your ${suburb} seller checklist`,
        body: "Here is the checklist. Use it as a practical starting point, then seek property-specific advice when you are ready.",
      },
      {
        subject: "Planning your next step",
        body: "If you are comparing renovate, hold, or sell options, a local price update can help you understand current conditions.",
      },
    ],
    assetLongHeadline: `Download the ${suburb} seller preparation checklist`,
  };
}

function buildGoogleAssetPack(
  platform: "google_pmax" | "google_demand_gen",
  brandKit: AdStudioBrandKit,
  seed: OfferCopySeed,
): GoogleAssetPack {
  return {
    platform,
    businessName: brandKit.identity.businessName,
    finalUrl: seed.finalUrl,
    headlines: seed.googleHeadlines.slice(0, 5),
    longHeadlines: [seed.assetLongHeadline],
    descriptions: seed.googleDescriptions,
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
  subheadline?: string;
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
          content: input.subheadline ?? `Download the ${input.campaign.market.suburb} seller prep checklist.`,
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

function landingPathForOffer(offerId: string): string {
  if (/home_value_update|appraisal/.test(offerId)) return "home-value";
  if (/recent_sales/.test(offerId)) return "recent-sales";
  if (/market|snapshot/.test(offerId)) return "market-update";
  if (/open_home/.test(offerId)) return "open-home";
  if (/renovate/.test(offerId)) return "renovate-or-sell";
  if (/auction/.test(offerId)) return "auction-guide";
  if (/timeline/.test(offerId)) return "prelisting-timeline";
  if (/mistakes/.test(offerId)) return "seller-mistakes";
  if (/downsizer/.test(offerId)) return "downsizer-guide";
  if (/buyer/.test(offerId)) return "buyer-guide";
  return "seller-checklist";
}

function appendPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function metaCtaFromLabel(label: string): MetaLeadAdPack["cta"] {
  const normalised = label.trim().toLowerCase();
  if (/download|checklist|guide|report|timeline|snapshot/.test(normalised)) return "DOWNLOAD";
  if (/book|contact|request|appraisal|update/.test(normalised)) return "CONTACT_US";
  if (/sign/.test(normalised)) return "SIGN_UP";
  return "LEARN_MORE";
}

function uniqueShort(values: string[], limit: number, max: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const text = shorten(value.trim(), limit);
    const key = text.toLowerCase();

    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= max) break;
  }

  return result;
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
