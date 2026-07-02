import { z } from "zod";

export const adStudioGoalSchema = z.enum([
  "seller_leads",
  "appraisal_bookings",
  "buyer_leads",
  "market_update_leads",
  "downsizer_leads",
  "investor_leads",
  "open_home_followup",
  "listing_nurture",
]);

export const adStudioPlatformSchema = z.enum(["meta", "google_search", "google_pmax", "google_demand_gen"]);
export const adStudioFormatSchema = z.enum(["1:1", "4:5", "9:16", "1.91:1"]);
export const reviewStatusSchema = z.enum(["pending_user_review", "approved", "needs_changes"]);

export type AdStudioGoal = z.infer<typeof adStudioGoalSchema>;
export type AdStudioPlatform = z.infer<typeof adStudioPlatformSchema>;
export type AdStudioFormat = z.infer<typeof adStudioFormatSchema>;
export type AdStudioReviewStatus = z.infer<typeof reviewStatusSchema>;

export const FIRST_AD_FORMATS = ["9:16", "4:5", "1:1"] as const;

export type FirstAdInput = {
  mode: "template" | "custom";
  source?: "blank" | "template_library" | "ad_radar" | "saved_ad";
  templateId?: string;
  savedAdId?: string;
  observedAdId?: string;
  templateKey?: string;
  hooks?: string[];
  referenceCta?: string;
  referenceAdType?: string;
  referenceIntent?: string;
  description: string;
  imageDataUrl: string;
  imageDataUrls?: Partial<Record<string, string>>;
  templateCloneImage?: string;
  templateCloneProvider?: string;
  templateCloneModel?: string;
  /**
   * Brief-grounded Meta feed copy generated alongside the template clone —
   * replaces the offer-library defaults so the feed text matches the ad image.
   */
  copy?: {
    primaryText: string;
    headline: string;
    description: string;
    cta: string;
  };
  /** Vision-QA verdict + editable-element regions for the clone image. */
  templateCloneQa?: AdStudioCloneQa;
  formats: ["9:16", "4:5", "1:1"];
};

export type AdStudioBrandKit = {
  brandKitId: string;
  workspaceId: string;
  source: {
    type: "website" | "manual";
    url: string;
    lastExtractedAt: string;
    pagesScanned: string[];
  };
  identity: {
    businessName: string;
    tradingName: string | null;
    marketCountry: "AU";
    marketRegion: string | null;
    licenceText: string | null;
  };
  logos: {
    primaryLogoUrl: string | null;
    darkLogoUrl: string | null;
    lightLogoUrl: string | null;
    faviconUrl: string | null;
  };
  colours: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    confidence: {
      primary: number;
      secondary: number;
    };
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    fallbackHeading: "serif" | "sans-serif";
    fallbackBody: "serif" | "sans-serif";
  };
  visualStyle: {
    styleTags: string[];
    imageTreatment: string;
    layoutDensity: "low" | "medium" | "high";
    cornerRadius: "none" | "small" | "medium" | "large";
  };
  tone: {
    voice: string;
    avoid: string[];
    preferredPhrases: string[];
    sampleCopy: string[];
  };
  assets: {
    headshots: string[];
    officeImages: string[];
    listingImages: string[];
    socialProofImages: string[];
  };
  contact: {
    phone: string | null;
    email: string | null;
    address: string | null;
    socialLinks: string[];
  };
  compliance: {
    disclaimers: string[];
    privacyPolicyUrl: string | null;
    termsUrl: string | null;
  };
  reviewStatus: AdStudioReviewStatus;
  lockedFields: string[];
};

export type AdStudioOfferTemplate = {
  offerId: string;
  name: string;
  goal: AdStudioGoal;
  leadTemperature: "cold" | "cold_to_warm" | "warm" | "high_intent";
  requiredInputs: string[];
  defaultCta: string;
  landingPageType: string;
  followupType: string;
  expectedLeadIntent: string;
};

export type AdStudioCampaign = {
  campaignId: string;
  workspaceId: string;
  brandKitId: string;
  name: string;
  goal: AdStudioGoal;
  market: {
    country: "AU";
    state: string;
    city: string;
    suburb: string;
  };
  audienceIntent: string;
  offerId: string;
  templateKey?: string | null;
  templateSource?: "builtin" | "operator" | "radar" | "ad_radar" | null;
  sourceObservedAdId?: string | null;
  templateSnapshot?: Record<string, unknown> | null;
  platforms: AdStudioPlatform[];
  creativeFormats: AdStudioFormat[];
  status: "draft" | "generating" | "ready" | "blocked" | "exported" | "archived";
};

export type AdStudioVariantScore = {
  score: number;
  notes: string[];
  warnings: string[];
  dimensions: {
    offerClarity: number;
    localRelevance: number;
    leadIntentStrength: number;
    brandFit: number;
    complianceSafety: number;
    visualHierarchy: number;
  };
};

export type AdStudioCampaignVariant = {
  variantId: string;
  campaignId: string;
  angle: string;
  headline: string;
  offer: string;
  cta: string;
  score: AdStudioVariantScore;
  status: "draft" | "approved";
  lockedFields: string[];
};

export type AdStudioCanvasObject = {
  objectId: string;
  type: "text" | "image" | "logo" | "shape" | "safe_zone";
  role: string;
  content?: string;
  assetId?: string;
  clip?: "rect" | "circle" | "arch";
  imageAnchor?: "center" | "top" | "bottom" | "left" | "right" | "top_left" | "top_right" | "bottom_left" | "bottom_right";
  x: number;
  y: number;
  width: number;
  height?: number;
  font?: "brand_heading" | "brand_body";
  fontFamily?: string;
  size?: number;
  lineHeight?: number;
  weight?: number;
  align?: "left" | "center" | "right";
  radius?: number;
  opacity?: number;
  fill?: string;
  locked: boolean;
};

/**
 * How a creative tile was produced. "custom_composite" is the default Create
 * path. "generative" is the opt-in "More options" path that returns a fully
 * model-generated image.
 */
export type AdStudioCreativeSource = "custom_composite" | "generative";

/** A normalized 0-1 bounding box for an editable element on a clone image. */
export type AdStudioCloneRegion = {
  key: string;
  kind: "text" | "image";
  box: { x: number; y: number; width: number; height: number };
};

/** Vision-QA verdict for an AI-cloned creative (copy verification + regions). */
export type AdStudioCloneQa = {
  passed: boolean;
  attempts: number;
  checkedAt: string;
  copyChecks: Array<{ key: string; expected: string; rendered: string; exact: boolean }>;
  defects: string[];
  regions: AdStudioCloneRegion[];
  model?: string;
};

export type AdStudioCreative = {
  creativeId: string;
  campaignId: string;
  variantId: string;
  format: AdStudioFormat;
  source?: AdStudioCreativeSource;
  canvas: {
    width: number;
    height: number;
    backgroundAssetId: string | null;
    objects: AdStudioCanvasObject[];
    fabricJson?: Record<string, unknown> | null;
    /** Present on AI-cloned creatives: QA verdict + editable-element regions. */
    cloneQa?: AdStudioCloneQa;
  };
  safeZones: {
    metaStory: boolean;
    googleDemandGen: boolean;
  };
  previewSvg: string;
};

export const metaLeadAdPackSchema = z.object({
  platform: z.literal("meta"),
  specialAdCategory: z.union([z.literal("housing"), z.null()]),
  primaryText: z.array(z.string()).min(1),
  headlines: z.array(z.string()).min(1),
  descriptions: z.array(z.string()).min(1),
  cta: z.enum(["LEARN_MORE", "SIGN_UP", "DOWNLOAD", "CONTACT_US"]),
  leadForm: z.object({
    headline: z.string().min(1),
    questions: z.array(z.string()),
    privacyPolicyUrl: z.string().nullable(),
    thankYouScreen: z.object({
      title: z.string().min(1),
      body: z.string().min(1),
    }),
  }),
});

export const googleSearchPackSchema = z.object({
  platform: z.literal("google_search"),
  finalUrl: z.string().min(1),
  headlines: z.array(z.string()),
  descriptions: z.array(z.string()),
  paths: z.array(z.string()),
  keywords: z.array(z.string()),
  negativeKeywords: z.array(z.string()),
});

export const googleAssetPackSchema = z.object({
  platform: z.union([z.literal("google_pmax"), z.literal("google_demand_gen")]),
  businessName: z.string().min(1),
  finalUrl: z.string().min(1),
  headlines: z.array(z.string()),
  longHeadlines: z.array(z.string()),
  descriptions: z.array(z.string()),
  images: z.object({
    landscape_1_91: z.array(z.string()),
    square_1_1: z.array(z.string()),
    portrait_4_5: z.array(z.string()),
    vertical_9_16: z.array(z.string()),
  }),
  logos: z.object({
    square: z.array(z.string()),
    landscape: z.array(z.string()),
  }),
});

export type MetaLeadAdPack = z.infer<typeof metaLeadAdPackSchema>;
export type GoogleSearchPack = z.infer<typeof googleSearchPackSchema>;
export type GoogleAssetPack = z.infer<typeof googleAssetPackSchema>;

export type AdStudioPlatformCopyPack = {
  copyPackId: string;
  campaignId: string;
  variantId: string;
  meta: MetaLeadAdPack;
  googleSearch: GoogleSearchPack;
  googlePmax: GoogleAssetPack;
  googleDemandGen: GoogleAssetPack;
  landingPage: {
    headline: string;
    subheadline: string;
    cta: string;
  };
  followUp: {
    sms: string[];
    email: Array<{ subject: string; body: string }>;
  };
  lockedFields: string[];
};

export type ComplianceIssue = {
  code: string;
  severity: "blocking" | "warning";
  message: string;
};

export type AdStudioComplianceReport = {
  reportId: string;
  campaignId: string;
  status: "approved" | "needs_review" | "blocked";
  issues: ComplianceIssue[];
  checkedAt: string;
};

export type AdStudioCampaignPack = {
  brandKit: AdStudioBrandKit;
  campaign: AdStudioCampaign;
  variants: AdStudioCampaignVariant[];
  creatives: AdStudioCreative[];
  copyPacks: AdStudioPlatformCopyPack[];
  compliance: AdStudioComplianceReport;
  /** Non-blocking cross-variant diversity hints (near-duplicate copy). Additive; absent when no overlap detected. */
  similarityWarnings?: string[];
};

export type AdStudioExportManifest = {
  exportId: string;
  campaignId: string;
  generatedAt: string;
  files: Array<{ path: string; mimeType: string; bytes: number }>;
  platforms: AdStudioPlatform[];
};

export type AdStudioExportPackage = {
  manifest: AdStudioExportManifest;
  files: Record<string, Uint8Array>;
  zipBytes: Uint8Array;
};
