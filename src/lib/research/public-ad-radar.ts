import type { SupabaseClient } from "@supabase/supabase-js";

import {
  matchAdRadarCardsForLocation,
  resolveAdRadarLocationSearch,
  type AdRadarLocationGuess,
} from "./ad-radar-location.ts";
import {
  adRunningMs,
  CUSTOMER_META_AD_LIBRARY_CARD_SELECT,
  cleanCustomerMetaDisplayText,
  formatAdDuration,
  hasUnresolvedTemplateMarker,
  normaliseCustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCardRow,
} from "./customer-meta-card.ts";

export type PublicAdRadarSort = "recent" | "longest";

export type PublicAdRadarMedia = {
  kind: "image" | "video";
  url: string;
  posterUrl: string | null;
};

export type PublicAdRadarCard = {
  id: string;
  pageName: string;
  pageImageUrl: string | null;
  activeStatus: "active" | "inactive" | "unknown";
  startedAt: string | null;
  stoppedAt: string | null;
  lastSeenAt: string | null;
  durationLabel: string | null;
  platforms: string[];
  postcode: string | null;
  postcodes?: string[];
  suburb: string | null;
  state: string | null;
  headline: string | null;
  body: string | null;
  description: string | null;
  cta: string | null;
  destinationUrl: string | null;
  destinationDomain: string | null;
  adType: string | null;
  media: PublicAdRadarMedia[];
};

export type PublicAdRadarResponse = {
  location: {
    query: string;
    label: string;
    matched: boolean;
  };
  ads: PublicAdRadarCard[];
  nextCursor: string | null;
  source: "scraped";
};

type LoadPublicAdRadarInput = {
  location: string;
  cursor?: string | null;
  includeSurroundingSuburbs?: boolean;
  limit?: number;
  sort?: PublicAdRadarSort;
};

type CandidateBatch = {
  rows: CustomerMetaAdLibraryCardRow[];
  maybeMore: boolean;
};

type CandidateQueryGroups = {
  exact: Array<(offset: number, limit: number) => Promise<CustomerMetaAdLibraryCardRow[]>>;
  related: Array<(offset: number, limit: number) => Promise<CustomerMetaAdLibraryCardRow[]>>;
};

const DEFAULT_LIMIT = 18;
const MAX_LIMIT = 36;
const CANDIDATE_WINDOW = 90;
const MAX_WINDOWS_PER_REQUEST = 3;
const TEXT_FALLBACK_WINDOW = 18;
const LONGEST_RUNNING_WINDOW = 150;
const TEXT_SEARCH_COLUMNS = ["suburb", "page_name", "headline", "body", "description", "destination_url"] as const;
const IGNORED_DIRECT_SEARCH_TERMS = new Set([
  "act",
  "au",
  "australia",
  "australian",
  "nsw",
  "nt",
  "qld",
  "sa",
  "tas",
  "vic",
  "wa",
  "western",
]);

export async function loadPublicAdRadarCards(
  supabase: SupabaseClient,
  input: LoadPublicAdRadarInput,
): Promise<PublicAdRadarResponse> {
  const searchTerm = input.location.trim();
  const limit = clampNumber(input.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  const sort = input.sort === "longest" ? "longest" : "recent";
  const initialOffset = Math.max(Number.parseInt(input.cursor ?? "0", 10) || 0, 0);
  const includeSurroundingSuburbs = input.includeSurroundingSuburbs ?? true;
  const locationGuess = resolveAdRadarLocationSearch(searchTerm, { includeSurroundingSuburbs });

  if (!searchTerm) {
    return loadLongestRunningResponse(supabase, limit);
  }

  if (!locationGuess) {
    return publicResponse(searchTerm, searchTerm, false, [], null);
  }

  const cards = new Map<string, CustomerMetaAdLibraryCard>();
  let offset = initialOffset;
  let maybeMore = true;

  for (let windowIndex = 0; windowIndex < MAX_WINDOWS_PER_REQUEST && cards.size < limit && maybeMore; windowIndex += 1) {
    const batch = await loadCandidateRows(supabase, locationGuess, offset, CANDIDATE_WINDOW);
    const matched = selectMatchedCards(batch.rows.map(normaliseCustomerMetaAdLibraryCard), locationGuess, searchTerm, sort);

    for (const card of matched) {
      if (!cards.has(card.id)) cards.set(card.id, card);
    }

    maybeMore = batch.maybeMore;
    offset += CANDIDATE_WINDOW;
  }

  const now = Date.now();
  const orderedCards = selectMatchedCards([...cards.values()], locationGuess, searchTerm, sort);
  const publicCards = orderedCards
    .slice(0, limit)
    .map((card) => toPublicAdRadarCard(card, now, locationGuess));

  return publicResponse(searchTerm, locationGuess.label, publicCards.length > 0, publicCards, maybeMore ? String(offset) : null);
}

export function toPublicAdRadarCard(
  card: CustomerMetaAdLibraryCard,
  now = Date.now(),
  locationGuess?: AdRadarLocationGuess,
): PublicAdRadarCard {
  const runningMs = adRunningMs(card.startedAt, card.stoppedAt, now);
  const postcodes = resolvePublicPostcodes(card, locationGuess);
  const suburb = resolvePublicSuburb(card, locationGuess, postcodes);
  const destinationUrl = normalisePublicAdRadarUrl(card.destinationUrl);

  return {
    id: card.id,
    pageName: cleanCustomerMetaDisplayText(card.pageName) ?? "Unknown page",
    pageImageUrl: normalisePublicAdRadarUrl(card.pageImageUrl),
    activeStatus: card.activeStatus,
    startedAt: card.startedAt,
    stoppedAt: card.stoppedAt,
    lastSeenAt: card.lastSeenAt,
    durationLabel: runningMs === null ? null : formatAdDuration(runningMs, !card.stoppedAt),
    platforms: card.platforms.map(cleanCustomerMetaDisplayText).filter(isString),
    postcode: card.postcode ?? postcodes[0] ?? null,
    postcodes,
    suburb: cleanCustomerMetaDisplayText(suburb),
    state: cleanCustomerMetaDisplayText(card.state),
    headline: cleanCustomerMetaDisplayText(card.headline),
    body: cleanCustomerMetaDisplayText(card.body),
    description: cleanCustomerMetaDisplayText(card.description),
    cta: cleanCustomerMetaDisplayText(card.cta),
    destinationUrl,
    destinationDomain: destinationUrl ? displayDomain(destinationUrl) : null,
    adType: cleanCustomerMetaDisplayText(card.adType),
    media: card.media.flatMap((media) => {
      const url = normalisePublicAdRadarUrl(media.url);
      if (!url) return [];
      return [{
        kind: media.kind,
        url,
        posterUrl: normalisePublicAdRadarUrl(media.posterUrl),
      }];
    }).slice(0, 4),
  };
}

function normalisePublicAdRadarUrl(value: string | null): string | null {
  const url = value?.trim();
  if (!url || hasUnresolvedTemplateMarker(url) || !/^https?:\/\//i.test(url)) return null;
  return url;
}

function isString(value: string | null): value is string {
  return Boolean(value);
}

function resolvePublicSuburb(
  card: CustomerMetaAdLibraryCard,
  locationGuess: AdRadarLocationGuess | undefined,
  postcodes: string[],
): string | null {
  const suburb = card.suburb?.trim() || null;
  if (!locationGuess || !hasPostcodeTerm(locationGuess)) return suburb;

  const relevantPostcodes = uniquePostcodes(locationGuess.terms);
  if (
    relevantPostcodes.length > 0 &&
    postcodes.length > 0 &&
    !postcodes.some((postcode) => relevantPostcodes.includes(postcode))
  ) {
    return suburb;
  }

  const candidates = structuredSuburbTerms(locationGuess);
  if (candidates.length === 0) return suburb;

  const storedSuburb = suburb ? normaliseSearch(suburb) : "";
  const adCopy = normaliseSearch([
    card.headline,
    card.body,
    card.description,
    card.destinationUrl,
  ]
    .filter(Boolean)
    .join(" "));

  const ranked = candidates
    .map((candidate) => {
      const key = normaliseSearch(candidate);
      if (!key) return null;

      let score = 0;
      if (storedSuburb === key) score += 120;
      else if (storedSuburb && textIncludesNormalisedTerm(storedSuburb, key)) score += 20;
      if (textIncludesNormalisedTerm(adCopy, key)) score += 90;

      return { candidate, key, score };
    })
    .filter((entry): entry is { candidate: string; key: string; score: number } => entry !== null && entry.score > 0)
    .sort((a, b) => b.score - a.score || b.key.length - a.key.length);

  return ranked[0]?.candidate ?? suburb;
}

function resolvePublicPostcodes(card: CustomerMetaAdLibraryCard, locationGuess?: AdRadarLocationGuess): string[] {
  const structured = uniquePostcodes([card.postcode, ...card.postcodes]);
  const relevant = uniquePostcodes(locationGuess?.terms ?? []);
  const direct = card.postcode && /^\d{4}$/u.test(card.postcode) ? card.postcode : null;
  if (direct) {
    if (!locationGuess || relevant.length === 0) return uniquePostcodes([direct, ...card.postcodes]);
    return [direct];
  }

  const relevantStructured = relevant.filter((postcode) => structured.includes(postcode));
  if (relevantStructured.length > 0) return relevantStructured;
  if (structured.length > 0) return structured;

  const textPostcodes = uniquePostcodes([
    card.suburb,
    card.headline,
    card.body,
    card.description,
    card.destinationUrl,
  ].flatMap((value) => value?.match(/\b\d{4}\b/gu) ?? []));
  const relevantText = relevant.filter((postcode) => textPostcodes.includes(postcode));
  if (relevantText.length > 0) return relevantText;
  if (textPostcodes.length > 0) return textPostcodes;
  return relevant.length === 1 ? relevant : [];
}

function uniquePostcodes(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const postcode = value?.trim();
    if (!postcode || !/^\d{4}$/u.test(postcode) || seen.has(postcode)) continue;
    seen.add(postcode);
    out.push(postcode);
  }

  return out;
}

function selectMatchedCards(
  cards: CustomerMetaAdLibraryCard[],
  locationGuess: AdRadarLocationGuess,
  searchTerm: string,
  sort: PublicAdRadarSort,
): CustomerMetaAdLibraryCard[] {
  const locationMatches = matchAdRadarCardsForLocation(cards, locationGuess, sort);
  if (locationMatches.length > 0) return locationMatches;

  const directMatches = cards.filter((card) => cardMatchesSearch(card, searchTerm));
  return sortCards(directMatches, sort);
}

/**
 * No-location fallback: the longest-running ads across all coverage.
 * Active ads ordered by earliest delivery start, re-sorted in JS by actual
 * running time (handles stopped_at reconciliation), sliced to `limit`.
 */
async function loadLongestRunningResponse(
  supabase: SupabaseClient,
  limit: number,
): Promise<PublicAdRadarResponse> {
  const rows = await fetchLongestRunningRows(supabase, LONGEST_RUNNING_WINDOW);

  const now = Date.now();
  const cards = sortCards(dedupeRows(rows).map(normaliseCustomerMetaAdLibraryCard), "longest")
    .slice(0, limit)
    .map((card) => toPublicAdRadarCard(card, now));

  return publicResponse("", "All locations", false, cards, null);
}

async function fetchLongestRunningRows(
  supabase: SupabaseClient,
  limit: number,
): Promise<CustomerMetaAdLibraryCardRow[]> {
  const query = supabase
    .from("customer_ad_radar_cards")
    .select(CUSTOMER_META_AD_LIBRARY_CARD_SELECT)
    .eq("active_status", "active")
    .not("ad_delivery_started_at", "is", null)
    .order("ad_delivery_started_at", { ascending: true })
    .limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CustomerMetaAdLibraryCardRow[];
}

async function loadCandidateRows(
  supabase: SupabaseClient,
  locationGuess: AdRadarLocationGuess,
  offset: number,
  limit: number,
): Promise<CandidateBatch> {
  const structuredQueryLoaders = structuredLocationCandidateQueries(supabase, locationGuess);
  const exactBatches = await Promise.all(structuredQueryLoaders.exact.map((query) => query(offset, limit)));
  let structuredRows = dedupeRows(exactBatches.flat());
  let maybeMore = exactBatches.some((batch) => batch.length >= limit);

  if (structuredRows.length === 0 || structuredQueryLoaders.related.length > 0) {
    const relatedBatches = await Promise.all(structuredQueryLoaders.related.map((query) => query(offset, limit)));
    structuredRows = dedupeRows([...structuredRows, ...relatedBatches.flat()]);
    maybeMore = maybeMore || relatedBatches.some((batch) => batch.length >= limit);
  }

  const fallbackRows = offset === 0 && structuredRows.length === 0 && !hasPostcodeTerm(locationGuess)
    ? await loadTextFallbackRows(supabase, locationGuess)
    : [];
  const rows = dedupeRows([...structuredRows, ...fallbackRows]);

  return {
    rows,
    maybeMore,
  };
}

function structuredLocationCandidateQueries(
  supabase: SupabaseClient,
  locationGuess: AdRadarLocationGuess,
): CandidateQueryGroups {
  const exact: CandidateQueryGroups["exact"] = [];
  const related: CandidateQueryGroups["related"] = [];
  const suburbTerms = structuredSuburbTerms(locationGuess);
  const state = locationGuess.stateCode?.trim().toUpperCase();
  const postcodes = locationGuess.terms.filter((term) => /^\d{4}$/.test(term));

  if (postcodes.length > 0) {
    exact.push((offset, limit) => fetchRows(supabase, offset, limit, (query) => query.in("postcode", postcodes)));
    exact.push((offset, limit) => fetchRows(supabase, offset, limit, (query) => query.overlaps("ad_area_postcodes", postcodes)));
  }

  for (const suburb of suburbTerms) {
    related.push((offset, limit) => fetchRows(supabase, offset, limit, (query) => query.ilike("suburb", escapeLikeTerm(suburb))));
  }
  if (suburbTerms.length > 0) {
    related.push((offset, limit) => fetchRows(supabase, offset, limit, (query) => query.overlaps("ad_area_suburbs", suburbTerms)));
  }

  if (suburbTerms.length === 0 && postcodes.length === 0 && state) {
    related.push((offset, limit) => fetchRows(supabase, offset, limit, (query) => query.eq("state", state)));
  }

  return { exact, related };
}

async function loadTextFallbackRows(
  supabase: SupabaseClient,
  locationGuess: AdRadarLocationGuess,
): Promise<CustomerMetaAdLibraryCardRow[]> {
  const city = locationGuess.city?.trim();
  const postcodes = locationGuess.terms.filter((term) => /^\d{4}$/.test(term));
  const areaTextTerms = locationGuess.terms.filter((term) => isAreaTextSearchTerm(term, city, locationGuess));
  const terms = [...new Set([city, ...postcodes.slice(0, 2), ...areaTextTerms.slice(0, 5)].filter(Boolean))] as string[];
  const rows: CustomerMetaAdLibraryCardRow[] = [];

  for (const term of terms) {
    for (const column of TEXT_SEARCH_COLUMNS) {
      try {
        rows.push(...await fetchRows(
          supabase,
          0,
          TEXT_FALLBACK_WINDOW,
          (query) => query.ilike(column, `%${escapeLikeTerm(term)}%`),
        ));
      } catch (error) {
        if (!isRecoverableTextFallbackError(error)) throw error;
      }
    }
  }

  return dedupeRows(rows);
}

function isRecoverableTextFallbackError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /statement timeout|canceling statement|timeout/i.test(message);
}

function isAreaTextSearchTerm(term: string, city: string | undefined, locationGuess: AdRadarLocationGuess): boolean {
  const clean = term.trim();
  const normalised = normaliseSearch(clean);
  if (!normalised || /\b\d{4}\b/.test(clean) || IGNORED_DIRECT_SEARCH_TERMS.has(normalised)) return false;
  if (city && normalised === normaliseSearch(city)) return false;
  if (locationGuess.stateCode && normalised === normaliseSearch(locationGuess.stateCode)) return false;
  if (locationGuess.stateName && normalised === normaliseSearch(locationGuess.stateName)) return false;
  return true;
}

function hasPostcodeTerm(locationGuess: AdRadarLocationGuess): boolean {
  return locationGuess.terms.some((term) => /^\d{4}$/.test(term));
}

function structuredSuburbTerms(locationGuess: AdRadarLocationGuess): string[] {
  const seen = new Set<string>();
  const suburbs: string[] = [];

  for (const term of locationGuess.terms) {
    if (!isAreaTextSearchTerm(term, undefined, locationGuess)) continue;
    const key = normaliseSearch(term);
    if (seen.has(key)) continue;
    seen.add(key);
    suburbs.push(term);
  }

  return suburbs.slice(0, 10);
}

async function fetchRows(
  supabase: SupabaseClient,
  offset: number,
  limit: number,
  applyFilter: (query: any) => any,
): Promise<CustomerMetaAdLibraryCardRow[]> {
  let query = supabase
    .from("customer_ad_radar_cards")
    .select(CUSTOMER_META_AD_LIBRARY_CARD_SELECT)
    .eq("active_status", "active")
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  query = applyFilter(query);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CustomerMetaAdLibraryCardRow[];
}

function cardMatchesSearch(card: CustomerMetaAdLibraryCard, searchTerm: string): boolean {
  const terms = meaningfulDirectSearchTerms(searchTerm);
  if (terms.length === 0) return false;

  const haystack = normaliseSearch([
    card.pageName,
    card.postcode,
    card.suburb,
    card.state,
    card.headline,
    card.body,
    card.description,
    card.cta,
    card.destinationUrl,
    ...card.postcodes,
    ...card.platforms,
  ]
    .filter(Boolean)
    .join(" "));

  return terms.some((term) => textIncludesNormalisedTerm(haystack, term));
}

function sortCards(cards: CustomerMetaAdLibraryCard[], sort: PublicAdRadarSort): CustomerMetaAdLibraryCard[] {
  if (sort === "longest") {
    const now = Date.now();
    return [...cards].sort((a, b) => {
      const aMs = adRunningMs(a.startedAt, a.stoppedAt, now);
      const bMs = adRunningMs(b.startedAt, b.stoppedAt, now);
      return (bMs ?? -1) - (aMs ?? -1);
    });
  }

  return [...cards].sort((a, b) => dateValue(b.lastSeenAt) - dateValue(a.lastSeenAt));
}

function publicResponse(
  query: string,
  label: string,
  matched: boolean,
  ads: PublicAdRadarCard[],
  nextCursor: string | null,
): PublicAdRadarResponse {
  return {
    location: { query, label, matched },
    ads,
    nextCursor,
    source: "scraped",
  };
}

function dedupeRows(rows: CustomerMetaAdLibraryCardRow[]): CustomerMetaAdLibraryCardRow[] {
  const seen = new Set<string>();
  const deduped: CustomerMetaAdLibraryCardRow[] = [];

  for (const row of rows) {
    const key = row.card_id ?? row.library_id ?? [row.page_id, row.page_name, row.last_seen_at].filter(Boolean).join(":");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function displayDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return "Destination";
  }
}

function dateValue(value: string | null): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normaliseSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function meaningfulDirectSearchTerms(value: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const term of normaliseSearch(value).split(" ")) {
    if (term.length < 2 || IGNORED_DIRECT_SEARCH_TERMS.has(term) || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }

  return terms;
}

function textIncludesNormalisedTerm(text: string, term: string): boolean {
  return ` ${text} `.includes(` ${term} `);
}

function escapeLikeTerm(value: string): string {
  return value.replace(/[%_]/g, "");
}
