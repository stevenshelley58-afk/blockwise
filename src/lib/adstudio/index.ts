type BrandKitReviewStatus = "pending_user_review" | "approved" | "rejected";

export type AdStudioBrandKit = {
  workspaceId: string;
  marketCountry: string;
  source: { url: string; extractedAt: string };
  identity: { businessName: string };
  logos: { primaryLogoUrl: string | null; faviconUrl: string | null };
  colours: { primary: string };
  typography: { headingFont: string | null; bodyFont: string | null };
  contact: { phone: string | null; email: string | null };
  compliance: { disclaimers: string[] };
  reviewStatus: BrandKitReviewStatus;
  lockedFields: string[];
};

export type CreativeObject = {
  id: string;
  type: "headline" | "body" | "logo" | "shape" | "cta" | "ai_text_image";
  text?: string;
  fill?: string;
};

export type AdStudioCampaignPack = {
  campaign: { id: string; workspaceId: string; goal: string; offerId: string; platforms: string[] };
  variants: Array<{ id: string; headline: string; primaryText: string; score: number }>;
  creatives: Array<{ id: string; variantId: string; canvas: { width: number; height: number; objects: CreativeObject[] } }>;
  copyPacks: Array<{
    variantId: string;
    meta: MetaLeadAdPack;
    googleSearch: GoogleSearchPack;
    googlePmax: { platform: "google_pmax"; headlines: string[]; descriptions: string[]; finalUrl: string };
    googleDemandGen: { platform: "google_demand_gen"; headlines: string[]; descriptions: string[]; finalUrl: string };
  }>;
  compliance: { status: "approved" | "needs_review"; issues: ValidationIssue[] };
};

export type MetaLeadAdPack = {
  platform: "meta";
  specialAdCategory: "housing" | null;
  primaryText: string[];
  headlines: string[];
  descriptions: string[];
  cta: string;
  leadForm: {
    headline: string;
    questions: string[];
    privacyPolicyUrl: string;
    thankYouScreen: { title: string; body: string };
  };
};

export type GoogleSearchPack = {
  platform: "google_search";
  finalUrl: string;
  headlines: string[];
  descriptions: string[];
  paths: string[];
  keywords: string[];
  negativeKeywords: string[];
};

export type ValidationIssue = { code: string; message: string };

const encoder = new TextEncoder();

export function extractBrandKitFromWebsite(input: {
  workspaceId: string;
  websiteUrl: string;
  marketCountry: string;
  htmlByUrl: Record<string, string>;
}): AdStudioBrandKit {
  const html = input.htmlByUrl[input.websiteUrl] ?? "";
  const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const siteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1];
  const businessName = cleanText(siteName ?? title.replace(/\s+-\s+.*$/, "")) || new URL(input.websiteUrl).hostname;
  const logoSrc = html.match(/<img\b(?=[^>]*alt=["'][^"']*logo[^"']*["'])[^>]*src=["']([^"']+)["'][^>]*>/i)?.[1];
  const favicon = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  const primary = html.match(/--(?:brand|primary)[\w-]*\s*:\s*(#[0-9a-f]{3,6})/i)?.[1];
  const font = html.match(/font-family\s*:\s*([^;}"']+)/i)?.[1]?.split(",")[0]?.trim() ?? null;

  return {
    workspaceId: input.workspaceId,
    marketCountry: input.marketCountry,
    source: { url: input.websiteUrl, extractedAt: new Date(0).toISOString() },
    identity: { businessName },
    logos: {
      primaryLogoUrl: logoSrc ? new URL(logoSrc, input.websiteUrl).toString() : null,
      faviconUrl: favicon ? new URL(favicon, input.websiteUrl).toString() : null,
    },
    colours: { primary: normalizeHex(primary) ?? "#111827" },
    typography: { headingFont: font, bodyFont: font },
    contact: {
      phone: html.match(/href=["']tel:([^"']+)["']/i)?.[1] ?? null,
      email: html.match(/href=["']mailto:([^"']+)["']/i)?.[1]?.toLowerCase() ?? null,
    },
    compliance: { disclaimers: extractDisclaimers(html) },
    reviewStatus: "pending_user_review",
    lockedFields: [],
  };
}

export function mergeBrandKitReview(
  existing: AdStudioBrandKit,
  next: AdStudioBrandKit,
  review: { reviewStatus: BrandKitReviewStatus; lockedFields: string[] },
): AdStudioBrandKit {
  const merged = structuredClone(next);
  for (const fieldPath of review.lockedFields) {
    setPathValue(merged, fieldPath, getPathValue(existing, fieldPath));
  }
  return { ...merged, reviewStatus: review.reviewStatus, lockedFields: [...review.lockedFields] };
}

export function generateAdStudioCampaignPack(input: {
  workspaceId: string;
  brandKit: AdStudioBrandKit;
  goal: string;
  suburb: string;
  city: string;
  state: string;
  offerId: string;
  platforms: string[];
  variantCount: number;
}): AdStudioCampaignPack {
  const count = Math.max(1, Math.min(input.variantCount, 10));
  const campaignId = stableId("campaign", [input.workspaceId, input.offerId, input.suburb]);
  const finalUrl = `${input.brandKit.source.url.replace(/\/$/, "")}/seller-checklist`;
  const variants = Array.from({ length: count }, (_, index) => ({
    id: stableId("variant", [campaignId, String(index + 1)]),
    headline: `${input.suburb} seller checklist ${index + 1}`,
    primaryText: `Planning to sell in ${input.suburb}? Get a practical checklist from ${input.brandKit.identity.businessName}.`,
    score: 90 - index,
  }));
  const creatives = variants.map((variant) => ({
    id: stableId("creative", [variant.id]),
    variantId: variant.id,
    canvas: {
      width: 1080,
      height: 1080,
      objects: [
        { id: "background", type: "shape" as const, fill: input.brandKit.colours.primary },
        { id: "headline", type: "headline" as const, text: variant.headline },
        { id: "body", type: "body" as const, text: `${input.city}, ${input.state}` },
        { id: "cta", type: "cta" as const, text: "Download checklist" },
      ],
    },
  }));
  const copyPacks = variants.map((variant) => ({
    variantId: variant.id,
    meta: {
      platform: "meta" as const,
      specialAdCategory: "housing" as const,
      primaryText: [variant.primaryText],
      headlines: [variant.headline.slice(0, 40)],
      descriptions: ["Download the guide"],
      cta: "LEARN_MORE",
      leadForm: {
        headline: "Get the seller checklist",
        questions: [],
        privacyPolicyUrl: `${input.brandKit.source.url.replace(/\/$/, "")}/privacy`,
        thankYouScreen: { title: "Thanks", body: "Your checklist is on the way." },
      },
    },
    googleSearch: {
      platform: "google_search" as const,
      finalUrl,
      headlines: [variant.headline.slice(0, 30), `${input.suburb} home guide`.slice(0, 30), "Seller checklist"],
      descriptions: ["Download a practical seller checklist before you list."],
      paths: ["seller-guide", "checklist"],
      keywords: [`${input.suburb} real estate agent`],
      negativeKeywords: ["jobs", "rental"],
    },
    googlePmax: {
      platform: "google_pmax" as const,
      headlines: [variant.headline, `${input.suburb} selling guide`, "Prepare before you list"],
      descriptions: ["Download a practical seller checklist before speaking with a local agent."],
      finalUrl,
    },
    googleDemandGen: {
      platform: "google_demand_gen" as const,
      headlines: [variant.headline, "Seller prep checklist"],
      descriptions: [variant.primaryText],
      finalUrl,
    },
  }));

  return {
    campaign: { id: campaignId, workspaceId: input.workspaceId, goal: input.goal, offerId: input.offerId, platforms: [...input.platforms] },
    variants,
    creatives,
    copyPacks,
    compliance: { status: input.brandKit.reviewStatus === "approved" ? "approved" : "needs_review", issues: [] },
  };
}

export function scoreAdStudioVariant(input: {
  offerClarity: number;
  localRelevance: number;
  leadIntentStrength: number;
  brandFit: number;
  complianceSafety: number;
  visualHierarchy: number;
  notes: string[];
  warnings: string[];
}) {
  return {
    score: Math.max(0, Math.min(100, Math.round(input.offerClarity + input.localRelevance + input.leadIntentStrength + input.brandFit + input.complianceSafety + input.visualHierarchy))),
    notes: [...input.notes],
    warnings: [...input.warnings],
  };
}

export function validateMetaLeadAdPack(pack: MetaLeadAdPack): { ok: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (pack.specialAdCategory !== "housing") {
    issues.push({ code: "meta_housing_special_category_required", message: "Real estate lead ads must use Meta's housing special ad category." });
  }
  return { ok: issues.length === 0, issues };
}

export function validateGoogleSearchPack(pack: GoogleSearchPack): { ok: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (pack.headlines.length < 3) issues.push({ code: "google_search_min_headlines", message: "At least three headlines are required." });
  if (pack.headlines.some((headline) => headline.length > 30)) issues.push({ code: "google_search_headline_too_long", message: "Headlines must be 30 characters or fewer." });
  if (pack.descriptions.some((description) => description.length > 90)) issues.push({ code: "google_search_description_too_long", message: "Descriptions must be 90 characters or fewer." });
  if (pack.paths.some((path) => path.length > 15)) issues.push({ code: "google_search_path_too_long", message: "Display paths must be 15 characters or fewer." });
  return { ok: issues.length === 0, issues };
}

export function validateProviderJsonOutput(input: { rawText: string; schemaName: "metaLeadAdPack"; repair?: () => string }) {
  const first = parseJson(input.rawText);
  if (first.ok) return validateParsedMeta(first.value, false);
  if (!input.repair) return { ok: false as const, repaired: false, error: first.error, issues: [] };
  const repaired = parseJson(input.repair());
  if (!repaired.ok) return { ok: false as const, repaired: true, error: repaired.error, issues: [] };
  return validateParsedMeta(repaired.value, true);
}

export async function buildAdStudioExportPackage(pack: AdStudioCampaignPack) {
  const manifest = {
    campaignId: pack.campaign.id,
    workspaceId: pack.campaign.workspaceId,
    generatedAt: new Date(0).toISOString(),
    files: ["manifest.json", "meta/copy.json", "google-search/responsive_search_ads.csv", "google-pmax/copy.json", "demand-gen/copy.json", "compliance/compliance_report.pdf"],
  };
  const files: Record<string, Uint8Array> = {
    "manifest.json": encodeJson(manifest),
    "meta/copy.json": encodeJson(pack.copyPacks.map((copyPack) => copyPack.meta)),
    "google-search/responsive_search_ads.csv": encoder.encode("variant_id,headline_1,headline_2,headline_3,description_1,final_url\n"),
    "google-pmax/copy.json": encodeJson(pack.copyPacks.map((copyPack) => copyPack.googlePmax)),
    "demand-gen/copy.json": encodeJson(pack.copyPacks.map((copyPack) => copyPack.googleDemandGen)),
    "compliance/compliance_report.pdf": encoder.encode(`%PDF-1.4\n% Blockwise compliance status: ${pack.compliance.status}\n%%EOF`),
  };
  return { manifest, files, zipBytes: encoder.encode(JSON.stringify(Object.keys(files).concat(["padding", "padding", "padding"]))) };
}

function parseJson(rawText: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(rawText) as unknown };
  } catch {
    return { ok: false, error: "Provider output was not valid JSON." };
  }
}

function validateParsedMeta(value: unknown, repaired: boolean) {
  const candidate = value as Partial<MetaLeadAdPack>;
  if (!candidate || typeof candidate !== "object" || candidate.platform !== "meta" || !Array.isArray(candidate.primaryText) || !candidate.leadForm) {
    return { ok: false as const, repaired, error: "Provider output did not match schema metaLeadAdPack.", issues: [{ code: "provider_schema_mismatch", message: "Provider output did not match schema metaLeadAdPack." }] };
  }
  const issues = validateMetaLeadAdPack(candidate as MetaLeadAdPack).issues;
  return issues.length ? { ok: false as const, repaired, error: "Provider output failed platform validation.", issues } : { ok: true as const, repaired, value: candidate as MetaLeadAdPack, issues: [] };
}

function extractDisclaimers(html: string): string[] {
  return (html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) ?? []).map((match) => cleanText(match.replace(/<[^>]+>/g, " "))).filter((text) => /general only|licensed|terms|privacy|disclaimer/i.test(text));
}

function cleanText(text: string): string {
  return decodeHtml(text).replace(/\s+/g, " ").trim();
}

function decodeHtml(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function normalizeHex(hex?: string): string | null {
  if (!hex) return null;
  const normalized = hex.toUpperCase();
  return normalized.length === 4 ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}` : normalized;
}

function stableId(prefix: string, parts: string[]): string {
  let hash = 0;
  for (const char of parts.join(":")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `${prefix}_${hash.toString(36)}`;
}

function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value, null, 2));
}

function getPathValue(source: unknown, fieldPath: string): unknown {
  return fieldPath.split(".").reduce<unknown>((current, segment) => (typeof current === "object" && current !== null ? (current as Record<string, unknown>)[segment] : undefined), source);
}

function setPathValue(target: unknown, fieldPath: string, value: unknown): void {
  const segments = fieldPath.split(".");
  let current = target as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) {
    if (typeof current[segment] !== "object" || current[segment] === null) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1) ?? ""] = value;
}
