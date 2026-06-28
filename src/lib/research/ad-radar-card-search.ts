import {
  matchAdRadarCardsForLocation,
  resolveAdRadarLocationSearch,
  shouldPrioritiseAdRadarLocationSearch,
  type AdRadarLocationGuess,
} from "./ad-radar-location.ts";
import {
  adRunningMs,
  CUSTOMER_META_AD_LIBRARY_CARD_SELECT,
  normaliseCustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCardRow,
} from "./customer-meta-card.ts";
import { normaliseAdRadarSort, type AdRadarSort } from "./ad-radar-sort.ts";

export type AdRadarCardSearchSort = AdRadarSort;

export type AdRadarCardSearchFilters = {
  status?: "active" | "inactive";
  agency?: string;
  agent?: string;
  adType?: string;
  format?: string;
  hook?: string;
};

type SearchSupabaseClient = {
  schema: (schema: "research") => any;
};

type SearchInput = {
  query: string;
  sort?: AdRadarCardSearchSort;
  includeSurroundingSuburbs?: boolean;
  filters?: AdRadarCardSearchFilters;
  rowLimit?: number;
  resultLimit?: number;
};

type RankedSearchRow = CustomerMetaAdLibraryCardRow & { search_rank?: number | null };
type SearchRowsResult = { rows: CustomerMetaAdLibraryCardRow[] | null; error: { message: string } | null };
type LocationSearchRowsResult = { rows: CustomerMetaAdLibraryCardRow[]; active: boolean; guess: AdRadarLocationGuess | null };

const DEFAULT_SEARCH_ROW_LIMIT = 200;
const DEFAULT_SEARCH_RESULT_LIMIT = 50;
const FALLBACK_TEXT_SEARCH_COLUMNS = [
  "agent_name",
  "agency_name",
  "page_name",
  "library_id",
  "headline",
  "body",
  "description",
  "postcode",
  "suburb",
  "state",
  "destination_url",
  "cta",
] as const;
const LOCATION_TEXT_COLUMNS = ["headline", "body", "description", "destination_url"] as const;
const IGNORED_LOCATION_SEARCH_TERMS = new Set([
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
  "western australia",
]);

export async function searchCustomerMetaAdLibraryCards(
  supabase: SearchSupabaseClient,
  input: SearchInput,
): Promise<CustomerMetaAdLibraryCard[]> {
  const q = normaliseAdRadarCardSearchQuery(input.query);
  const sort = normaliseAdRadarSort(input.sort);
  const includeSurroundingSuburbs = input.includeSurroundingSuburbs === true;
  const filters = normaliseCardSearchFilters(input.filters);
  const hasFilters = Object.keys(filters).length > 0;
  // Widen the candidate window when filters are active so the post-slice page
  // still fills up after the database narrows the results.
  const defaultRowLimit = hasFilters ? 500 : DEFAULT_SEARCH_ROW_LIMIT;
  const rowLimit = clampLimit(input.rowLimit ?? defaultRowLimit, 1, 500);
  const resultLimit = clampLimit(input.resultLimit ?? DEFAULT_SEARCH_RESULT_LIMIT, 1, 100);
  if (!q) return [];

  const locationSearch = await loadPrioritisedLocationRows(supabase, q, sort, rowLimit, includeSurroundingSuburbs, filters);
  let rows = locationSearch.active ? locationSearch.rows : null;

  // The ranked RPC does not accept facet filters, so skip it when filters are
  // active and use the filterable fallback/structured paths instead.
  if (!locationSearch.active && !hasFilters && supportsRankedFullTextSort(sort) && shouldUseRankedFullTextSearch(q)) {
    rows = await loadRankedFullTextRows(supabase, q, sort, rowLimit);
  }

  if (!locationSearch.active && rows === null) {
    const fallback = await loadFallbackSearchRows(supabase, q, sort, rowLimit, filters);
    if (fallback.error) throw new Error(fallback.error.message);
    rows = fallback.rows;
  }

  const cards = dedupeRowsByCardId(rows ?? []).map(normaliseCustomerMetaAdLibraryCard);
  const sortedCards = locationSearch.active && locationSearch.guess
    ? matchAdRadarCardsForLocation(cards, locationSearch.guess, sort)
    : sortCards(cards, sort);

  return sortedCards.slice(0, resultLimit);
}

function normaliseCardSearchFilters(filters?: AdRadarCardSearchFilters): AdRadarCardSearchFilters {
  if (!filters) return {};
  const result: AdRadarCardSearchFilters = {};
  if (filters.status === "active" || filters.status === "inactive") result.status = filters.status;
  const agency = filters.agency?.trim();
  if (agency) result.agency = agency;
  const agent = filters.agent?.trim();
  if (agent) result.agent = agent;
  const adType = filters.adType?.trim();
  if (adType) result.adType = adType;
  const format = filters.format?.trim();
  if (format) result.format = format;
  const hook = filters.hook?.trim();
  if (hook) result.hook = hook;
  return result;
}

function applyCardSearchFilters(query: any, filters: AdRadarCardSearchFilters): any {
  let next = query;
  if (filters.status) next = next.eq("active_status", filters.status);
  if (filters.agency) next = next.eq("agency_name", filters.agency);
  if (filters.agent) next = next.eq("agent_name", filters.agent);
  if (filters.adType) next = next.eq("ad_type", filters.adType);
  if (filters.format) next = next.eq("format", filters.format);
  if (filters.hook) next = next.ilike("hooks_text", `%${escapeLikeContains(filters.hook)}%`);
  return next;
}

function escapeLikeContains(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

export function normaliseAdRadarCardSearchQuery(value: string): string {
  return value.replace(/[(),]/g, "").trim();
}

async function loadPrioritisedLocationRows(
  supabase: SearchSupabaseClient,
  q: string,
  sort: AdRadarCardSearchSort,
  rowLimit: number,
  includeSurroundingSuburbs: boolean,
  filters: AdRadarCardSearchFilters,
): Promise<LocationSearchRowsResult> {
  const guess = resolveAdRadarLocationSearch(q, { includeSurroundingSuburbs });
  if (!guess || !shouldPrioritiseAdRadarLocationSearch(q, guess)) {
    return { rows: [], active: false, guess: null };
  }

  const structuredLoaders = buildStructuredLocationLoaders(supabase, guess, sort, rowLimit, filters);
  const structuredBatches = await Promise.all(structuredLoaders.map((load) => load()));
  const structuredRows = dedupeRowsByCardId(structuredBatches.flat());

  const textLoaders = buildLocationTextLoaders(supabase, guess, sort, rowLimit, filters);
  const textBatches = await Promise.all(textLoaders.map(loadRecoverableLocationTextRows));

  return {
    rows: dedupeRowsByCardId([...structuredRows, ...textBatches.flat()]),
    active: true,
    guess,
  };
}

function buildStructuredLocationLoaders(
  supabase: SearchSupabaseClient,
  guess: AdRadarLocationGuess,
  sort: AdRadarCardSearchSort,
  rowLimit: number,
  filters: AdRadarCardSearchFilters,
): Array<() => Promise<CustomerMetaAdLibraryCardRow[]>> {
  const loaders: Array<() => Promise<CustomerMetaAdLibraryCardRow[]>> = [];
  const postcodes = locationPostcodes(guess);

  if (postcodes.length > 0) {
    loaders.push(() => fetchSearchRows(supabase, sort, rowLimit, (query) => query.in("postcode", postcodes), filters));
    loaders.push(() => fetchSearchRows(supabase, sort, rowLimit, (query) => query.overlaps("ad_area_postcodes", postcodes), filters));
  }

  for (const term of locationTextTerms(guess).filter((term) => !/^\d{4}$/u.test(term))) {
    loaders.push(() => fetchSearchRows(supabase, sort, rowLimit, (query) => query.ilike("suburb", escapeLikeTerm(term)), filters));
  }

  return loaders;
}

function buildLocationTextLoaders(
  supabase: SearchSupabaseClient,
  guess: AdRadarLocationGuess,
  sort: AdRadarCardSearchSort,
  rowLimit: number,
  filters: AdRadarCardSearchFilters,
): Array<() => Promise<CustomerMetaAdLibraryCardRow[]>> {
  const loaders: Array<() => Promise<CustomerMetaAdLibraryCardRow[]>> = [];

  for (const term of locationTextTerms(guess).slice(0, 8)) {
    const needle = `%${escapeLikeTerm(term)}%`;
    for (const column of LOCATION_TEXT_COLUMNS) {
      loaders.push(() => fetchSearchRows(supabase, sort, rowLimit, (query) => query.ilike(column, needle), filters));
    }
  }

  return loaders;
}

async function loadRecoverableLocationTextRows(
  load: () => Promise<CustomerMetaAdLibraryCardRow[]>,
): Promise<CustomerMetaAdLibraryCardRow[]> {
  try {
    return await load();
  } catch (error) {
    if (isRecoverableSearchError(error)) return [];
    throw error;
  }
}

async function loadRankedFullTextRows(
  supabase: SearchSupabaseClient,
  q: string,
  sort: AdRadarCardSearchSort,
  rowLimit: number,
): Promise<CustomerMetaAdLibraryCardRow[] | null> {
  const { data, error } = await supabase
    .schema("research")
    .rpc("search_customer_meta_ad_library_cards", {
      p_query: q,
      p_limit: rowLimit,
      p_sort: sort,
    });

  if (!error) return (data ?? []) as unknown as RankedSearchRow[];
  if (isMissingRankedSearchSchemaError(error)) return null;

  console.warn("Ad Radar ranked search failed; falling back to ILIKE search", error.message);
  return null;
}

async function loadFallbackSearchRows(
  supabase: SearchSupabaseClient,
  q: string,
  sort: AdRadarCardSearchSort,
  rowLimit: number,
  filters: AdRadarCardSearchFilters,
): Promise<SearchRowsResult> {
  let query = supabase
    .schema("research")
    .from("v_customer_meta_ad_library_cards")
    .select(CUSTOMER_META_AD_LIBRARY_CARD_SELECT)
    .or(buildFallbackSearchFilter(q));
  query = applyCardSearchFilters(query, filters);
  const { data, error } = await applySearchOrder(query, sort).limit(rowLimit);

  return { rows: (data ?? null) as unknown as CustomerMetaAdLibraryCardRow[] | null, error };
}

async function fetchSearchRows(
  supabase: SearchSupabaseClient,
  sort: AdRadarCardSearchSort,
  limit: number,
  applyFilter: (query: any) => any,
  filters: AdRadarCardSearchFilters = {},
): Promise<CustomerMetaAdLibraryCardRow[]> {
  let query = supabase
    .schema("research")
    .from("v_customer_meta_ad_library_cards")
    .select(CUSTOMER_META_AD_LIBRARY_CARD_SELECT);

  query = applyFilter(query);
  query = applyCardSearchFilters(query, filters);
  query = applySearchOrder(query, sort);
  const { data, error } = await query.limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CustomerMetaAdLibraryCardRow[];
}

function shouldUseRankedFullTextSearch(q: string): boolean {
  return q.length >= 3 && !/^\d+$/u.test(q);
}

function supportsRankedFullTextSort(sort: AdRadarCardSearchSort): boolean {
  return sort === "recent" || sort === "longest";
}

function applySearchOrder(query: any, sort: AdRadarCardSearchSort): any {
  let next = query;
  for (const order of searchOrders(sort)) {
    next = next.order(order.column, { ascending: order.ascending, nullsFirst: false });
  }
  return next;
}

function searchOrders(sort: AdRadarCardSearchSort): Array<{ column: string; ascending: boolean }> {
  switch (sort) {
    case "longest":
      return [{ column: "ad_delivery_started_at", ascending: true }];
    case "newest_started":
      return [{ column: "ad_delivery_started_at", ascending: false }];
    case "oldest_started":
      return [{ column: "ad_delivery_started_at", ascending: true }];
    case "recently_stopped":
      return [{ column: "ad_delivery_stopped_at", ascending: false }];
    case "active_first":
      return [
        { column: "active_status", ascending: true },
        { column: "last_seen_at", ascending: false },
      ];
    case "advertiser_az":
      return [
        { column: "page_name", ascending: true },
        { column: "last_seen_at", ascending: false },
      ];
    case "recent":
    default:
      return [{ column: "last_seen_at", ascending: false }];
  }
}

function buildFallbackSearchFilter(q: string): string {
  const escaped = q.replace(/[%_\\]/g, "\\$&");
  if (/^\d+$/u.test(q)) {
    const prefixNeedle = `${escaped}%`;
    return [
      `postcode.ilike.${prefixNeedle}`,
      `library_id.ilike.${prefixNeedle}`,
    ].join(",");
  }

  const needle = `%${escaped}%`;
  // Agent/agency matches are strict DB-backed attribution from the customer
  // card view. Page/library/copy matches remain normal advertiser search.
  return FALLBACK_TEXT_SEARCH_COLUMNS.map((column) => `${column}.ilike.${needle}`).join(",");
}

function isMissingRankedSearchSchemaError(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  const message = error.message ?? "";
  return (
    ["42703", "42883", "42P01", "PGRST202", "PGRST204"].includes(code) ||
    /function .*search_customer_meta_ad_library_cards|column .*search_vector|schema cache/i.test(message)
  );
}

function locationPostcodes(guess: AdRadarLocationGuess): string[] {
  return uniqueStrings(guess.terms.filter((term) => /^\d{4}$/u.test(term)));
}

function locationTextTerms(guess: AdRadarLocationGuess): string[] {
  const ignored = new Set(IGNORED_LOCATION_SEARCH_TERMS);
  if (guess.stateCode) ignored.add(normaliseTerm(guess.stateCode));
  if (guess.stateName) ignored.add(normaliseTerm(guess.stateName));

  return uniqueStrings(guess.terms.filter((term) => {
    const normalised = normaliseTerm(term);
    if (!normalised || ignored.has(normalised)) return false;
    return /^\d{4}$/u.test(term) || /[a-z]/u.test(normalised);
  }));
}

function sortCards(cards: CustomerMetaAdLibraryCard[], sort: AdRadarCardSearchSort): CustomerMetaAdLibraryCard[] {
  const now = Date.now();
  return [...cards].sort((a, b) => compareCards(a, b, sort, now));
}

function compareCards(a: CustomerMetaAdLibraryCard, b: CustomerMetaAdLibraryCard, sort: AdRadarCardSearchSort, now: number): number {
  switch (sort) {
    case "longest": {
      const aMs = adRunningMs(a.startedAt, a.stoppedAt, now);
      const bMs = adRunningMs(b.startedAt, b.stoppedAt, now);
      return (bMs ?? -1) - (aMs ?? -1) || compareRecent(a, b);
    }
    case "newest_started":
      return compareDateDesc(a.startedAt, b.startedAt) || compareRecent(a, b);
    case "oldest_started":
      return compareDateAsc(a.startedAt, b.startedAt) || compareRecent(a, b);
    case "recently_stopped":
      return compareDateDesc(a.stoppedAt, b.stoppedAt) || compareRecent(a, b);
    case "active_first":
      return activeStatusRank(a.activeStatus) - activeStatusRank(b.activeStatus) || compareRecent(a, b);
    case "advertiser_az":
      return a.pageName.localeCompare(b.pageName, "en-AU", { sensitivity: "base" }) || compareRecent(a, b);
    case "recent":
    default:
      return compareRecent(a, b);
  }
}

function compareRecent(a: CustomerMetaAdLibraryCard, b: CustomerMetaAdLibraryCard): number {
  return compareDateDesc(a.lastSeenAt, b.lastSeenAt);
}

function compareDateDesc(a: string | null, b: string | null): number {
  const aValue = dateValue(a);
  const bValue = dateValue(b);
  if (aValue === bValue) return 0;
  if (!aValue) return 1;
  if (!bValue) return -1;
  return bValue - aValue;
}

function compareDateAsc(a: string | null, b: string | null): number {
  const aValue = dateValue(a);
  const bValue = dateValue(b);
  if (aValue === bValue) return 0;
  if (!aValue) return 1;
  if (!bValue) return -1;
  return aValue - bValue;
}

function activeStatusRank(status: CustomerMetaAdLibraryCard["activeStatus"]): number {
  if (status === "active") return 0;
  if (status === "unknown") return 1;
  return 2;
}

function dedupeRowsByCardId(rows: CustomerMetaAdLibraryCardRow[]): CustomerMetaAdLibraryCardRow[] {
  const seen = new Set<string>();
  const deduped: CustomerMetaAdLibraryCardRow[] = [];

  for (const row of rows) {
    const cardId = row.card_id?.trim();
    if (cardId) {
      if (seen.has(cardId)) continue;
      seen.add(cardId);
    }
    deduped.push(row);
  }

  return deduped;
}

function dateValue(value: string | null): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isRecoverableSearchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /statement timeout|canceling statement|timeout/i.test(message);
}

function clampLimit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normaliseTerm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeLikeTerm(value: string): string {
  return value.replace(/[%_]/g, "");
}
