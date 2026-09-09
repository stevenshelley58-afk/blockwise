import { createHash } from "node:crypto";

import { appendAdvertiserPath, resolveAdvertiserBaseUrl, resolveLeadFormPrivacyPolicyUrl } from "./advertiser-domain.ts";
import { runAdStudioComplianceReview } from "./compliance.ts";
import { DEFAULT_LEAD_FORM_PRESETS, normalizeLeadFormQuestions, renderPresetLeadForm, resolveDefaultLeadFormPreset } from "./default-lead-forms.ts";
import { deterministicUuid } from "./id.ts";
import { labelForMetaCta } from "./meta-cta.ts";
import { scoreAdStudioVariant } from "./scoring.ts";
import {
  deterministicEditingReadiness,
  resolveAdStudioTemplate,
  type AdStudioGalleryTemplate,
} from "./templates.ts";
import { buildingTextLayers } from "./text-layer-state.ts";
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
  /** Stable identity reserved before any provider work begins. */
  campaignId: string;
  workspaceId: string;
  brandKit: AdStudioBrandKit;
  suburb: string;
  city: string;
  state: string;
  firstAd: FirstAdInput;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** Stable across HTTP JSON and Postgres jsonb key ordering. */
export function generationRequestFingerprint(body: unknown): string {
  const content = body && typeof body === "object" && !Array.isArray(body)
    ? Object.fromEntries(
        Object.entries(body as Record<string, unknown>).filter(([key]) => key !== "clientMutationId"),
      )
    : body;
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

export function generationCreditMutationKey(dedupKey: string): string {
  return `adstudio-generation:${dedupKey}`;
}

export function resolveCloneCampaignIdFromParts(input: {
  workspaceId: string;
  templateId: string;
  templateRevision: string;
  requestFingerprint: string;
}): string {
  return deterministicUuid(
    `${input.workspaceId}:${input.templateId}:${input.templateRevision}:${input.requestFingerprint}`,
  );
}

export function resolveCloneCampaignId(input: {
  workspaceId: string;
  templateId: string;
  /** SHA-256 fingerprint of the complete customer generation request. */
  requestFingerprint: string;
}): string {
  const template = requireGalleryTemplate(input.templateId);
  return resolveCloneCampaignIdFromParts({
    workspaceId: input.workspaceId,
    templateId: template.id,
    templateRevision: template.qualityLock?.templateHash ?? "unlocked",
    requestFingerprint: input.requestFingerprint,
  });
}

const LEGACY_LEAD_FORM_HEADLINES = new Set([
  ...DEFAULT_LEAD_FORM_PRESETS.map((preset) => preset.headline),
  "Request your free rental appraisal",
  "Request your free market report",
  "Request your free downsizing consultation",
  "Request your free investment consultation",
  "Request off-market property alerts",
]);

export function buildLeadFormCopy(template: AdStudioGalleryTemplate, brandKit: AdStudioBrandKit): {
    headline: string;
    questions: string[];
    privacyPolicyUrl: string | null;
    thankYouScreen: { title: string; body: string };
  } {
  const goal = template.classification?.primary_intent ?? "";
  const agencyName = brandKit.identity.tradingName?.trim() || brandKit.identity.businessName || "the agency";
  const preset = resolveDefaultLeadFormPreset(template);
  const nextStep = goal.includes("appraisal")
    ? "appraisal"
    : goal.includes("seller") || goal.includes("buyer") || goal.includes("downsizer")
      ? "consultation"
      : "next steps";
  const rendered = renderPresetLeadForm(preset, agencyName, nextStep);
  const questions = normalizeLeadFormQuestions([...(template.meta.leadForm.questions ?? []), ...rendered.questions]);
  const templateHeadline = template.meta.leadForm.headline?.trim() ?? "";
  const headline = templateHeadline && !LEGACY_LEAD_FORM_HEADLINES.has(templateHeadline)
    ? templateHeadline
    : rendered.headline;

  return {
    headline,
    questions,
    privacyPolicyUrl: resolveLeadFormPrivacyPolicyUrl(brandKit),
    thankYouScreen: rendered.thankYouScreen,
  };
}

export function buildCloneCampaignPack(input: BuildCloneCampaignPackInput): AdStudioCampaignPack {
  const template = requireGalleryTemplate(input.firstAd.templateId);
  const cloneImages = input.firstAd.templateCloneImagesByFormat;
  // Feed remains the canonical finished image. Current generation derives the
  // Story placement deterministically before this pack is persisted; the
  // builder still accepts historical Feed-only rows for safe reads/repair.
  if (!cloneImages?.["4:5"]) {
    throw new Error("The finished feed (4:5) clone is required before an ad can be created.");
  }

  const campaignId = input.campaignId;
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
    // Declare only placement outputs that have immutable stored images.
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
      // The post-persist background task owns this lease.  The editor sees it
      // immediately and waits instead of racing the task with another plate
      // inpaint request for this same finished clone.
      textLayers: input.cloneQa?.regions.some((region) => region.kind === "text")
        ? buildingTextLayers(
          input.cloneImage,
          deterministicEditingReadiness(input.template).status === "ready",
        )
        : undefined,
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
