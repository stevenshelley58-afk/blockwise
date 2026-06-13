import { createHash } from "node:crypto";

import type { AdStudioGoal } from "../adstudio/types.ts";

export const WINNER_SCORER_VERSION = "winner-scorer-v1";
export const WINNER_THRESHOLD = 70;

export type WinnerCandidate = {
  observedAdId: string;
  adCreativeId: string;
  advertiserPageId: string | null;
  advertiserName: string | null;
  adType: string | null;
  primaryIntent: string | null;
  format: string | null;
  headline: string | null;
  body: string | null;
  cta: string | null;
  primaryImageUrl: string | null;
  videoUrl?: string | null;
  creativeHash: string | null;
  classification: Record<string, unknown>;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  deliveryStartedAt: string | null;
  deliveryStoppedAt: string | null;
  isActive: boolean;
  creativeVersions: number;
  crossAgencyCount: number;
};

export type ObjectiveScore = {
  longevityDays: number;
  recencyDays: number | null;
  score: number;
  signals: {
    longevity: number;
    active: number;
    iteration: number;
    recency: number;
    copyCompleteness: number;
  };
};

export type DeterministicReview = {
  marketRelevant: boolean;
  offerClarity: number;
  localRelevance: number;
  leadIntent: number;
  brandFit: number;
  complianceSafety: number;
  visualHierarchy: number;
  score: number;
  tags: string[];
  warnings: string[];
  rationale: string;
};

export type WinnerScore = ObjectiveScore & {
  review: DeterministicReview;
  compositeScore: number;
  isWinner: boolean;
};

export type WinnerForMining = WinnerCandidate & {
  compositeScore: number;
  objectiveScore: number;
  scorerVersion: string;
  rationale: string | null;
};

export type TemplateDraft = {
  templateKey: string;
  clusterKey: string;
  category: string;
  audience: string[];
  format: string[];
  hookStyle: string;
  funnelStage: string;
  adstudioTemplateId: string | null;
  offerId: string | null;
  goal: AdStudioGoal | null;
  headline: string | null;
  primaryText: string | null;
  description: string | null;
  cta: string | null;
  variables: string[];
  imageBriefId: string | null;
  evidenceScore: number;
  sourceObservedAdIds: string[];
  winnerRationale: string;
  complianceNote: string | null;
  scorerVersion: string;
};

export type TemplateMiningOptions = {
  keepPerCluster?: number;
  maxAdvertiserPerCluster?: number;
};

const CATEGORY_ABBREVIATIONS: Record<string, string> = {
  appraisal: "APP",
  market_update: "MKT",
  listing: "LST",
  just_sold: "JSD",
  property_management: "PM",
  agency_brand: "BRD",
  testimonial: "TST",
  buyer_demand: "BYR",
  downsizer: "DSZ",
  investor: "INV",
};

const CATEGORY_TO_ADSTUDIO: Record<
  string,
  { goal: AdStudioGoal; offerId: string; templateId: string; audience: string[]; imageBriefId: string | null }
> = {
  appraisal: {
    goal: "appraisal_bookings",
    offerId: "home_value_update",
    templateId: "free_appraisal",
    audience: ["homeowners", "sellers"],
    imageBriefId: null,
  },
  market_update: {
    goal: "market_update_leads",
    offerId: "suburb_market_report",
    templateId: "market_update",
    audience: ["homeowners", "sellers"],
    imageBriefId: null,
  },
  listing: {
    goal: "seller_leads",
    offerId: "recent_sales_report",
    templateId: "just_listed",
    audience: ["buyers", "homeowners"],
    imageBriefId: null,
  },
  just_sold: {
    goal: "seller_leads",
    offerId: "recent_sales_report",
    templateId: "just_sold",
    audience: ["homeowners", "sellers"],
    imageBriefId: null,
  },
  property_management: {
    goal: "investor_leads",
    offerId: "investor_suburb_snapshot",
    templateId: "market_update",
    audience: ["landlords", "investors"],
    imageBriefId: null,
  },
  buyer_demand: {
    goal: "seller_leads",
    offerId: "home_value_update",
    templateId: "buyer_demand",
    audience: ["homeowners", "sellers"],
    imageBriefId: null,
  },
  downsizer: {
    goal: "downsizer_leads",
    offerId: "downsizer_guide",
    templateId: "seller_checklist",
    audience: ["downsizers"],
    imageBriefId: null,
  },
  investor: {
    goal: "investor_leads",
    offerId: "investor_suburb_snapshot",
    templateId: "market_update",
    audience: ["investors"],
    imageBriefId: null,
  },
  agency_brand: {
    goal: "seller_leads",
    offerId: "home_value_update",
    templateId: "free_appraisal",
    audience: ["homeowners"],
    imageBriefId: null,
  },
};

const FOREIGN_MARKET_RE = /\b(costa del sol|marbella|estepona|benahav[ií]s|dubai|bali|phuket|miami|florida|california|uk|london)\b|[€£]/iu;
const AU_REAL_ESTATE_RE =
  /\b(perth|wa|western australia|australia|suburb|home|property|properties|real estate|appraisal|market update|selling|seller|sold|landlord|rent|tenant|auction|open home|inspection)\b/iu;
const LEAD_INTENT_RE = /\b(book|request|get|download|learn more|call|enquire|appraisal|report|guide|inspection|register|contact)\b/iu;
const UNSUPPORTED_CLAIM_RE = /\b(guarantee|guaranteed|promise|highest price|above market|risk[- ]free|no obligation to sell at any cost)\b/iu;
const PRESSURE_RE = /\b(last chance|urgent|must act|limited time|only today|don't miss out)\b/iu;
const DEMOGRAPHIC_TARGETING_RE = /\b(families only|no kids|singles only|retirees only|students only|no renters)\b/iu;

export function isScoringEligible(candidate: Pick<WinnerCandidate, "body" | "headline" | "classification" | "adType" | "primaryIntent">): boolean {
  const body = candidate.body?.trim() ?? "";
  if (body.length === 0) return false;
  if (hasUnresolvedTemplatePlaceholder(candidate.headline) || hasUnresolvedTemplatePlaceholder(body)) return false;
  return isRealEstateClassified(candidate.classification, candidate.adType, candidate.primaryIntent);
}

export function calculateObjectiveScore(candidate: Pick<WinnerCandidate, "deliveryStartedAt" | "firstSeenAt" | "deliveryStoppedAt" | "lastSeenAt" | "isActive" | "creativeVersions" | "headline" | "body" | "cta">, now = new Date()): ObjectiveScore {
  const start = parseDate(candidate.deliveryStartedAt) ?? parseDate(candidate.firstSeenAt) ?? now;
  const end = parseDate(candidate.deliveryStoppedAt) ?? (candidate.isActive ? now : parseDate(candidate.lastSeenAt)) ?? now;
  const lastSeen = parseDate(candidate.lastSeenAt);
  const longevityDays = Math.max(0, daysBetween(start, end));
  const recencyDays = lastSeen ? Math.max(0, daysBetween(lastSeen, now)) : null;
  const hasHeadline = Boolean(candidate.headline?.trim());
  const hasBody = Boolean(candidate.body?.trim());
  const hasCta = Boolean(candidate.cta?.trim());

  const signals = {
    longevity: (Math.min(longevityDays, 365) / 365) * 40,
    active: candidate.isActive ? 15 : 0,
    iteration: (Math.min(Math.max(candidate.creativeVersions, 0), 10) / 10) * 20,
    recency: recencyDays !== null && recencyDays <= 30 ? 10 : 0,
    copyCompleteness: ((hasHeadline ? 1 : 0) + (hasBody ? 1 : 0) + (hasCta ? 1 : 0)) * 5,
  };

  return {
    longevityDays,
    recencyDays,
    score: round1(Object.values(signals).reduce((sum, value) => sum + value, 0)),
    signals,
  };
}

export function deterministicReview(candidate: WinnerCandidate): DeterministicReview {
  const copy = [candidate.headline, candidate.body, candidate.cta].filter(Boolean).join(" ");
  const marketRelevant = isMarketRelevant(candidate, copy);
  const warnings: string[] = [];

  if (!marketRelevant) warnings.push("market_relevance_gate_failed");
  if (UNSUPPORTED_CLAIM_RE.test(copy)) warnings.push("unsupported_claim_language");
  if (PRESSURE_RE.test(copy)) warnings.push("pressure_language");
  if (DEMOGRAPHIC_TARGETING_RE.test(copy)) warnings.push("demographic_targeting_language");

  const hasOffer = /\b(free|report|guide|appraisal|update|checklist|book|download|valuation|snapshot)\b/iu.test(copy);
  const hasLocation = AU_REAL_ESTATE_RE.test(copy) || hasClassificationValue(candidate.classification, ["suburb", "postcode", "area", "state"]);
  const hasIntent = LEAD_INTENT_RE.test(copy) || Boolean(candidate.cta?.trim());
  const hasBrand = Boolean(candidate.advertiserName?.trim()) || /\b(ray white|belle|acton|property|real estate|realty)\b/iu.test(copy);
  const hasVisual = Boolean(candidate.primaryImageUrl || candidate.videoUrl || candidate.format === "carousel" || candidate.format === "video");
  const complianceBase = warnings.some((warning) => warning.includes("unsupported") || warning.includes("demographic")) ? 11 : warnings.length ? 15 : 19;

  const dimensions = {
    offerClarity: clamp((hasOffer ? 14 : 7) + (hasIntent ? 4 : 0) + (candidate.headline ? 2 : 0), 0, 20),
    localRelevance: clamp((hasLocation ? 11 : 5) + (marketRelevant ? 4 : 0), 0, 15),
    leadIntent: clamp((hasIntent ? 14 : 7) + (candidate.cta ? 4 : 0) + (hasOffer ? 2 : 0), 0, 20),
    brandFit: clamp((hasBrand ? 12 : 8) + (copy.length > 80 ? 2 : 0), 0, 15),
    complianceSafety: clamp(complianceBase, 0, 20),
    visualHierarchy: clamp((hasVisual ? 7 : 3) + (candidate.format === "carousel" ? 2 : 0) + (candidate.headline ? 1 : 0), 0, 10),
  };
  const score = Object.values(dimensions).reduce((sum, value) => sum + value, 0);
  const tags = [
    normalizeCategory(candidate),
    inferHookStyle(candidate),
    inferFunnelStage(candidate),
    candidate.format || "unknown_format",
  ].filter(Boolean);

  return {
    marketRelevant,
    ...dimensions,
    score,
    tags,
    warnings,
    rationale: marketRelevant
      ? "Deterministic review found AU real-estate relevance, usable lead intent, and no blocking compliance issue."
      : "Deterministic review rejected the ad for non-AU or off-market real-estate relevance.",
  };
}

export function scoreWinnerCandidate(candidate: WinnerCandidate, now = new Date()): WinnerScore {
  const objective = calculateObjectiveScore(candidate, now);
  const review = deterministicReview(candidate);
  const compositeScore = round1(objective.score * 0.5 + review.score * 0.5);

  return {
    ...objective,
    review,
    compositeScore,
    isWinner: review.marketRelevant && compositeScore >= WINNER_THRESHOLD,
  };
}

export function buildTemplateDraftsFromWinners(
  winners: WinnerForMining[],
  options: TemplateMiningOptions = {},
): TemplateDraft[] {
  const keepPerCluster = options.keepPerCluster ?? 3;
  const maxAdvertiserPerCluster = options.maxAdvertiserPerCluster ?? 1;
  const sorted = [...winners].sort((left, right) => right.compositeScore - left.compositeScore || left.observedAdId.localeCompare(right.observedAdId));
  const clusters = new Map<string, WinnerForMining[]>();

  for (const winner of sorted) {
    if (!isScoringEligible(winner)) continue;
    const clusterKey = buildClusterKey(winner);
    const cluster = clusters.get(clusterKey) ?? [];
    const advertiserHits = cluster.filter((candidate) => (candidate.advertiserPageId ?? candidate.advertiserName) === (winner.advertiserPageId ?? winner.advertiserName)).length;
    if (advertiserHits >= maxAdvertiserPerCluster) continue;
    if (winner.creativeHash && cluster.some((candidate) => candidate.creativeHash === winner.creativeHash)) continue;
    const normalized = normalizeCopyForDedupe(winner);
    if (cluster.some((candidate) => normalizeCopyForDedupe(candidate) === normalized)) continue;
    if (cluster.length >= keepPerCluster) continue;
    clusters.set(clusterKey, [...cluster, winner]);
  }

  return [...clusters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([clusterKey, sources]) => buildTemplateDraft(clusterKey, sources));
}

export function normalizeCopyForDedupe(input: Pick<WinnerCandidate, "headline" | "body">): string {
  return [input.headline, input.body]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\{\{[^}]+\}\}/gu, " ")
    .replace(/\b\d+(?:[.,]\d+)?%?\b/gu, " ")
    .replace(/\$[\d,]+(?:\.\d+)?/gu, " ")
    .replace(/\b(?:perth|western australia|wa|suburb|postcode|estate|real|property|properties|home|homes)\b/gu, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function deriveTemplateKey(clusterKey: string): string {
  const [category] = clusterKey.split("|");
  const prefix = CATEGORY_ABBREVIATIONS[category] ?? category.slice(0, 3).toUpperCase().padEnd(3, "X");
  const digest = createHash("sha1").update(clusterKey).digest("hex");
  const value = (Number.parseInt(digest.slice(0, 8), 16) % 90) + 10;
  return `${prefix}-${value}`;
}

export function buildClusterKey(candidate: WinnerCandidate): string {
  return [normalizeCategory(candidate), inferHookStyle(candidate), inferFunnelStage(candidate)].join("|");
}

export function normalizeCategory(candidate: Pick<WinnerCandidate, "classification" | "adType" | "primaryIntent" | "headline" | "body">): string {
  const values = [
    stringValue(candidate.classification.category),
    stringValue(candidate.classification.ad_type),
    candidate.adType,
    candidate.primaryIntent,
    candidate.headline,
    candidate.body,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/market|report|suburb|update|trend/iu.test(values)) return "market_update";
  if (/appraisal|valuation|value|worth|price update/iu.test(values)) return "appraisal";
  if (/just sold|sold|auction result/iu.test(values)) return "just_sold";
  if (/listing|just listed|open home|inspection|development|land now selling/iu.test(values)) return "listing";
  if (/property management|landlord|tenant|rent/iu.test(values)) return "property_management";
  if (/testimonial|review|client story/iu.test(values)) return "testimonial";
  if (/buyer demand|buyers waiting|active buyers/iu.test(values)) return "buyer_demand";
  if (/downsizer|retirement|over-55|lifestyle community/iu.test(values)) return "downsizer";
  if (/investor|yield|co-living|investment/iu.test(values)) return "investor";
  return "agency_brand";
}

export function inferHookStyle(candidate: Pick<WinnerCandidate, "classification" | "headline" | "body">): string {
  const explicit = stringValue(candidate.classification.hook_style) ?? firstString(candidate.classification.hooks);
  if (explicit) return slugify(explicit);
  const copy = [candidate.headline, candidate.body].filter(Boolean).join(" ").toLowerCase();
  if (/\bfree\b|download|get the guide|get report/iu.test(copy)) return "lead_magnet";
  if (/\bworth|value|appraisal|valuation\b/iu.test(copy)) return "value_question";
  if (/\bjust sold|sold\b/iu.test(copy)) return "social_proof";
  if (/\bmarket|trend|prices|demand\b/iu.test(copy)) return "market_signal";
  if (/\bnew|now selling|open home|inspection\b/iu.test(copy)) return "availability";
  return "direct_offer";
}

export function inferFunnelStage(candidate: Pick<WinnerCandidate, "classification" | "headline" | "body" | "cta">): string {
  const explicit = stringValue(candidate.classification.funnel_stage);
  if (explicit) return slugify(explicit);
  const copy = [candidate.headline, candidate.body, candidate.cta].filter(Boolean).join(" ").toLowerCase();
  if (/\bbook|request|call|enquire|register\b/iu.test(copy)) return "conversion";
  if (/\bdownload|guide|report|checklist|learn more\b/iu.test(copy)) return "lead_capture";
  return "awareness";
}

function buildTemplateDraft(clusterKey: string, sources: WinnerForMining[]): TemplateDraft {
  const top = sources[0];
  const category = normalizeCategory(top);
  const mapping = CATEGORY_TO_ADSTUDIO[category] ?? CATEGORY_TO_ADSTUDIO.agency_brand;
  const evidenceScore = round1(sources.reduce((sum, source) => sum + source.compositeScore, 0) / sources.length);
  const sourceIds = sources.map((source) => source.observedAdId);
  const variables = extractVariables([top.headline, top.body, top.cta].filter(Boolean).join(" "));

  return {
    templateKey: deriveTemplateKey(clusterKey),
    clusterKey,
    category,
    audience: mapping.audience,
    format: top.format && top.format !== "unknown" ? [top.format] : [],
    hookStyle: inferHookStyle(top),
    funnelStage: inferFunnelStage(top),
    adstudioTemplateId: mapping.templateId,
    offerId: mapping.offerId,
    goal: mapping.goal,
    headline: tokeniseTemplateCopy(top.headline),
    primaryText: tokeniseTemplateCopy(top.body),
    description: null,
    cta: top.cta,
    variables,
    imageBriefId: mapping.imageBriefId,
    evidenceScore,
    sourceObservedAdIds: sourceIds,
    winnerRationale: `Mined from ${sources.length} winning ad${sources.length === 1 ? "" : "s"} in ${clusterKey}; mean composite score ${evidenceScore}.`,
    complianceNote: sources.some((source) => deterministicReview(source).warnings.length > 0)
      ? "Deterministic scorer flagged non-blocking copy warnings; operator review required before approval."
      : null,
    scorerVersion: top.scorerVersion || WINNER_SCORER_VERSION,
  };
}

function tokeniseTemplateCopy(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/\$[\d,]+(?:\.\d+)?/gu, "{{price}}")
    .replace(/\b\d+(?:[.,]\d+)?%/gu, "{{growth_12m}}")
    .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)\b/giu, "{{time}}")
    .replace(/\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\s+\d{1,2}\s+\p{L}+\b/giu, "{{date}}")
    .replace(/\s+/gu, " ")
    .trim();
}

function extractVariables(text: string): string[] {
  const variables = new Set<string>();
  for (const match of text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/gu)) {
    variables.add(match[1]);
  }
  for (const tokenised of [tokeniseTemplateCopy(text) ?? ""]) {
    for (const match of tokenised.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/gu)) {
      variables.add(match[1]);
    }
  }
  return [...variables].sort();
}

function isRealEstateClassified(classification: Record<string, unknown>, adType: string | null, primaryIntent: string | null): boolean {
  if (classification.is_real_estate_ad === true || classification.isRealEstateAd === true) return true;
  const joined = [
    stringValue(classification.industry),
    stringValue(classification.vertical),
    stringValue(classification.category),
    stringValue(classification.type),
    stringValue(classification.ad_type),
    adType,
    primaryIntent,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(real[_\s-]?estate|property|appraisal|listing|market[_\s-]?update|just[_\s-]?sold|property[_\s-]?management)\b/iu.test(joined);
}

function isMarketRelevant(candidate: WinnerCandidate, copy: string): boolean {
  if (FOREIGN_MARKET_RE.test(copy)) return false;
  const locale = stringValue(candidate.classification.locale) ?? stringValue(candidate.classification.country);
  if (locale && !/\b(au|aus|australia|western australia|wa)\b/iu.test(locale)) return false;
  return AU_REAL_ESTATE_RE.test(copy) || isRealEstateClassified(candidate.classification, candidate.adType, candidate.primaryIntent);
}

function hasClassificationValue(classification: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => {
    const value = classification[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(stringValue(value));
  });
}

function hasUnresolvedTemplatePlaceholder(value: string | null | undefined): boolean {
  return /\{\{[^}]+\}\}/u.test(value ?? "");
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstString(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  return value.find((item): item is string => typeof item === "string" && item.trim().length > 0) ?? null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}
