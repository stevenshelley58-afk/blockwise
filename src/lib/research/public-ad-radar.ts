import type { SupabaseClient } from "@supabase/supabase-js";

import {
  matchAdRadarCardsForLocation,
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
  limit?: number;
  sort?: PublicAdRadarSort;
};

type CandidateBatch = {
  rows: CustomerMetaAdLibraryCardRow[];
  maybeMore: boolean;
};

const DEFAULT_LIMIT = 18;
const MAX_LIMIT = 36;
const CANDIDATE_WINDOW = 90;
const MAX_WINDOWS_PER_REQUEST = 3;
const TEXT_FALLBACK_WINDOW = 18;
const LONGEST_RUNNING_WINDOW = 150;
const TEXT_SEARCH_COLUMNS = ["page_name", "headline", "body"] as const;
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
  const locationGuess = resolveAdRadarLocationSearch(searchTerm);

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

  return {
    id: card.id,
    pageName: card.pageName,
    pageImageUrl: card.pageImageUrl,
    activeStatus: card.activeStatus,
    startedAt: card.startedAt,
    stoppedAt: card.stoppedAt,
    lastSeenAt: card.lastSeenAt,
    durationLabel: runningMs === null ? null : formatAdDuration(runningMs, !card.stoppedAt),
    platforms: card.platforms,
    postcode: card.postcode ?? postcodes[0] ?? null,
    postcodes,
    suburb: card.suburb,
    state: card.state,
    headline: card.headline,
    body: card.body,
    description: card.description,
    cta: card.cta,
    destinationUrl: card.destinationUrl,
    destinationDomain: card.destinationUrl ? displayDomain(card.destinationUrl) : null,
    media: card.media.slice(0, 4).map((media) => ({
      kind: media.kind,
      url: media.url,
      posterUrl: media.posterUrl,
    })),
  };
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
  let rows = await fetchLongestRunningRows(supabase, LONGEST_RUNNING_WINDOW, true);
  if (rows.length === 0) rows = await fetchLongestRunningRows(supabase, LONGEST_RUNNING_WINDOW, false);

  const now = Date.now();
  const cards = sortCards(dedupeRows(rows).map(normaliseCustomerMetaAdLibraryCard), "longest")
    .slice(0, limit)
    .map((card) => toPublicAdRadarCard(card, now));

  return publicResponse("", "Australia", false, cards, null);
}

async function fetchLongestRunningRows(
  supabase: SupabaseClient,
  limit: number,
  activeOnly: boolean,
): Promise<CustomerMetaAdLibraryCardRow[]> {
  let query = supabase
    .schema("research")
    .from("v_customer_meta_ad_library_cards")
    .select(CUSTOMER_META_AD_LIBRARY_CARD_SELECT)
    .not("ad_delivery_started_at", "is", null)
    .order("ad_delivery_started_at", { ascending: true })
    .limit(limit);

  if (activeOnly) query = query.ilike("active_status", "active");

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
  const structuredBatches = await Promise.all(structuredQueryLoaders.map((query) => query(offset, limit)));
  const structuredRows = dedupeRows(structuredBatches.flat());

  if (structuredRows.length >= Math.min(limit, DEFAULT_LIMIT)) {
    return {
      rows: structuredRows,
      maybeMore: structuredBatches.some((batch) => batch.length >= limit),
    };
  }

  const fallbackRows = offset === 0
    ? await loadTextFallbackRows(supabase, locationGuess)
    : [];
  const rows = dedupeRows([...structuredRows, ...fallbackRows]);

  return {
    rows,
    maybeMore: structuredBatches.some((batch) => batch.length >= limit),
  };
}

function structuredLocationCandidateQueries(
  supabase: SupabaseClient,
  locationGuess: AdRadarLocationGuess,
): Array<(offset: number, limit: number) => Promise<CustomerMetaAdLibraryCardRow[]>> {
  const queries: Array<(offset: number, limit: number) => Promise<CustomerMetaAdLibraryCardRow[]>> = [];
  const city = locationGuess.city?.trim();
  const state = locationGuess.stateCode?.trim().toUpperCase();
  const postcodes = locationGuess.terms.filter((term) => /^\d{4}$/.test(term));

  if (city) {
    queries.push((offset, limit) => fetchRows(supabase, offset, limit, (query) => query.eq("suburb", city)));
  }

  if (postcodes.length > 0) {
    queries.push((offset, limit) => fetchRows(supabase, offset, limit, (query) => query.in("postcode", postcodes)));
  }

  if (!city && postcodes.length === 0 && state) {
    queries.push((offset, limit) => fetchRows(supabase, offset, limit, (query) => query.eq("state", state)));
  }

  return queries;
}

async function loadTextFallbackRows(
  supabase: SupabaseClient,
  locationGuess: AdRadarLocationGuess,
): Promise<CustomerMetaAdLibraryCardRow[]> {
  const city = locationGuess.city?.trim();
  const postcodes = locationGuess.terms.filter((term) => /^\d{4}$/.test(term));
  const areaTextTerms = locationGuess.terms.filter((term) => isAreaTextSearchTerm(term, city, locationGuess));
  const terms = [...new Set([city, ...postcodes.slice(0, 2), ...areaTextTerms.slice(0, 3)].filter(Boolean))] as string[];
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
  if (!normalised || /^\d{4}$/.test(clean) || IGNORED_DIRECT_SEARCH_TERMS.has(normalised)) return false;
  if (city && normalised === normaliseSearch(city)) return false;
  if (locationGuess.stateCode && normalised === normaliseSearch(locationGuess.stateCode)) return false;
  if (locationGuess.stateName && normalised === normaliseSearch(locationGuess.stateName)) return false;
  return true;
}

async function fetchRows(
  supabase: SupabaseClient,
  offset: number,
  limit: number,
  applyFilter: (query: any) => any,
): Promise<CustomerMetaAdLibraryCardRow[]> {
  let query = supabase
    .schema("research")
    .from("v_customer_meta_ad_library_cards")
    .select(CUSTOMER_META_AD_LIBRARY_CARD_SELECT)
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
