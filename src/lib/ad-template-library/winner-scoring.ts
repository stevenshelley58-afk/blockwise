import { createHash } from "node:crypto";

import type { AdStudioGoal } from "../adstudio/types.ts";
import type { CreativeSkeleton } from "./skeleton.ts";

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
  ownedPerformance?: OwnedAdPerformanceSignal | null;
};

export type OwnedAdPerformanceSignal = {
  impressions: number;
  clicks: number;
  leads: number;
  qualifiedLeads: number;
  spendCents: number;
  leadQualityScore?: number | null;
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
  performanceScore: number | null;
  compositeScore: number;
  isWinner: boolean;
};

export type WinnerForMining = WinnerCandidate & {
  compositeScore: number;
  objectiveScore: number;
  scorerVersion: string;
  rationale: string | null;
  creativeSkeleton?: CreativeSkeleton | null;
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
  creativeSkeleton?: CreativeSkeleton;
  exemplarObservedAdIds: string[];
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
    templateId: "meta_002",
    audience: ["homeowners", "sellers"],
    imageBriefId: null,
  },
  market_update: {
    goal: "market_update_leads",
    offerId: "suburb_market_report",
    templateId: "meta_040",
    audience: ["homeowners", "sellers"],
    imageBriefId: null,
  },
  listing: {
    goal: "seller_leads",
    offerId: "recent_sales_report",
    templateId: "meta_021",
    audience: ["buyers", "homeowners"],
    imageBriefId: null,
  },
  just_sold: {
    goal: "seller_leads",
    offerId: "recent_sales_report",
    templateId: "meta_055",
    audience: ["homeowners", "sellers"],
    imageBriefId: null,
  },
  property_management: {
    goal: "investor_leads",
    offerId: "investor_suburb_snapshot",
    templateId: "meta_040",
    audience: ["landlords", "investors"],
    imageBriefId: null,
  },
  buyer_demand: {
    goal: "seller_leads",
    offerId: "home_value_update",
    templateId: "meta_142",
    audience: ["homeowners", "sellers"],
    imageBriefId: null,
  },
  downsizer: {
    goal: "downsizer_leads",
    offerId: "downsizer_guide",
    templateId: "meta_245",
    audience: ["downsizers"],
    imageBriefId: null,
  },
  investor: {
    goal: "investor_leads",
    offerId: "investor_suburb_snapshot",
    templateId: "meta_040",
    audience: ["investors"],
    imageBriefId: null,
  },
  agency_brand: {
    goal: "seller_leads",
    offerId: "home_value_update",
    templateId: "meta_002",
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
  const performanceScore = calculateOwnedPerformanceScore(candidate.ownedPerformance);
  const compositeScore = performanceScore === null
    ? round1(objective.score * 0.5 + review.score * 0.5)
    : round1(objective.score * 0.3 + review.score * 0.3 + performanceScore * 0.4);

  return {
    ...objective,
    review,
    performanceScore,
    compositeScore,
    isWinner: review.marketRelevant && compositeScore >= WINNER_THRESHOLD,
  };
}

export function calculateOwnedPerformanceScore(signal: OwnedAdPerformanceSignal | null | undefined): number | null {
  if (!signal || signal.impressions < 500) return null;
  const ctr = signal.impressions > 0 ? signal.clicks / signal.impressions : 0;
  const leadRate = signal.clicks > 0 ? signal.leads / signal.clicks : 0;
  const qualifiedRate = signal.leads > 0 ? signal.qualifiedLeads / signal.leads : 0;
  const cplCents = signal.leads > 0 ? signal.spendCents / signal.leads : null;
  const ctrScore = clamp((ctr / 0.02) * 25, 0, 25);
  const leadRateScore = clamp((leadRate / 0.08) * 25, 0, 25);
  const qualifiedScore = clamp((qualifiedRate / 0.6) * 25, 0, 25);
  const cplScore = cplCents === null ? 0 : clamp(25 - (cplCents / 20000) * 25, 0, 25);
  const qualityBoost = signal.leadQualityScore === null || signal.leadQualityScore === undefined
    ? 0
    : clamp(signal.leadQualityScore / 10, 0, 10);
  return clamp(round1(ctrScore + leadRateScore + qualifiedScore + cplScore + qualityBoost), 0, 100);
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
  const creativeSkeleton = aggregateCreativeSkeletons(sources);
  const templateKey = deriveTemplateKey(clusterKey);

  return {
    templateKey,
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
    imageBriefId: creativeSkeleton ? `creative-skeleton-${templateKey.toLowerCase()}` : mapping.imageBriefId,
    ...(creativeSkeleton ? { creativeSkeleton } : {}),
    exemplarObservedAdIds: sources.filter((source) => source.creativeSkeleton).map((source) => source.observedAdId).slice(0, 3),
    evidenceScore,
    sourceObservedAdIds: sourceIds,
    winnerRationale: `Mined from ${sources.length} winning ad${sources.length === 1 ? "" : "s"} in ${clusterKey}; mean composite score ${evidenceScore}.`,
    complianceNote: sources.some((source) => deterministicReview(source).warnings.length > 0)
      ? "Deterministic scorer flagged non-blocking copy warnings; operator review required before approval."
      : null,
    scorerVersion: top.scorerVersion || WINNER_SCORER_VERSION,
  };
}

function aggregateCreativeSkeletons(sources: WinnerForMining[]): CreativeSkeleton | undefined {
  const skeletons = sources
    .map((source) => source.creativeSkeleton)
    .filter((skeleton): skeleton is CreativeSkeleton => Boolean(skeleton));
  if (skeletons.length === 0) return undefined;

  const base = [...skeletons].sort((left, right) => right.confidence - left.confidence)[0];
  const zoneCount = Math.min(6, Math.max(...skeletons.map((skeleton) => skeleton.composition.copy_safe_zones.length)));
  const copySafeZones = Array.from({ length: zoneCount }, (_, index) => {
    const zones = skeletons.map((skeleton) => skeleton.composition.copy_safe_zones[index]).filter(Boolean);
    const fallback = base.composition.copy_safe_zones[Math.min(index, base.composition.copy_safe_zones.length - 1)];
    const priority = mode(zones.map((zone) => zone.priority).filter(Boolean));
    const x = round3(median(zones.map((zone) => zone.x)) ?? fallback.x);
    const y = round3(median(zones.map((zone) => zone.y)) ?? fallback.y);
    const width = Math.min(round3(median(zones.map((zone) => zone.width)) ?? fallback.width), round3(1 - x));
    const height = Math.min(round3(median(zones.map((zone) => zone.height)) ?? fallback.height), round3(1 - y));
    return {
      id: mode(zones.map((zone) => zone.id)) ?? fallback.id,
      x,
      y,
      width,
      height,
      ...(priority ? { priority } : {}),
    };
  });

  return {
    version: 1,
    archetype: mode(skeletons.map((skeleton) => skeleton.archetype)) ?? base.archetype,
    shot: {
      type: mode(skeletons.map((skeleton) => skeleton.shot.type)) ?? base.shot.type,
      lighting: mode(skeletons.map((skeleton) => skeleton.shot.lighting)) ?? base.shot.lighting,
      mood: mode(skeletons.map((skeleton) => skeleton.shot.mood)) ?? base.shot.mood,
    },
    composition: {
      focal_point: mode(skeletons.map((skeleton) => skeleton.composition.focal_point)) ?? base.composition.focal_point,
      horizon: mode(skeletons.map((skeleton) => skeleton.composition.horizon)) ?? base.composition.horizon,
      copy_safe_zones: copySafeZones,
    },
    color: {
      palette: modePalette(skeletons) ?? base.color.palette,
      overlay: mode(skeletons.map((skeleton) => skeleton.color.overlay)) ?? base.color.overlay,
      contrast: mode(skeletons.map((skeleton) => skeleton.color.contrast)) ?? base.color.contrast,
    },
    text_system: {
      headline_zone: mode(skeletons.map((skeleton) => skeleton.text_system.headline_zone)) ?? base.text_system.headline_zone,
      badge: mode(skeletons.map((skeleton) => skeleton.text_system.badge)) ?? base.text_system.badge,
      cta_style: mode(skeletons.map((skeleton) => skeleton.text_system.cta_style)) ?? base.text_system.cta_style,
    },
    copy: {
      hook_style: mode(skeletons.map((skeleton) => skeleton.copy.hook_style)) ?? base.copy.hook_style,
      headline_pattern: mode(skeletons.map((skeleton) => skeleton.copy.headline_pattern)) ?? base.copy.headline_pattern,
      cta: mode(skeletons.map((skeleton) => skeleton.copy.cta)) ?? base.copy.cta,
    },
    variables: [...new Set(skeletons.flatMap((skeleton) => skeleton.variables))].sort(),
    confidence: round1(skeletons.reduce((sum, skeleton) => sum + skeleton.confidence, 0) / skeletons.length),
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

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle];
}

function mode<T extends string>(values: Array<T | null | undefined>): T | null {
  const counts = new Map<T, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
}

function modePalette(skeletons: CreativeSkeleton[]): string[] | null {
  const counts = new Map<string, number>();
  for (const skeleton of skeletons) {
    for (const color of skeleton.color.palette) {
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }
  const palette = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([color]) => color);
  return palette.length > 0 ? palette : null;
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
