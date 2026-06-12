"use client";

import { Bookmark, Clock3, FileSearch, ImageIcon, MapPin, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { MetricCard } from "@/components/metric-card";
import { AdRadarLocationForm } from "@/components/research/ad-radar-location-form";
import { AdRadarResultsGrid } from "@/components/research/ad-radar-results-grid";
import type { CustomerMetaAdLibraryCard } from "@/lib/research/customer-meta-card";

type ResearchSort = "recent" | "longest";

type Props = {
  initialQuery: string;
  initialSort: ResearchSort;
  initialLocationLabel: string;
  initialNote: string;
};

type SearchResponse = { cards?: CustomerMetaAdLibraryCard[]; error?: string };

export function AdRadarSearchPanel({ initialQuery, initialSort, initialLocationLabel, initialNote }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [sort] = useState<ResearchSort>(initialSort);
  const [cards, setCards] = useState<CustomerMetaAdLibraryCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function doSearch(q: string, activeSort: ResearchSort = sort) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q });
        if (activeSort !== "recent") params.set("sort", activeSort);
        const res = await fetch(`/api/research/ads/search?${params.toString()}`);
        const data: SearchResponse = res.ok ? await res.json() : { cards: [] };
        setCards(data.cards ?? []);
        setSearched(true);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function onSearch(q: string) {
    setQuery(q);
    doSearch(q, sort);
  }

  useEffect(() => {
    if (initialQuery) doSearch(initialQuery, initialSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advertiserCount = unique(cards.map((c) => c.pageId ?? c.pageName)).length;
  const mediaReady = cards.filter((c) => c.media.length > 0).length;
  const allPostcodes = unique(cards.flatMap((c) => c.postcodes));
  const newestSeenAt = cards
    .map((c) => c.lastSeenAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);

  return (
    <>
      <section className="panel research-search-panel">
        <AdRadarLocationForm
          buttonLabel={loading ? "Searching..." : "Search"}
          initialNote={initialNote}
          initialValue={initialQuery || initialLocationLabel}
          isSubmitting={loading}
          onSearch={onSearch}
          placeholder="6008, Subiaco, Ray White, appraisal"
          surface="research"
        />
        <div className="research-freshness">
          <Clock3 size={14} />
          {newestSeenAt ? `Last seen ${formatDateTime(newestSeenAt)}` : "No live observations yet"}
        </div>
      </section>

      {searched && (
        <section className="grid cols-4">
          <MetricCard icon={FileSearch} label="Ads in view" value={String(cards.length)} note="Meta Ad Library results" />
          <MetricCard icon={Users} label="Advertisers" value={String(advertiserCount)} note="Meta pages with visible ads" />
          <MetricCard icon={MapPin} label="Postcodes" value={String(allPostcodes.length)} note="Matched service areas" />
          <MetricCard icon={ImageIcon} label="Media visible" value={String(mediaReady)} note="Images, videos, or carousel media" />
        </section>
      )}

      {searched && (
        <section className="research-results-section">
          <div className="section-title-row">
            <div>
              <h2>{query ? `Results for "${query}"` : `Ads near ${initialLocationLabel}`}</h2>
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
                href={buildResearchHref(query, "recent")}
                aria-current={sort === "recent" ? "true" : undefined}
              >
                Most recent
              </a>
              <a
                className={`research-sort-option${sort === "longest" ? " is-active" : ""}`}
                href={buildResearchHref(query, "longest")}
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
      )}
    </>
  );
}

function buildResearchHref(q: string, sort: ResearchSort): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (sort !== "recent") params.set("sort", sort);
  const qs = params.toString();
  return qs ? `/ad-radar?${qs}` : "/ad-radar";
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
