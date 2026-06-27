import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveAdRadarLocationSearch,
  type AdRadarLocationGuess,
} from "./ad-radar-location.ts";
import {
  adRunningMs,
  CUSTOMER_META_AD_LIBRARY_CARD_SELECT,
  formatAdDuration,
  normaliseCustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCardRow,
} from "./customer-meta-card.ts";
import { toPublicAdRadarCard, type PublicAdRadarCard } from "./public-ad-radar.ts";

/**
 * Local Ad Market Audit.
 *
 * Aggregates scraped Meta Ad Library cards for a suburb + surrounding area into
 * the report shown on /audit: totals, longest-running creatives (the strongest
 * available public signal an angle keeps running), top advertisers, and format
 * / platform / angle breakdowns. Advertisers are first classified so only real
 * estate advertisers feed the headline numbers. computeAuditStats is pure
 * (unit-tested); buildAdAudit wraps it with the Supabase query over
 * research.v_customer_meta_ad_library_cards.
 */

const RESEARCH_SCHEMA = "research";
const CARD_VIEW = "v_customer_meta_ad_library_cards";
const PER_FILTER_LIMIT = 250;
const FETCH_CAP = 800;
const MAX_SUBURB_FILTERS = 10;
const TOP_ADVERTISERS = 12;
const TOP_ADS = 8;
const TOP_CTAS = 6;
const RECENT_WINDOW_DAYS = 30;
const MONTH_BUCKETS = 12;
const DAY_MS = 86_400_000;

const IGNORED_AREA_TERMS = new Set([
  "act", "au", "australia", "australian", "nsw", "nt", "qld", "sa", "tas", "vic", "wa", "western",
]);

export type AuditCount = { label: string; count: number };

export type RealEstateClass =
  | "real_estate_agency"
  | "real_estate_related"
  | "non_real_estate"
  | "unknown";

export type AuditAdvertiser = {
  name: string;
  ads: number;
  active: number;
  activeRate: number;
  longestRunningDays: number;
  topAngle: string | null;
};

export type ExcludedAdvertiser = {
  name: string;
  ads: number;
  classification: RealEstateClass;
};

export type AuditTopAd = {
  id: string;
  pageName: string;
  headline: string | null;
  body: string | null;
  cta: string | null;
  status: "active" | "inactive" | "unknown";
  daysRunning: number;
  durationLabel: string;
  startedAt: string | null;
  destinationDomain: string | null;
  platforms: string[];
  adType: string | null;
};

export type AuditMonthBucket = { month: string; label: string; count: number };

export type AdAuditStats = {
  totals: { detected: number; active: number; inactive: number; activeRate: number };
  advertiserCount: number;
  topAdvertisers: AuditAdvertiser[];
  longestRunning: AuditTopAd[];
  formats: AuditCount[];
  platforms: AuditCount[];
  adTypes: AuditCount[];
  topCtas: AuditCount[];
  commonHooks: AuditCount[];
  newLast30Days: number;
  launchesByMonth: AuditMonthBucket[];
  medianDaysRunning: number;
  longestRunningDays: number;
  sampleSize: number;
  capped: boolean;
};

export type AdAuditResult = {
  location: { query: string; label: string; state: string | null; matched: boolean };
  generatedAt: string;
  stats: AdAuditStats;
  topAds: PublicAdRadarCard[];
  excludedAdvertisers: ExcludedAdvertiser[];
};

type AreaFilter = { postcodes: string[]; suburbs: string[]; state: string | null };

type AreaQuery = {
  in(column: string, values: string[]): AreaQuery;
  overlaps(column: string, values: string[]): AreaQuery;
  ilike(column: string, pattern: string): AreaQuery;
  eq(column: string, value: string): AreaQuery;
};

/** Build the full audit for a location string; falls back to Perth, WA. */
export async function buildAdAudit(
  supabase: SupabaseClient,
  input: { location: string },
): Promise<AdAuditResult> {
  const searchTerm = input.location.trim();
  const guess =
    resolveAdRadarLocationSearch(searchTerm, { includeSurroundingSuburbs: true }) ??
    resolveAdRadarLocationSearch("Perth, WA", { includeSurroundingSuburbs: true });

  const now = Date.now();

  if (!guess) {
    return {
      location: { query: searchTerm, label: searchTerm || "Australia", state: null, matched: false },
      generatedAt: new Date(now).toISOString(),
      stats: computeAuditStats([], { now }),
      topAds: [],
      excludedAdvertisers: [],
    };
  }

  const filter = areaFilterFromGuess(guess);
  const { rows, capped } = await fetchAreaRows(supabase, filter);
  const cards = dedupeCards(rows.map(normaliseCustomerMetaAdLibraryCard));
  const { included, excludedAdvertisers } = partitionRealEstateCards(cards);

  return {
    location: {
      query: searchTerm,
      label: guess.label,
      state: guess.stateCode,
      matched: included.length > 0,
    },
    generatedAt: new Date(now).toISOString(),
    stats: computeAuditStats(included, { now, capped }),
    topAds: pickTopAds(included, now, guess),
    excludedAdvertisers,
  };
}

// ---------------------------------------------------------------------------
// Real-estate relevance classification
// ---------------------------------------------------------------------------

// Strong real-estate brand / generic tokens in an advertiser name => agency.
const RE_AGENCY_NAME_TOKENS = [
  "real estate", "realestate", "realty", "realtor", "estate agent", "estate agency",
  "property partners", "property group", "property co", "property perth",
  "ray white", "harcourts", "lj hooker", "l j hooker", "raine & horne", "raine and horne",
  "belle property", "acton", "professionals", "century 21", "century21", "elders",
  "mcgrath", "the agency", "barry plant", "jellis craig", "nelson alexander", "buxton",
  "marshall white", "biggin", "stockdale", "hocking stuart", "o'brien real", "obrien real",
  "one agency", "ouwens casserly", "harris real", "first national", "knight frank",
  "colliers", "explore property", "@realty", "first home buyers",
];

// A standalone "property"/"properties" word in the name is treated as agency.
const RE_PROPERTY_WORD = /\bpropert(?:y|ies)\b/;

// Real-estate-adjacent names (finance, management, development) => related.
const RE_RELATED_NAME_TOKENS = [
  "buyers agent", "buyer's agent", "buyers agency", "buyer's agency", "buyers advocate",
  "mortgage", "home loans", "finance broker", "conveyanc", "settlement agent",
  "property management", "property manager", "developer", "developments",
  "home builder", "first home",
];

// Clear non-real-estate categories. Deliberately uses tokens that do not show
// up in property listing copy (avoids "cafe", "gym", "home" that appear in
// listing location/feature descriptions).
const HARD_NON_RE_TOKENS = [
  "disability", "ndis", "sda ", "supported independent", "supported living",
  "aged care", "nursing home", "retirement village", "child care", "childcare",
  "early learning", "dentist", "dental clinic", "orthodontic", "physiotherapy",
  "chiropractic", "podiatry", "veterinary", "vet clinic", "plumbing services",
  "electrician", "roof repair", "barbershop", "hair salon", "nail salon",
  "tattoo studio", "mosque", "pharmacy", "dental practice",
];

// Listing-intent phrases that mark an advertiser's ads as real estate even when
// the name has no real-estate keyword (e.g. "Shellabears").
const RE_TEXT_TOKENS = [
  "for sale", "for lease", "just listed", "just sold", "now selling", "under offer",
  "under contract", "off market", "off-market", "home open", "open home",
  "open for inspection", "expressions of interest", "offers over", "offers above",
  "price guide", "under application", "appraisal", "home worth", "property report",
  "new listing", "sold by", "listed by", "proudly present", "for rent",
  "property management",
];
const RE_TEXT_REGEX = /\b\d+\s*(?:bed|bath|car)\b|\bsqm\b|\bfloor\s?plan\b|\binspection times?\b/;

/** Classify an advertiser from its display name plus its aggregated ad copy. */
export function classifyAdvertiser(name: string, adText: string): RealEstateClass {
  const lowerName = name.toLowerCase();
  const full = `${lowerName} ${adText.toLowerCase()}`;

  // A real-estate brand in the name wins over any stray non-RE keyword.
  if (RE_AGENCY_NAME_TOKENS.some((token) => lowerName.includes(token)) || RE_PROPERTY_WORD.test(lowerName)) {
    return "real_estate_agency";
  }

  if (HARD_NON_RE_TOKENS.some((token) => full.includes(token))) {
    return "non_real_estate";
  }

  if (RE_RELATED_NAME_TOKENS.some((token) => lowerName.includes(token))) {
    return "real_estate_related";
  }

  if (RE_TEXT_TOKENS.some((token) => full.includes(token)) || RE_TEXT_REGEX.test(full)) {
    return "real_estate_related";
  }

  return "unknown";
}

export type RealEstatePartition = {
  included: CustomerMetaAdLibraryCard[];
  excludedAdvertisers: ExcludedAdvertiser[];
};

/**
 * Partition cards into real-estate advertisers (agency or related) and the rest.
 * Classification happens per advertiser over all of that advertiser's ad copy so
 * an advertiser is wholly included or wholly excluded and the tables stay
 * internally consistent with the headline numbers.
 */
export function partitionRealEstateCards(cards: CustomerMetaAdLibraryCard[]): RealEstatePartition {
  const groups = new Map<string, { name: string; cards: CustomerMetaAdLibraryCard[]; text: string }>();

  for (const card of cards) {
    const name = advertiserName(card);
    const key = name.toLowerCase();
    const entry = groups.get(key) ?? { name, cards: [], text: "" };
    entry.cards.push(card);
    entry.text += ` ${advertiserText(card)}`;
    groups.set(key, entry);
  }

  const included: CustomerMetaAdLibraryCard[] = [];
  const excludedAdvertisers: ExcludedAdvertiser[] = [];

  for (const entry of groups.values()) {
    const classification = classifyAdvertiser(entry.name, entry.text);
    if (classification === "real_estate_agency" || classification === "real_estate_related") {
      included.push(...entry.cards);
    } else {
      excludedAdvertisers.push({ name: entry.name, ads: entry.cards.length, classification });
    }
  }

  excludedAdvertisers.sort((a, b) => b.ads - a.ads);
  return { included, excludedAdvertisers };
}

function advertiserName(card: CustomerMetaAdLibraryCard): string {
  return (card.agencyName ?? card.pageName ?? "").trim() || "Unknown advertiser";
}

function advertiserText(card: CustomerMetaAdLibraryCard): string {
  return [card.headline, card.body, card.description, card.cta].filter(Boolean).join(" ");
}

/** Pure aggregation over an already-deduped set of cards. No I/O. */
export function computeAuditStats(
  cards: CustomerMetaAdLibraryCard[],
  options: { now?: number; capped?: boolean } = {},
): AdAuditStats {
  const now = options.now ?? Date.now();
  const detected = cards.length;
  const active = cards.filter((card) => card.activeStatus === "active").length;
  const inactive = detected - active;

  const advertiserStats = aggregateAdvertisers(cards, now);
  const runningDays = cards
    .map((card) => daysRunning(card, now))
    .filter((value): value is number => value !== null);

  return {
    totals: { detected, active, inactive, activeRate: detected > 0 ? active / detected : 0 },
    advertiserCount: advertiserStats.length,
    topAdvertisers: advertiserStats.slice(0, TOP_ADVERTISERS),
    longestRunning: longestRunningAds(cards, now),
    formats: countBy(cards, (card) => resolveFormatLabel(card)),
    platforms: countPlatforms(cards),
    adTypes: countBy(cards, (card) => inferAngle(card)),
    topCtas: countBy(cards, (card) => card.cta).slice(0, TOP_CTAS),
    commonHooks: [],
    newLast30Days: cards.filter((card) => withinDays(card.startedAt, RECENT_WINDOW_DAYS, now)).length,
    launchesByMonth: launchesByMonth(cards, now),
    medianDaysRunning: median(runningDays),
    longestRunningDays: runningDays.length > 0 ? Math.max(...runningDays) : 0,
    sampleSize: detected,
    capped: Boolean(options.capped),
  };
}

function aggregateAdvertisers(cards: CustomerMetaAdLibraryCard[], now: number): AuditAdvertiser[] {
  const map = new Map<
    string,
    { name: string; ads: number; active: number; longest: number; angles: Map<string, number> }
  >();

  for (const card of cards) {
    const name = advertiserName(card);
    const key = name.toLowerCase();
    const entry = map.get(key) ?? { name, ads: 0, active: 0, longest: 0, angles: new Map<string, number>() };
    entry.ads += 1;
    if (card.activeStatus === "active") entry.active += 1;
    const days = daysRunning(card, now);
    if (days !== null && days > entry.longest) entry.longest = days;
    const angle = inferAngle(card);
    if (angle) entry.angles.set(angle, (entry.angles.get(angle) ?? 0) + 1);
    map.set(key, entry);
  }

  return [...map.values()]
    .map((entry) => ({
      name: entry.name,
      ads: entry.ads,
      active: entry.active,
      activeRate: entry.ads > 0 ? entry.active / entry.ads : 0,
      longestRunningDays: entry.longest,
      topAngle: topLabel(entry.angles),
    }))
    .sort((a, b) => b.ads - a.ads || b.longestRunningDays - a.longestRunningDays);
}

function topLabel(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

function longestRunningAds(cards: CustomerMetaAdLibraryCard[], now: number): AuditTopAd[] {
  const seen = new Set<string>();
  const unique: Array<{ card: CustomerMetaAdLibraryCard; days: number }> = [];

  for (const card of cards) {
    const days = daysRunning(card, now);
    if (days === null) continue;
    const signature = creativeSignature(card);
    if (seen.has(signature)) continue;
    seen.add(signature);
    unique.push({ card, days });
  }

  return unique
    .sort((a, b) => b.days - a.days)
    .slice(0, TOP_ADS)
    .map(({ card, days }) => ({
      id: card.id,
      pageName: card.agencyName ?? card.pageName,
      headline: card.headline,
      body: card.body,
      cta: card.cta,
      status: card.activeStatus,
      daysRunning: days,
      durationLabel: formatAdDuration(days * DAY_MS, !card.stoppedAt),
      startedAt: card.startedAt,
      destinationDomain: domainFromUrl(card.destinationUrl),
      platforms: card.platforms,
      adType: inferAngle(card),
    }));
}

function pickTopAds(
  cards: CustomerMetaAdLibraryCard[],
  now: number,
  guess: AdRadarLocationGuess,
): PublicAdRadarCard[] {
  const seen = new Set<string>();
  const ranked = cards
    .map((card) => ({ card, days: daysRunning(card, now) }))
    .filter((entry): entry is { card: CustomerMetaAdLibraryCard; days: number } => entry.days !== null)
    .sort((a, b) => b.days - a.days);

  const out: PublicAdRadarCard[] = [];
  for (const { card } of ranked) {
    const signature = creativeSignature(card);
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push(toPublicAdRadarCard(card, now, guess));
    if (out.length >= 6) break;
  }
  return out;
}

function countBy(
  cards: CustomerMetaAdLibraryCard[],
  selector: (card: CustomerMetaAdLibraryCard) => string | null,
): AuditCount[] {
  return countValues(cards.map(selector));
}

function countValues(values: Array<string | null | undefined>): AuditCount[] {
  const map = new Map<string, { label: string; count: number }>();
  for (const value of values) {
    const label = value?.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const entry = map.get(key) ?? { label, count: 0 };
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function countPlatforms(cards: CustomerMetaAdLibraryCard[]): AuditCount[] {
  return countValues(cards.flatMap((card) => card.platforms));
}

function launchesByMonth(cards: CustomerMetaAdLibraryCard[], now: number): AuditMonthBucket[] {
  const buckets = new Map<string, number>();
  const start = new Date(now);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCMonth(start.getUTCMonth() - (MONTH_BUCKETS - 1));

  const order: AuditMonthBucket[] = [];
  for (let i = 0; i < MONTH_BUCKETS; i += 1) {
    const date = new Date(start);
    date.setUTCMonth(start.getUTCMonth() + i);
    const month = monthKey(date);
    buckets.set(month, 0);
    order.push({ month, label: monthLabel(date), count: 0 });
  }

  for (const card of cards) {
    if (!card.startedAt) continue;
    const started = new Date(card.startedAt);
    if (Number.isNaN(started.getTime())) continue;
    const month = monthKey(started);
    if (buckets.has(month)) buckets.set(month, (buckets.get(month) ?? 0) + 1);
  }

  return order.map((bucket) => ({ ...bucket, count: buckets.get(bucket.month) ?? 0 }));
}

function areaFilterFromGuess(guess: AdRadarLocationGuess): AreaFilter {
  const postcodes: string[] = [];
  const suburbs: string[] = [];
  const seenSuburbs = new Set<string>();

  for (const term of guess.terms) {
    const clean = term.trim();
    if (!clean) continue;
    if (/^\d{4}$/.test(clean)) {
      if (!postcodes.includes(clean)) postcodes.push(clean);
      continue;
    }
    const normalised = clean.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!normalised || IGNORED_AREA_TERMS.has(normalised)) continue;
    if (guess.stateName && normalised === guess.stateName.toLowerCase()) continue;
    if (seenSuburbs.has(normalised)) continue;
    seenSuburbs.add(normalised);
    suburbs.push(clean);
  }

  return { postcodes, suburbs: suburbs.slice(0, MAX_SUBURB_FILTERS), state: guess.stateCode };
}

async function fetchAreaRows(
  supabase: SupabaseClient,
  filter: AreaFilter,
): Promise<{ rows: CustomerMetaAdLibraryCardRow[]; capped: boolean }> {
  const runners: Array<(query: AreaQuery) => AreaQuery> = [];

  if (filter.postcodes.length > 0) {
    runners.push((query) => query.in("postcode", filter.postcodes));
    runners.push((query) => query.overlaps("ad_area_postcodes", filter.postcodes));
  }

  for (const suburb of filter.suburbs) {
    const term = escapeLikeTerm(suburb);
    if (term) runners.push((query) => query.ilike("suburb", `%${term}%`));
  }

  if (runners.length === 0 && filter.state) {
    const state = filter.state;
    runners.push((query) => query.eq("state", state));
  }

  if (runners.length === 0) return { rows: [], capped: false };

  const seen = new Set<string>();
  const rows: CustomerMetaAdLibraryCardRow[] = [];
  let capped = false;

  for (const applyFilter of runners) {
    if (rows.length >= FETCH_CAP) {
      capped = true;
      break;
    }

    const baseQuery = supabase
      .schema(RESEARCH_SCHEMA)
      .from(CARD_VIEW)
      .select(CUSTOMER_META_AD_LIBRARY_CARD_SELECT)
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .order("card_id", { ascending: true })
      .limit(PER_FILTER_LIMIT);

    const query = applyFilter(baseQuery as unknown as AreaQuery);
    const { data, error } = await (query as unknown as PromiseLike<{
      data: CustomerMetaAdLibraryCardRow[] | null;
      error: { message: string } | null;
    }>);
    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const key = rowKey(row);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }

  return { rows: rows.slice(0, FETCH_CAP), capped: capped || rows.length > FETCH_CAP };
}

function dedupeCards(cards: CustomerMetaAdLibraryCard[]): CustomerMetaAdLibraryCard[] {
  const seen = new Set<string>();
  const out: CustomerMetaAdLibraryCard[] = [];
  for (const card of cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    out.push(card);
  }
  return out;
}

function daysRunning(card: CustomerMetaAdLibraryCard, now: number): number | null {
  const ms = adRunningMs(card.startedAt, card.stoppedAt, now);
  if (ms === null) return null;
  return Math.floor(ms / DAY_MS);
}

function creativeSignature(card: CustomerMetaAdLibraryCard): string {
  const parts = [card.agencyName ?? card.pageName, card.headline, card.body?.slice(0, 120)]
    .map((part) => (part ?? "").toLowerCase().replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join("|") : card.id;
}

function resolveFormatLabel(card: CustomerMetaAdLibraryCard): string {
  const videos = card.media.filter((media) => media.kind === "video").length;
  const images = card.media.filter((media) => media.kind === "image").length;
  if (videos > 0 && images === 0) return "Video";
  if (videos > 0) return "Mixed";
  if (images > 1) return "Carousel";
  if (images === 1) return "Image";
  return "Text";
}

/** Infer the campaign angle from ad copy, since the view has no ad_type column. */
function inferAngle(card: CustomerMetaAdLibraryCard): string | null {
  const text = `${card.headline ?? ""} ${card.body ?? ""}`.toLowerCase();
  if (!text.trim()) return null;
  if (/\bappraisal\b|home worth|what is your home worth|property report/.test(text)) return "Free Appraisal";
  if (/just sold|\bsold\b|under offer/.test(text)) return "Just Sold";
  if (/just listed|new listing|now selling|\bfor sale\b/.test(text)) return "Just Listed";
  if (/open (home|inspection)|home open|inspect this/.test(text)) return "Open Home";
  if (/market (update|report)|median|price growth|suburb report/.test(text)) return "Market Update";
  if (/for lease|rental|property management|landlord/.test(text)) return "Property Management";
  return null;
}

function withinDays(value: string | null, days: number, now: number): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  return now - time <= days * DAY_MS && time <= now;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function domainFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-AU", { month: "short", timeZone: "UTC" }).format(date);
}

function escapeLikeTerm(value: string): string {
  return value.replace(/[%_,]/g, " ").replace(/\s+/g, " ").trim();
}

function rowKey(row: CustomerMetaAdLibraryCardRow): string | null {
  const composite = [row.page_id, row.page_name, row.last_seen_at].filter(Boolean).join(":");
  return row.card_id ?? row.library_id ?? (composite || null);
}
