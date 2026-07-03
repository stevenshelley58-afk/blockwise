import { toMetaCta } from "./meta-cta.ts";
import { runAdStudioComplianceReview } from "./compliance.ts";
import { findPackCopySimilarityWarnings } from "./creative-qa.ts";
import { deterministicUuid } from "./id.ts";
import { findOfferTemplate, getOfferTemplate } from "./offers.ts";
import { scoreAdStudioVariant } from "./scoring.ts";
import { resolveAdStudioTemplate, type AdStudioGalleryTemplate, type AdStudioTemplate } from "./templates.ts";
import type {
  AdStudioBrandKit,
  AdStudioCampaign,
  AdStudioCampaignPack,
  AdStudioCampaignVariant,
  AdStudioCanvasObject,
  AdStudioCloneQa,
  AdStudioCreative,
  AdStudioFormat,
  AdStudioGoal,
  AdStudioOfferTemplate,
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
  sourceImagesByFormat?: Partial<Record<AdStudioFormat, string>>;
  sourceImagesBySlot?: Partial<Record<string, string>>;
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

// 1.91:1 landscape is legacy-only: nothing generates it anymore (P2.3), but the
// AdStudioFormat member stays so existing landscape creatives keep rendering.
const FALLBACK_FORMATS: AdStudioFormat[] = ["1:1", "4:5", "9:16"];
const FIRST_AD_FORMATS: AdStudioFormat[] = ["9:16", "4:5", "1:1"];
const CANVAS_SIZE: Record<AdStudioFormat, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
  "1.91:1": { width: 1200, height: 628 },
};

function resolveTemplateForGeneration(input: GenerateCampaignPackInput): AdStudioTemplate | null {
  if (input.firstAd?.mode !== "template") return null;

  const templateKey = input.firstAd.templateId ?? input.firstAd.templateKey;
  const resolved = resolveAdStudioTemplate(templateKey);
  if (!resolved) {
    throw new Error("Selected template was not found.");
  }
  return resolved;
}

export function generateAdStudioCampaignPack(input: GenerateCampaignPackInput): AdStudioCampaignPack {
  // B2 (simplification): draft/unapproved brand kits may generate; brand-kit
  // approval is enforced at publish (readiness checks), not at generation.
  const template = resolveTemplateForGeneration(input);
  const templateKey = template?.templateKey ?? template?.id ?? input.firstAd?.templateKey ?? input.firstAd?.templateId ?? null;
  const requestedOfferId = template?.offerId ?? inferOfferIdFromFirstAd(input.firstAd?.description, input.offerId);
  const offer = resolveCampaignOffer({
    offerId: requestedOfferId,
    template,
    fallbackGoal: input.goal,
  });
  const galleryTemplate = galleryTemplateOrNull(template);
  const hasTemplateClone = Boolean(input.firstAd?.templateCloneImage || input.firstAd?.templateCloneImagesByFormat);
  const formats = galleryTemplate
    ? hasTemplateClone
      ? [...FIRST_AD_FORMATS]
      : [galleryTemplate.format]
    : input.firstAd
      ? [...FIRST_AD_FORMATS]
      : (input.creativeFormats ?? FALLBACK_FORMATS);
  const campaignId = deterministicUuid(`${input.workspaceId}:${offer.offerId}:${templateKey ?? "blank"}:${input.suburb}:${input.firstAd?.description ?? ""}`);
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
    templateKey,
    templateSource: template?.source ?? (input.firstAd?.source === "ad_radar" ? "ad_radar" : null),
    // Only explicit Ad Radar copy starts are sourced from a real observed ad.
    sourceObservedAdId: input.firstAd?.source === "ad_radar" ? input.firstAd.observedAdId ?? null : null,
    templateSnapshot: template ? buildTemplateSnapshot(template) : null,
    platforms: input.platforms,
    creativeFormats: formats,
    status: "ready",
  };
  const messages = galleryTemplate
    ? buildGalleryTemplateMessages(galleryTemplate)
    : input.firstAd
    ? buildFirstAdMessages(template, offer.offerId, input.suburb)
    : buildFallbackMessages(offer.offerId, input.suburb);
  const variantCount = galleryTemplate ? 1 : Math.max(1, Math.min(input.variantCount ?? messages.length, 8));
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
      template: galleryTemplate,
    }),
  );
  const sourceImageDataUrl = input.sourceImageDataUrl ?? input.firstAd?.imageDataUrl;
  const creatives = variants.flatMap((variant, index) =>
    formats.map((format) => buildCreative({
      campaign,
      variant,
      brandKit: input.brandKit,
      format,
      template,
      sourceImageDataUrl: input.sourceImagesByFormat?.[format] ?? sourceImageDataUrl,
      sourceImagesBySlot: input.sourceImagesBySlot ?? input.firstAd?.imageDataUrls,
      templateCloneImage: input.firstAd?.templateCloneImage,
      templateCloneImagesByFormat: input.firstAd?.templateCloneImagesByFormat,
      templateCloneQa: input.firstAd?.templateCloneQa,
      templateCloneQaByFormat: input.firstAd?.templateCloneQaByFormat,
      subheadline: galleryTemplate?.editableText?.description ?? copyPacks[index]?.landingPage.subheadline ?? messages[index]?.description,
    })),
  );
  const compliance = runAdStudioComplianceReview({ campaign, copyPacks });
  const similarityWarnings = findPackCopySimilarityWarnings({ variants, copyPacks });

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
    similarityWarnings: similarityWarnings.length ? similarityWarnings : undefined,
  };
}

function resolveCampaignOffer(input: {
  offerId: string;
  template: AdStudioTemplate | null;
  fallbackGoal: AdStudioGoal;
}): AdStudioOfferTemplate {
  const registered = findOfferTemplate(input.offerId);
  if (input.template) return offerFromTemplate(input.template, input.offerId, input.fallbackGoal, registered);
  if (registered) return registered;
  return getOfferTemplate(input.offerId);
}

function offerFromTemplate(
  template: AdStudioTemplate,
  offerId: string,
  fallbackGoal: AdStudioGoal,
  registered?: AdStudioOfferTemplate,
): AdStudioOfferTemplate {
  return {
    offerId,
    name: template.name,
    goal: template.goal ?? fallbackGoal,
    leadTemperature: registered?.leadTemperature ?? leadTemperatureForTemplateOffer(template, offerId),
    requiredInputs: registered?.requiredInputs ?? ["suburb", "brand_kit"],
    defaultCta: template.sampleCopy?.cta?.trim() || registered?.defaultCta || defaultCtaForTemplateOffer(template, offerId),
    landingPageType: registered?.landingPageType ?? landingPageTypeForTemplateOffer(offerId),
    followupType: registered?.followupType ?? followupTypeForTemplateOffer(template, offerId),
    expectedLeadIntent:
      template.promptHint ||
      registered?.expectedLeadIntent ||
      `People responding to the ${template.name} template before their next property decision.`,
  };
}

function leadTemperatureForTemplateOffer(
  template: AdStudioTemplate,
  offerId: string,
): AdStudioOfferTemplate["leadTemperature"] {
  if (/listing|open|inspection|enquir/i.test(offerId) || /open home|detail card|listing/i.test(template.name)) {
    return "high_intent";
  }
  if (/market|report|snapshot|guide|tips|buyer/i.test(offerId) || /market|guide|tips|buyer/i.test(template.name)) {
    return "warm";
  }
  if (/seller|checklist|download/i.test(offerId) || /seller|checklist/i.test(template.name)) {
    return "cold_to_warm";
  }
  return "warm";
}

function defaultCtaForTemplateOffer(template: AdStudioTemplate, offerId: string): string {
  if (/listing|open|inspection|enquir/i.test(offerId) || /open home|detail card|listing/i.test(template.name)) {
    return "Enquire now";
  }
  if (/buyer/i.test(offerId) || /buyer/i.test(template.name)) return "Get buyer tips";
  if (/market|report|snapshot/i.test(offerId) || /market|report/i.test(template.name)) return "Get market update";
  if (/guide|download|checklist|tips/i.test(offerId) || /guide|checklist|tips/i.test(template.name)) return "Get the guide";
  return "Learn more";
}

function landingPageTypeForTemplateOffer(offerId: string): string {
  if (/listing|enquir/i.test(offerId)) return "listing_enquiry";
  if (/buyer/i.test(offerId)) return "buyer_enquiry";
  if (/market|report|snapshot/i.test(offerId)) return "market_report";
  if (/appraisal|value|price/i.test(offerId)) return "appraisal_booking";
  return "template_lead";
}

function followupTypeForTemplateOffer(
  template: AdStudioTemplate,
  offerId: string,
): string {
  if (/buyer|listing|open|inspection|enquir/i.test(offerId) || /buyer|open home|listing/i.test(template.name)) {
    return "buyer_nurture";
  }
  if (/market|report|snapshot/i.test(offerId) || /market|report/i.test(template.name)) {
    return "market_update_nurture";
  }
  if (/downsizer/i.test(offerId)) return "downsizer_nurture";
  return "seller_nurture";
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
      headline: template.sampleCopy?.headline || templateHeroHeadline(template),
      primaryText: template.sampleCopy?.primaryText || templatePrimaryText(template, suburb),
      description: template.sampleCopy?.description || templateDescription(template.name),
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

function templateHeroHeadline(template: AdStudioTemplate): string {
  const templateName = template.name;
  if (/appraisal|price/i.test(templateName)) return "What could your home be worth?";
  if (/open home/i.test(templateName)) return "See this home this weekend";
  if (/sold/i.test(templateName)) return "What did this sale show?";
  if (/coming soon/i.test(templateName)) return "A local home worth watching";
  if (/market/i.test(templateName)) return "Your local market, made simple";
  if (/checklist/i.test(templateName)) return "Avoid costly seller prep gaps";
  if (/buyer demand/i.test(templateName)) return "Get a clearer local view";
  return "A fresh local listing to watch";
}

function buildGalleryTemplateMessages(template: AdStudioGalleryTemplate): DefaultCreativeMessage[] {
  return [
    {
      label: template.name,
      headline: template.editableText?.headline ?? template.sampleCopy?.headline ?? template.name,
      primaryText: template.editableText?.primaryText ?? template.sampleCopy?.primaryText ?? "",
      description: template.editableText?.description ?? template.sampleCopy?.description ?? "",
      notes: ["Self-contained template", "Uses editable template image", "No blocking compliance issues"],
    },
  ];
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
  template?: AdStudioGalleryTemplate | null;
}): AdStudioPlatformCopyPack {
  const privacyUrl = input.brandKit.compliance.privacyPolicyUrl ?? `${input.brandKit.source.url}/privacy`;
  const seed = buildOfferCopySeed(input);
  const meta: MetaLeadAdPack = input.template
    ? {
        platform: "meta",
        specialAdCategory: input.template.meta.specialAdCategory,
        primaryText: [...input.template.meta.primaryText],
        headlines: [...input.template.meta.headlines],
        descriptions: [...input.template.meta.descriptions],
        cta: input.template.meta.cta,
        leadForm: {
          headline: input.template.meta.leadForm.headline,
          questions: [...input.template.meta.leadForm.questions],
          privacyPolicyUrl: privacyUrl,
          thankYouScreen: {
            title: input.template.meta.leadForm.thankYouScreen.title,
            body: input.template.meta.leadForm.thankYouScreen.body,
          },
        },
      }
    : {
        platform: "meta",
        specialAdCategory: "housing",
        primaryText: [shorten(input.message.primaryText, 125)],
        headlines: seed.metaHeadlines,
        descriptions: seed.metaDescriptions,
        cta: toMetaCta(input.variant.cta),
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
  const templateName = templateSnapshotText(input.campaign.templateSnapshot, "name");

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

  if (templateName) {
    return buildTemplateOfferCopySeed({
      finalUrl,
      templateName,
      suburb,
      businessName,
      headline,
      description,
      cta: input.variant.cta,
    });
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

function buildTemplateOfferCopySeed(input: {
  finalUrl: string;
  templateName: string;
  suburb: string;
  businessName: string;
  headline: string;
  description: string;
  cta: string;
}): OfferCopySeed {
  const templateLabel = input.templateName;
  const localContext = `${input.suburb} property context`;

  return {
    finalUrl: input.finalUrl,
    urlPath: slugPath(templateLabel),
    metaHeadlines: uniqueShort([input.headline, templateLabel, localContext], 40, 3),
    metaDescriptions: uniqueShort([input.description, `A practical next step for ${input.suburb}.`], 90, 2),
    googleHeadlines: uniqueShort([
      templateLabel,
      localContext,
      "Property Next Steps",
      "Local Property Help",
      "Plan With Context",
      "Start Here",
    ], 30, 6),
    googleDescriptions: uniqueShort([
      input.description,
      `Use practical ${input.suburb} context before your next property decision.`,
      "Plain-English property guidance from a local agency.",
    ], 90, 3),
    keywords: [`real estate ${input.suburb}`, `property ${input.suburb}`, `${input.suburb} property guide`],
    leadFormHeadline: input.cta,
    leadFormQuestions: ["Which suburb are you interested in?", "What type of property is it?", "What would you like help with?"],
    thankYouTitle: "Your request is in",
    thankYouBody: `${input.businessName} may follow up with practical local property context.`,
    landingHeadline: templateLabel,
    landingSubheadline: input.description,
    landingCta: input.cta,
    followUpSms: [
      `Thanks for your interest in ${templateLabel}. I can send the next steps if useful.`,
      `A useful next step is comparing your plans with current ${input.suburb} property context.`,
    ],
    followUpEmail: [
      {
        subject: templateLabel,
        body: "Thanks for getting in touch. I will share practical local context and the next steps for your property question.",
      },
      {
        subject: "Planning your next step",
        body: "Before making plans, compare recent local activity with your property condition, timing, and goals.",
      },
    ],
    assetLongHeadline: `${templateLabel} for ${input.suburb}`,
  };
}

function templateSnapshotText(snapshot: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = snapshot?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  template: AdStudioTemplate | null;
  sourceImageDataUrl?: string;
  sourceImagesBySlot?: Partial<Record<string, string>>;
  templateCloneImage?: string;
  templateCloneImagesByFormat?: Partial<Record<AdStudioFormat, string>>;
  templateCloneQa?: AdStudioCloneQa;
  templateCloneQaByFormat?: Partial<Record<AdStudioFormat, AdStudioCloneQa>>;
  subheadline?: string;
}): AdStudioCreative {
  const galleryTemplate = galleryTemplateOrNull(input.template);
  if (galleryTemplate) {
    const cloneImage =
      input.templateCloneImagesByFormat?.[input.format] ??
      (input.format === "1:1" ? input.templateCloneImagesByFormat?.["4:5"] : undefined) ??
      input.templateCloneImage;
    const cloneQa =
      input.templateCloneQaByFormat?.[input.format] ??
      (input.format === "1:1" ? input.templateCloneQaByFormat?.["4:5"] : undefined) ??
      input.templateCloneQa;
    if (cloneImage) {
      return buildTemplateCloneCreative({
        creativeId: deterministicUuid(`${input.campaign.campaignId}:${input.variant.variantId}:${input.format}:${galleryTemplate.templateKey}:clone`),
        campaignId: input.campaign.campaignId,
        variantId: input.variant.variantId,
        template: galleryTemplate,
        format: input.format,
        cloneImage,
        cloneQa,
      });
    }

    return buildTemplateCreative({
      creativeId: deterministicUuid(`${input.campaign.campaignId}:${input.variant.variantId}:${input.format}:${galleryTemplate.templateKey}`),
      campaignId: input.campaign.campaignId,
      variantId: input.variant.variantId,
      template: galleryTemplate,
      headline: input.variant.headline,
      subheadline: input.subheadline ?? templateDefaultSubheadline(galleryTemplate),
      cta: input.variant.cta,
      imageUrl: input.sourceImagesBySlot?.primary_photo ?? input.sourceImagesBySlot?.primary ?? input.sourceImageDataUrl ?? templateDefaultImage(galleryTemplate),
      imagesBySlot: input.sourceImagesBySlot,
    });
  }

  if (input.template) {
    throw new Error("Selected template is not a self-contained gallery template.");
  }

  return buildCustomCreative({
    creativeId: deterministicUuid(`${input.campaign.campaignId}:${input.variant.variantId}:${input.format}:custom`),
    campaignId: input.campaign.campaignId,
    variantId: input.variant.variantId,
    format: input.format,
    brandKit: input.brandKit,
    headline: input.variant.headline,
    subheadline: input.subheadline ?? input.variant.offer,
    cta: input.variant.cta,
    imageUrl: input.sourceImagesBySlot?.primary_photo ?? input.sourceImagesBySlot?.primary ?? input.sourceImageDataUrl,
  });
}

function buildTemplateCloneCreative(input: {
  creativeId: string;
  campaignId: string;
  variantId: string;
  template: AdStudioGalleryTemplate;
  format: AdStudioFormat;
  cloneImage: string;
  cloneQa?: AdStudioCloneQa;
}): AdStudioCreative {
  const size = CANVAS_SIZE[input.format];
  const creative: Omit<AdStudioCreative, "previewSvg"> = {
    creativeId: input.creativeId,
    campaignId: input.campaignId,
    variantId: input.variantId,
    format: input.format,
    source: "generative",
    canvas: {
      width: size.width,
      height: size.height,
      backgroundAssetId: null,
      cloneQa: input.cloneQa,
      objects: [
        {
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
        },
      ],
      fabricJson: null,
    },
    safeZones: {
      metaStory: input.format === "9:16",
      googleDemandGen: true,
    },
  };

  return {
    ...creative,
    previewSvg: renderGeneratedCreativeSvg(creative),
  };
}

function buildTemplateCreative(input: {
  creativeId: string;
  campaignId: string;
  variantId: string;
  template: AdStudioGalleryTemplate;
  headline: string;
  subheadline: string;
  cta: string;
  imageUrl: string;
  imagesBySlot?: Partial<Record<string, string>>;
}): AdStudioCreative {
  const imagesBySlot = input.imagesBySlot ?? {};
  let primaryAssigned = false;
  const objects = input.template.canvas.objects.map((object) => {
    if (object.type === "image" || object.role === "primary_image") {
      const slotImage = imagesBySlot[object.role] ?? imagesBySlot[object.objectId] ?? (!primaryAssigned ? input.imageUrl : undefined);
      if (slotImage) { primaryAssigned = true; return { ...object, content: slotImage, assetId: slotImage }; }
      return { ...object };
    }
    if (object.role === "headline") return { ...object, content: input.headline };
    if (object.role === "subheadline") return { ...object, content: input.subheadline };
    if (object.role === "cta_text" || object.role === "cta_button") return { ...object, content: input.cta };
    return { ...object };
  });
  const creative: Omit<AdStudioCreative, "previewSvg"> = {
    creativeId: input.creativeId,
    campaignId: input.campaignId,
    variantId: input.variantId,
    format: input.template.format,
    source: "custom_composite",
    canvas: {
      width: input.template.canvas.width,
      height: input.template.canvas.height,
      backgroundAssetId: null,
      objects,
      fabricJson: syncTemplateFabricJson(input.template.canvas.fabricJson, {
        headline: input.headline,
        description: input.subheadline,
        cta: input.cta,
        imageUrl: input.imageUrl,
        imagesBySlot,
      }),
    },
    safeZones: {
      metaStory: input.template.format === "9:16",
      googleDemandGen: true,
    },
  };

  return {
    ...creative,
    previewSvg: renderGeneratedCreativeSvg(creative),
  };
}

function syncTemplateFabricJson(
  fabricJson: AdStudioGalleryTemplate["canvas"]["fabricJson"],
  copy: { headline: string; description: string; cta: string; imageUrl: string; imagesBySlot?: Partial<Record<string, string>> },
): AdStudioGalleryTemplate["canvas"]["fabricJson"] {
  const imagesBySlot = copy.imagesBySlot ?? {};
  let primaryAssigned = false;
  return {
    ...fabricJson,
    objects: fabricJson.objects.map((object) => {
      const meta = object.blockwise;
      if (!meta || typeof meta !== "object") return { ...object };
      if (meta.type === "image" || meta.role === "primary_image") {
        const slotImage = imagesBySlot[meta.role] ?? imagesBySlot[meta.objectId] ?? (!primaryAssigned ? copy.imageUrl : undefined);
        if (slotImage) { primaryAssigned = true; return { ...object, src: slotImage }; }
        return { ...object };
      }
      if (meta.role === "headline") return { ...object, text: copy.headline };
      if (meta.role === "subheadline") return { ...object, text: copy.description };
      if (meta.role === "cta_text" || meta.role === "cta_button") return { ...object, text: copy.cta };
      return { ...object };
    }),
  };
}

function templateDefaultSubheadline(t: AdStudioGalleryTemplate): string {
  return t.editableText?.description ?? t.sampleCopy?.primaryText ?? t.sampleCopy?.description ?? "";
}

function templateDefaultImage(t: AdStudioGalleryTemplate): string {
  const img = t.canvas?.objects?.find((o) => o.type === "image" || o.role === "primary_image");
  return t.editableImage?.src ?? img?.content ?? img?.assetId ?? t.gallery?.sampleImageSrc ?? "";
}

function buildCustomCreative(input: {
  creativeId: string;
  campaignId: string;
  variantId: string;
  format: AdStudioFormat;
  brandKit: AdStudioBrandKit;
  headline: string;
  subheadline: string;
  cta: string;
  imageUrl?: string;
}): AdStudioCreative {
  const size = CANVAS_SIZE[input.format];
  const isLandscape = input.format === "1.91:1";
  const isStory = input.format === "9:16";
  const brandName = input.brandKit.identity.tradingName || input.brandKit.identity.businessName;
  const objects: AdStudioCanvasObject[] = [
    {
      objectId: "background",
      type: "shape",
      role: "background",
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      fill: input.brandKit.colours.primary || "#0F172A",
      locked: true,
    },
	    ...(input.imageUrl
	      ? [{
	          objectId: "primary_photo",
	          type: "image" as const,
	          role: "primary_image",
	          content: input.imageUrl,
	          assetId: input.imageUrl,
	          x: 0,
	          y: 0,
          width: size.width,
          height: size.height,
          imageAnchor: "center" as const,
          locked: true,
        }]
      : []),
	    {
	      objectId: "image_scrim",
	      type: "shape",
	      role: "image_scrim",
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      fill: "#0F172A",
      opacity: 0.34,
      locked: true,
    },
	    ...(input.brandKit.logos.primaryLogoUrl
	      ? [{
	          objectId: "brand_logo",
	          type: "logo" as const,
	          role: "brand_logo",
          assetId: input.brandKit.logos.primaryLogoUrl,
          x: Math.round(size.width * (isLandscape ? 0.07 : 0.08)),
          y: Math.round(size.height * (isStory ? 0.05 : 0.06)),
          width: Math.round(size.width * (isLandscape ? 0.22 : 0.34)),
          height: Math.round(size.height * (isLandscape ? 0.09 : 0.055)),
          locked: true,
        }]
	      : [{
	          objectId: "brand_name",
	          type: "text" as const,
	          role: "brand_logo",
          content: brandName,
          x: Math.round(size.width * (isLandscape ? 0.07 : 0.08)),
          y: Math.round(size.height * (isStory ? 0.05 : 0.06)),
          width: Math.round(size.width * 0.5),
          height: Math.round(size.height * 0.06),
          font: "brand_heading" as const,
          fontFamily: input.brandKit.typography.headingFont,
          size: isLandscape ? 30 : 34,
          lineHeight: 1.1,
          weight: 800,
          fill: "#FFFFFF",
          align: "left" as const,
          locked: true,
        }]),
    {
      objectId: "headline",
      type: "text",
      role: "headline",
      content: input.headline,
      x: Math.round(size.width * (isLandscape ? 0.07 : 0.08)),
      y: Math.round(size.height * (isLandscape ? 0.35 : isStory ? 0.58 : 0.55)),
      width: Math.round(size.width * (isLandscape ? 0.56 : 0.84)),
      height: Math.round(size.height * (isLandscape ? 0.18 : isStory ? 0.13 : 0.16)),
      font: "brand_heading",
      fontFamily: input.brandKit.typography.headingFont,
      size: isLandscape ? 54 : isStory ? 78 : 68,
      lineHeight: 1.05,
      weight: 900,
      fill: "#FFFFFF",
      align: "left",
      locked: false,
    },
	    {
	      objectId: "subhead",
	      type: "text",
	      role: "subheadline",
      content: input.subheadline,
      x: Math.round(size.width * (isLandscape ? 0.07 : 0.08)),
      y: Math.round(size.height * (isLandscape ? 0.57 : isStory ? 0.73 : 0.73)),
      width: Math.round(size.width * (isLandscape ? 0.5 : 0.78)),
      height: Math.round(size.height * (isLandscape ? 0.11 : 0.08)),
      font: "brand_body",
      fontFamily: input.brandKit.typography.bodyFont,
      size: isLandscape ? 26 : isStory ? 38 : 34,
      lineHeight: 1.18,
      weight: 650,
      fill: "#FFFFFF",
      align: "left",
      locked: false,
    },
	    {
	      objectId: "cta_shape",
	      type: "shape",
	      role: "cta_button",
      x: Math.round(size.width * (isLandscape ? 0.07 : 0.08)),
      y: Math.round(size.height * (isLandscape ? 0.74 : isStory ? 0.84 : 0.86)),
      width: Math.round(size.width * (isLandscape ? 0.24 : 0.34)),
      height: Math.round(size.height * (isLandscape ? 0.11 : isStory ? 0.06 : 0.07)),
      radius: 999,
      fill: input.brandKit.colours.accent || "#123E75",
      locked: true,
    },
	    {
	      objectId: "cta_text",
	      type: "text",
	      role: "cta_text",
      content: input.cta,
      x: Math.round(size.width * (isLandscape ? 0.07 : 0.08)),
      y: Math.round(size.height * (isLandscape ? 0.74 : isStory ? 0.84 : 0.86)),
      width: Math.round(size.width * (isLandscape ? 0.24 : 0.34)),
      height: Math.round(size.height * (isLandscape ? 0.11 : isStory ? 0.06 : 0.07)),
      font: "brand_body",
      fontFamily: input.brandKit.typography.bodyFont,
      size: isLandscape ? 24 : 30,
      lineHeight: 1,
      weight: 800,
      fill: "#FFFFFF",
      align: "center",
      locked: false,
    },
  ];
  const creative: Omit<AdStudioCreative, "previewSvg"> = {
    creativeId: input.creativeId,
    campaignId: input.campaignId,
    variantId: input.variantId,
    format: input.format,
    source: "custom_composite",
    canvas: {
      width: size.width,
      height: size.height,
      backgroundAssetId: null,
      objects,
    },
    safeZones: {
      metaStory: input.format === "9:16",
      googleDemandGen: true,
    },
  };

  return {
    ...creative,
    previewSvg: renderGeneratedCreativeSvg(creative),
  };
}

function renderGeneratedCreativeSvg(creative: Omit<AdStudioCreative, "previewSvg">): string {
  const width = creative.canvas.width;
  const height = creative.canvas.height;
  const body = creative.canvas.objects.map((object) => renderCanvasObjectSvg(object)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>`;
}

function renderCanvasObjectSvg(object: AdStudioCanvasObject): string {
  const opacity = object.opacity === undefined ? "" : ` opacity="${object.opacity}"`;
  if (object.type === "image" || object.type === "logo") {
    if (!object.assetId) return "";
    const preserveAspectRatio = object.imageAnchor === "top" ? "xMidYMin slice" : object.imageAnchor === "bottom" ? "xMidYMax slice" : "xMidYMid slice";
    return `<image href="${escapeSvg(object.assetId)}" x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height ?? object.width}" preserveAspectRatio="${preserveAspectRatio}"${opacity}/>`;
  }
  if (object.type === "shape") {
    return `<rect x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height ?? object.width}" rx="${object.radius ?? 0}" fill="${escapeSvg(object.fill ?? "#000000")}"${opacity}/>`;
  }
  if (object.type === "text") {
    const lines = wrapSvgText(object.content ?? "", object.width, object.size ?? 32);
    const lineHeight = (object.size ?? 32) * (object.lineHeight ?? 1.15);
    const anchor = object.align === "center" ? "middle" : object.align === "right" ? "end" : "start";
    const x = object.align === "center" ? object.x + object.width / 2 : object.align === "right" ? object.x + object.width : object.x;
    const y = object.y + (object.role === "cta_text" ? ((object.height ?? lineHeight) + (object.size ?? 32) * 0.72) / 2 : object.size ?? 32);
    const tspans = lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeSvg(line)}</tspan>`).join("");
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${escapeSvg(object.fontFamily ?? "Inter")}" font-size="${object.size ?? 32}" font-weight="${object.weight ?? 600}" fill="${escapeSvg(object.fill ?? "#FFFFFF")}">${tspans}</text>`;
  }
  return "";
}

function wrapSvgText(value: string, boxWidth: number, fontSize: number): string[] {
  const words = value.trim().split(/\s+/u).filter(Boolean);
  const maxChars = Math.max(8, Math.floor(boxWidth / Math.max(1, fontSize * 0.54)));
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTemplateSnapshot(template: AdStudioTemplate): Record<string, unknown> {
  return {
    id: template.id,
    templateKey: template.templateKey ?? template.id,
    name: template.name,
    goal: template.goal,
    offerId: template.offerId,
    source: template.source ?? null,
    status: template.status ?? null,
    promptHint: template.promptHint,
    placement: template.placement ?? null,
    format: template.format ?? null,
  };
}

function galleryTemplateOrNull(template: AdStudioTemplate | null): AdStudioGalleryTemplate | null {
  if (!template?.canvas || !template.gallery || !template.meta) return null;
  if (template.format !== "4:5" && template.format !== "9:16") return null;
  return template as AdStudioGalleryTemplate;
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
