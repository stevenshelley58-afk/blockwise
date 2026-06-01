import { Clock3, FileSearch, ImageIcon, MapPin, Search, Users } from "lucide-react";

import { MetricCard } from "@/ui/metric-card";
import { PageHeading } from "@/ui/page-heading";
import { MetaAdLibraryCard } from "@/ui/research/meta-ad-library-card";
import { requirePageSurfaceAccess } from "@/modules/auth/page-guards";
import {
  CUSTOMER_META_AD_LIBRARY_CARD_SELECT,
  normaliseCustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCardRow,
} from "@/modules/research/customer-meta-card";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResearchPage({ searchParams }: { searchParams?: SearchParams }) {
  const { supabase } = await requirePageSurfaceAccess("monitor");
  const params = searchParams ? await searchParams : {};
  const searchTerm = firstParam(params.q ?? params.postcode).trim();

  const { cards, loadError } = await loadCustomerMetaAdLibraryCards(supabase, searchTerm);
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
        title="Research"
        description="Search live Australian real-estate ads by postcode, suburb, page, Library ID, or ad copy."
      />

      <section className="panel research-search-panel">
        <form className="research-search-form" action="/research">
          <label htmlFor="research-query">
            Search
            <input
              id="research-query"
              name="q"
              defaultValue={searchTerm}
              placeholder="6008, Subiaco, Ray White, appraisal"
              autoComplete="off"
            />
          </label>
          <button className="button" type="submit">
            <Search size={14} /> Search
          </button>
        </form>
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
          <h2>Research view unavailable</h2>
          <p>{loadError}</p>
        </section>
      ) : null}

      <section className="research-results-section">
        <div className="section-title-row">
          <div>
            <h2>{searchTerm ? `Results for "${searchTerm}"` : "Latest Ad Library cards"}</h2>
            <p className="item-meta">
              {cards.length} ad{cards.length === 1 ? "" : "s"} across {advertiserCount} advertiser page
              {advertiserCount === 1 ? "" : "s"}.
            </p>
          </div>
        </div>

        {cards.length > 0 ? (
          <div className="research-results-grid">
            {cards.map((card) => (
              <MetaAdLibraryCard card={card} key={card.id} />
            ))}
          </div>
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

async function loadCustomerMetaAdLibraryCards(
  supabase: Awaited<ReturnType<typeof requirePageSurfaceAccess>>["supabase"],
  searchTerm: string,
): Promise<{ cards: CustomerMetaAdLibraryCard[]; loadError: string | null }> {
  const { data, error } = await supabase
    .schema("research")
    .from("v_customer_meta_ad_library_cards")
    .select(CUSTOMER_META_AD_LIBRARY_CARD_SELECT)
    .order("last_seen_at", { ascending: false })
    .limit(500);

  if (error) {
    return { cards: [], loadError: "Research data is temporarily unavailable." };
  }

  const allCards = ((data ?? []) as unknown as CustomerMetaAdLibraryCardRow[]).map(normaliseCustomerMetaAdLibraryCard);
  const filtered = searchTerm
    ? allCards.filter((card) => cardMatches(card, searchTerm))
    : allCards.filter((card) => !card.state || card.state.toUpperCase() === "WA");

  return { cards: dedupeCards(filtered).slice(0, 80), loadError: null };
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

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
