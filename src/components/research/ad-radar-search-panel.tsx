"use client";

import { Bookmark, ChevronDown, CircleAlert, Clock3, RotateCw, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AdRadarLocationForm } from "@/components/research/ad-radar-location-form";
import { AdRadarResultsGrid } from "@/components/research/ad-radar-results-grid";
import { mergeCards } from "@/lib/research/ad-radar-pagination";
import { niche } from "@/config/niche";
import type { CustomerMetaAdLibraryCard } from "@/lib/research/customer-meta-card";

type Filters = {
  agency: string;
  agent: string;
};

const EMPTY_FILTERS: Filters = { agency: "", agent: "" };

const fieldLabelClass = "font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase";
const controlClass =
  "h-9 w-full appearance-none rounded-(--r-card) border border-(--line) bg-(--surface) px-2.5 pr-7 text-[12.5px] font-semibold text-foreground outline-none transition-[border-color] duration-150 focus:border-(--ink)";
const ghostButtonClass =
  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-(--line-heavy) bg-card px-3.5 text-[12.5px] font-bold text-foreground transition-[background,box-shadow] duration-150 hover:bg-(--surface-subtle) hover:shadow-card";

type Props = {
  initialQuery: string;
  initialLocationLabel: string;
  initialNote: string;
  /** Search fired on mount when the visitor did not type a query. */
  autoSearchTerm?: string | null;
  autoSearchLabel?: string | null;
  autoSearchSource?: "brand_pack" | "location" | null;
};

type SearchResponse = { cards?: CustomerMetaAdLibraryCard[]; page?: { nextCursor: string | null; limit: number }; error?: string };

export function AdRadarSearchPanel({
  initialQuery,
  initialLocationLabel,
  initialNote,
  autoSearchTerm = null,
  autoSearchLabel = null,
  autoSearchSource = null,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [agencyOptions, setAgencyOptions] = useState<string[]>([]);
  const [agentOptions, setAgentOptions] = useState<string[]>([]);
  const [cards, setCards] = useState<CustomerMetaAdLibraryCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const activeSearchTermRef = useRef(initialQuery || autoSearchTerm || "");

  function doSearch(
    q: string,
    activeFilters: Filters = filters,
    append = false,
  ) {
    if (timerRef.current) clearTimeout(timerRef.current);
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    activeSearchTermRef.current = q;
    if (!append) {
      setCards([]);
      setNextCursor(null);
    }
    setLoading(true);
    setSearchError(null);
    timerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q });
        if (activeFilters.agency) params.set("agency", activeFilters.agency);
        if (activeFilters.agent) params.set("agent", activeFilters.agent);
        if (append && nextCursor) params.set("cursor", nextCursor);
        const res = await fetch(`/api/research/ads/search?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => ({}))) as SearchResponse;
        if (controller.signal.aborted || requestRef.current !== controller) return;
        if (!res.ok) throw new Error(searchFailureMessage(res.status));
        const nextCards = data.cards ?? [];
        setCards((previous) => append ? mergeCards(previous, nextCards) : nextCards);
        setNextCursor(data.page?.nextCursor ?? null);
        setSearched(true);
        setSearchError(null);
        // Accumulate agency/agent options across the query session so picking
        // one filter doesn't erase the others from the dropdowns.
        setAgencyOptions((prev) => mergeOptions(prev, nextCards.map((c) => c.agencyName)));
        setAgentOptions((prev) => mergeOptions(prev, nextCards.map((c) => c.agentName)));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (controller.signal.aborted || requestRef.current !== controller) return;
        if (!append) setCards([]);
        setSearched(true);
        setSearchError(
          error instanceof Error
            ? error.message
            : "Ad Radar couldn't load these results. Try the search again.",
        );
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          setLoading(false);
        }
      }
    }, 300);
  }

  function onSearch(q: string) {
    setQuery(q);
    setAgencyOptions([]);
    setAgentOptions([]);
    doSearch(q, filters, false);
  }

  function loadMore() {
    if (!nextCursor || loading || !activeSearchTermRef.current) return;
    doSearch(activeSearchTermRef.current, filters, true);
  }

  function onChangeFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    if (searched && activeSearchTermRef.current.trim()) doSearch(activeSearchTermRef.current, next, false);
  }

  function onClearFilters() {
    if (activeFilterCount === 0) return;
    setFilters(EMPTY_FILTERS);
    if (searched && activeSearchTermRef.current.trim()) doSearch(activeSearchTermRef.current, EMPTY_FILTERS, false);
  }

  useEffect(() => {
    if (initialQuery) {
      doSearch(initialQuery, filters, false);
    } else if (autoSearchTerm) {
      // Lazy first paint: the panel renders immediately, results stream in.
      doSearch(autoSearchTerm, filters, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      requestRef.current?.abort();
    };
  }, []);

  const activeFilterCount = useMemo(
    () => (Object.keys(filters) as Array<keyof Filters>).filter((key) => filters[key] !== "").length,
    [filters],
  );

  const advertiserCount = unique(cards.map((c) => c.pageId ?? c.pageName)).length;
  const mediaReady = cards.filter((c) => c.media.length > 0).length;
  const allPostcodes = unique(cards.flatMap((c) => c.adAreaPostcodes));
  const newestSeenAt = cards
    .map((c) => c.lastSeenAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);

  return (
    <>
      <section className="grid gap-4 rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card">
        <AdRadarLocationForm
          buttonLabel={loading ? "Searching..." : "Search"}
          initialNote={initialNote}
          initialValue={initialQuery}
          inputLabel="Search Ad Radar"
          isSubmitting={loading}
          onSearch={onSearch}
          placeholder={niche.copy.adRadar.searchPlaceholder}
          surface="research"
        />

        {/* Search actions and current result freshness. */}
        <div className="grid gap-2.5 border-t border-(--line) pt-4 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
              className={ghostButtonClass}
            >
              <SlidersHorizontal size={15} aria-hidden />
              Filters
              {activeFilterCount > 0 ? (
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-(--ink) px-1 text-[11px] font-bold text-white">
                  {activeFilterCount}
                </span>
              ) : null}
              <ChevronDown
                size={14}
                aria-hidden
                className={`text-(--faint) transition-transform duration-150 ${filtersOpen ? "rotate-180" : ""}`}
              />
            </button>

            <Link href="/ad-radar/swipe-file" className={ghostButtonClass}>
              <Bookmark size={13} aria-hidden />
              Swipe file
            </Link>

            <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[11.5px] text-(--faint) sm:hidden">
              <Clock3 size={13} aria-hidden className="shrink-0" />
              <span className="truncate">
                {newestSeenAt ? `Last seen ${formatDateTime(newestSeenAt)}` : "No live observations yet"}
              </span>
            </span>
          </div>
        </div>

        {filtersOpen ? (
          <div className="border-t border-(--line) pt-4">
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
              <label className="grid gap-1.5">
                <span className={fieldLabelClass}>{niche.copy.adRadar.filters.agency}</span>
                <SelectWrap>
                  <select className={controlClass} value={filters.agency} onChange={(e) => onChangeFilter("agency", e.target.value)}>
                    <option value="">{niche.copy.adRadar.filters.allAgencies}</option>
                    {agencyOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </SelectWrap>
              </label>
              <label className="grid gap-1.5">
                <span className={fieldLabelClass}>{niche.copy.adRadar.filters.agent}</span>
                <SelectWrap>
                  <select className={controlClass} value={filters.agent} onChange={(e) => onChangeFilter("agent", e.target.value)}>
                    <option value="">{niche.copy.adRadar.filters.allAgents}</option>
                    {agentOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </SelectWrap>
              </label>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={onClearFilters}
                disabled={activeFilterCount === 0}
                className={`${ghostButtonClass} disabled:cursor-default disabled:opacity-50 disabled:hover:bg-card disabled:hover:shadow-none`}
              >
                Clear all
              </button>
            </div>
          </div>
        ) : null}

        {/* Mobile shows this inline in the actions row above. */}
        <div className="hidden items-center gap-1.5 text-[11.5px] text-(--faint) sm:flex">
          <Clock3 size={13} aria-hidden />
          {newestSeenAt ? `Last seen ${formatDateTime(newestSeenAt)}` : "No live observations yet"}
        </div>
      </section>

      {searched && !searchError ? (
        <section className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
          <StatTile label="Ads in view" value={String(cards.length)} note="Current matching ads" />
          <StatTile label="Advertisers" value={String(advertiserCount)} note="Pages with visible ads" />
          <StatTile label="Postcodes" value={String(allPostcodes.length)} note="Matched ad areas" />
          <StatTile label="Media visible" value={String(mediaReady)} note="Images, videos, or carousel media" />
        </section>
      ) : null}

      {searchError ? (
        <>
        <section
          className="grid gap-3 rounded-(--r-card) border border-error/25 bg-error-soft px-5 py-4 text-error"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 shrink-0" size={18} aria-hidden />
            <div className="min-w-0">
              <h2 className="font-display text-[15.5px] font-extrabold">Ad Radar couldn&apos;t load these results</h2>
              <p className="mt-1 text-xs leading-5">{searchError} Your search is still here.</p>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-full bg-(--ink) px-4 text-[12.5px] font-bold text-white hover:opacity-85"
            onClick={() => doSearch(activeSearchTermRef.current, filters, Boolean(cards.length && nextCursor))}
            disabled={loading}
          >
            <RotateCw size={14} aria-hidden />
            {loading ? "Trying again…" : "Try again"}
          </button>
        </section>
        {cards.length > 0 ? (
          <section className="grid gap-3.5">
            <AdRadarResultsGrid cards={cards} />
            {nextCursor ? (
              <div className="flex justify-center">
                <button type="button" className={ghostButtonClass} onClick={loadMore} disabled={loading}>
                  {loading ? "Loading more..." : "Load more"}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
        </>
      ) : searched ? (
        <section className="grid gap-3.5">
          <div>
            <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em]">
              {query ? `Results for "${query}"` : `Ads near ${autoSearchLabel ?? initialLocationLabel}`}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {!query && autoSearchSource === "brand_pack" ? "From your Brand Pack address. " : null}
              {cards.length} ad{cards.length === 1 ? "" : "s"} across {advertiserCount} advertiser page
              {advertiserCount === 1 ? "" : "s"}
              {activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} applied` : ""}.
            </p>
          </div>

          {cards.length > 0 ? (
            <>
              <AdRadarResultsGrid cards={cards} />
              {nextCursor ? (
                <div className="flex justify-center">
                  <button type="button" className={ghostButtonClass} onClick={loadMore} disabled={loading}>
                    {loading ? "Loading more..." : "Load more"}
                  </button>
                </div>
              ) : null}
            </>
          ) : activeFilterCount > 0 ? (
            <div className="rounded-(--r-card) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 px-6 py-10 text-center">
              <h3 className="font-display text-[15.5px] font-extrabold">No ads matched your filters</h3>
              <p className="mt-1 text-xs text-muted-foreground">Try clearing a filter or widening the search area.</p>
            </div>
          ) : (
            <div className="rounded-(--r-card) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 px-6 py-10 text-center">
              <h3 className="font-display text-[15.5px] font-extrabold">No ads matched</h3>
              <p className="mt-1 text-xs text-muted-foreground">Try a nearby postcode.</p>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}

function SelectWrap({ children }: { children: ReactNode }) {
  return (
    <span className="relative block">
      {children}
      <ChevronDown
        size={14}
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-(--faint)"
      />
    </span>
  );
}

function StatTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article className="rounded-(--r-card) border border-(--line) bg-(--surface) px-[18px] pt-[17px] pb-[15px] shadow-card">
      <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">{label}</p>
      <p className="mt-[6px] font-display text-[24px] font-extrabold tracking-[-0.02em] tabular-nums">{value}</p>
      <p className="mt-[7px] text-[10.5px]/[11.5px] text-muted-foreground">{note}</p>
    </article>
  );
}


function mergeOptions(prev: string[], incoming: Array<string | null>): string[] {
  const next = new Set(prev);
  for (const value of incoming) {
    if (value) next.add(value);
  }
  return Array.from(next).sort((a, b) => a.localeCompare(b));
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

function searchFailureMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Your Ad Radar access needs to be refreshed. Reload the page, then try again.";
  }
  if (status === 429) {
    return "There are too many searches running right now. Wait a moment, then try again.";
  }
  return "The ad search service is temporarily unavailable. Try again in a moment.";
}
