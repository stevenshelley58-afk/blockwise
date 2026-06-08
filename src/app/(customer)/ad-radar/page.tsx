import { Bookmark, Clock3, FileSearch, ImageIcon, MapPin, Users } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { AdRadarLocationForm } from "@/components/research/ad-radar-location-form";
import { AdRadarResultsGrid } from "@/components/research/ad-radar-results-grid";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import {
  pickAdRadarCardsForLocation,
  resolveAdRadarLocationGuess,
  resolveAdRadarLocationSearch,
  shouldPrioritiseAdRadarLocationSearch,
} from "@/lib/research/ad-radar-location";
import {
  adRunningMs,
  CUSTOMER_META_AD_LIBRARY_CARD_SELECT,
  normaliseCustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCardRow,
} from "@/lib/research/customer-meta-card";

type ResearchSort = "recent" | "longest";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResearchPage({ searchParams }: { searchParams?: SearchParams }) {
  const { supabase } = await requirePageSurfaceAccess("monitor");
  const requestHeaders = await headers();
  const params = searchParams ? await searchParams : {};
  const searchTerm = firstParam(params.q ?? params.postcode).trim();
  const sort: ResearchSort = firstParam(params.sort) === "longest" ? "longest" : "recent";
  const locationGuess = searchTerm ? resolveAdRadarLocationSearch(searchTerm) : resolveAdRadarLocationGuess(requestHeaders);

  const { cards, loadError, matchedLocation } = await loadCustomerMetaAdLibraryCards(supabase, searchTerm, sort, locationGuess);
  const advertiserCount = unique(cards.map((card) => card.pageId ?? card.pageName)).length;
  const allPostcodes = unique(cards.flatMap((card) => card.postcodes));
  const mediaReady = cards.filter((card) => card.media.length > 0).length;
  const newestSeenAt = cards
    .map((card) => card.lastSeenAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return (
    <main className="content">
      <PageHeading
        eyebrow="Competitor intelligence"
        title="Ad Radar"
        description="Search live Australian real-estate ads by postcode, suburb, page, Library ID, or ad copy."
      />

      <section className="panel research-search-panel">
        <AdRadarLocationForm
          buttonLabel="Search"
          initialNote={researchLocationNote(searchTerm, locationGuess?.label ?? "Perth, WA", locationGuess?.source ?? "fallback", matchedLocation)}
          initialValue={searchTerm || locationGuess?.label || "Perth, WA"}
          placeholder="6008, Subiaco, Ray White, appraisal"
          surface="research"
        />
        <div className="research-freshness">
          <Clock3 size={14} />
          {newestSeenAt ? `Last seen ${formatDateTime(newestSeenAt)}` : "No live observations yet"}
        </div>
      </section>

      <section className="grid cols-4">
        <MetricCard icon={FileSearch} label="Ads in view" value={String(cards.length)} note="Meta Ad Library results" />
        <MetricCard icon={Users} label="Advertisers" value={String(advertiserCount)} note="Meta pages with visible ads" />
        <MetricCard icon={MapPin} label="Postcodes" value={String(allPostcodes.length)} note="Matched service areas" />
        <MetricCard icon={ImageIcon} label="Media visible" value={String(mediaReady)} note="Images, videos, or carousel media" />
      </section>

      {loadError ? (
        <section className="panel research-blocker-card">
          <h2>Ad Radar is unavailable</h2>
          <p>{loadError}</p>
        </section>
      ) : null}

      <section className="research-results-section">
        <div className="section-title-row">
          <div>
            <h2>{searchTerm ? `Results for "${searchTerm}"` : `Ads near ${locationGuess?.label ?? "Perth, WA"}`}</h2>
            <p className="item-meta">
              {cards.length} ad{cards.length === 1 ? "" : "s"} across {advertiserCount} advertiser page
              {advertiserCount === 1 ? "" : "s"}.
            </p>
          </div>
          <div className="research-sort" role="group" aria-label="Sort ads">
            <Link className="research-sort-option" href="/ad-radar/swipe-file">
              <Bookmark size={13} /> Swipe file
            </Link>
            <span className="research-sort-label">Sort</span>
            <a
              className={`research-sort-option${sort === "recent" ? " is-active" : ""}`}
              href={buildResearchHref(searchTerm, "recent")}
              aria-current={sort === "recent" ? "true" : undefined}
            >
              Most recent
            </a>
            <a
              className={`research-sort-option${sort === "longest" ? " is-active" : ""}`}
              href={buildResearchHref(searchTerm, "longest")}
              aria-current={sort === "longest" ? "true" : undefined}
            >
              Longest running
            </a>
          </div>
        </div>

        {cards.length > 0 ? (
          <AdRadarResultsGrid cards={cards} />
        ) : (
          <div className="research-empty-state">
            <h3>No ads matched</h3>
            <p>Try a WA postcode such as 6008 or 6000 while the background collector expands coverage.</p>
          </div>
        )}
      </section>
    </main>
  );
}

const FETCH_BATCH_SIZE = 1000;
const FETCH_CEILING = 10000;

async function loadCustomerMetaAdLibraryCards(
  supabase: Awaited<ReturnType<typeof requirePageSurfaceAccess>>["supabase"],
  searchTerm: string,
  sort: ResearchSort,
  locationGuess: ReturnType<typeof resolveAdRadarLocationGuess> | ReturnType<typeof resolveAdRadarLocationSearch>,
): Promise<{ cards: CustomerMetaAdLibraryCard[]; loadError: string | null; matchedLocation: boolean }> {
  // Page through the view in batches so results are not silently capped.
  const rows: CustomerMetaAdLibraryCardRow[] = [];
  for (let from = 0; from < FETCH_CEILING; from += FETCH_BATCH_SIZE) {
    const { data, error } = await supabase
      .schema("research")
      .from("v_customer_meta_ad_library_cards")
      .select(CUSTOMER_META_AD_LIBRARY_CARD_SELECT)
      .order("last_seen_at", { ascending: false })
      .range(from, from + FETCH_BATCH_SIZE - 1);

    if (error) {
      return { cards: [], loadError: "Ad Radar data is temporarily unavailable.", matchedLocation: false };
    }

    const batch = (data ?? []) as unknown as CustomerMetaAdLibraryCardRow[];
    rows.push(...batch);
    if (batch.length < FETCH_BATCH_SIZE) break;
  }

  const allCards = dedupeCards(rows.map(normaliseCustomerMetaAdLibraryCard));

  if (searchTerm) {
    if (locationGuess && shouldPrioritiseAdRadarLocationSearch(searchTerm, locationGuess)) {
      const picked = pickAdRadarCardsForLocation(allCards, locationGuess, sort);
      if (picked.matchedLocation) return { cards: picked.cards, loadError: null, matchedLocation: true };
    }

    const directMatches = allCards.filter((card) => cardMatches(card, searchTerm));
    if (directMatches.length > 0) {
      return { cards: sortCards(directMatches, sort), loadError: null, matchedLocation: false };
    }

    if (locationGuess) {
      const picked = pickAdRadarCardsForLocation(allCards, locationGuess, sort);
      if (picked.matchedLocation) return { cards: picked.cards, loadError: null, matchedLocation: true };
    }

    return { cards: [], loadError: null, matchedLocation: false };
  }

  const picked = locationGuess
    ? pickAdRadarCardsForLocation(allCards, locationGuess, sort)
    : { cards: sortCards(allCards, sort), matchedLocation: false };

  return { cards: picked.cards, loadError: null, matchedLocation: picked.matchedLocation };
}

function sortCards(cards: CustomerMetaAdLibraryCard[], sort: ResearchSort): CustomerMetaAdLibraryCard[] {
  if (sort !== "longest") return cards; // default order is already last-seen desc
  const now = Date.now();
  return [...cards].sort((a, b) => {
    const aMs = adRunningMs(a.startedAt, a.stoppedAt, now);
    const bMs = adRunningMs(b.startedAt, b.stoppedAt, now);
    if (aMs === null && bMs === null) return 0;
    if (aMs === null) return 1; // ads with no start date sink to the bottom
    if (bMs === null) return -1;
    return bMs - aMs; // longest running first
  });
}

function buildResearchHref(searchTerm: string, sort: ResearchSort): string {
  const query = new URLSearchParams();
  if (searchTerm) query.set("q", searchTerm);
  if (sort !== "recent") query.set("sort", sort);
  const qs = query.toString();
  return qs ? `/ad-radar?${qs}` : "/ad-radar";
}

function cardMatches(card: CustomerMetaAdLibraryCard, searchTerm: string): boolean {
  const needle = searchTerm.toLowerCase();
  return [
    card.pageName,
    card.libraryId,
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
    .some((value) => String(value).toLowerCase().includes(needle));
}

function dedupeCards(cards: CustomerMetaAdLibraryCard[]): CustomerMetaAdLibraryCard[] {
  const seen = new Set<string>();
  const deduped: CustomerMetaAdLibraryCard[] = [];
  for (const card of cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    deduped.push(card);
  }
  return deduped;
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function researchLocationNote(searchTerm: string, label: string, source: "ip" | "fallback" | "query", matchedLocation: boolean): string {
  if (searchTerm && matchedLocation) return `Showing scraped ads around ${label}.`;
  if (searchTerm) return `Searching scraped ads for "${searchTerm}".`;
  if (source === "fallback") return `Best guess unavailable. Showing current Perth coverage.`;
  return `Best guess: ${label}. Showing closest scraped ads.`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
