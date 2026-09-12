"use client";

import { Bookmark, ChevronDown, CircleAlert, Clock3, RotateCw, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AdRadarLocationForm } from "@/components/research/ad-radar-location-form";
import { AdRadarResultsGrid } from "@/components/research/ad-radar-results-grid";
import { Button } from "@/components/ui/button";
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

type Props = {
  initialQuery: string;
  initialLocationLabel: string;
  initialNote: string;
  initialAgency?: string;
  initialAgent?: string;
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
  initialAgency = "",
  initialAgent = "",
  autoSearchTerm = null,
  autoSearchLabel = null,
  autoSearchSource = null,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<Filters>({ agency: initialAgency, agent: initialAgent });
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
      // Keep the current cards mounted while the new set loads. Clearing here
      // blanked the grid and forced a full rebuild on every filter change.
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

  function syncUrl(q: string, nextFilters: Filters, mode: "push" | "replace" = "replace") {
    const url = new URL(window.location.href);
    if (q.trim()) url.searchParams.set("q", q.trim());
    else url.searchParams.delete("q");
    if (nextFilters.agency) url.searchParams.set("agency", nextFilters.agency);
    else url.searchParams.delete("agency");
    if (nextFilters.agent) url.searchParams.set("agent", nextFilters.agent);
    else url.searchParams.delete("agent");
    const href = url.pathname + url.search + url.hash;
    const state = { ...(window.history.state ?? {}), adRadar: true, scrollY: window.scrollY };
    if (mode === "push") window.history.pushState(state, "", href);
    else window.history.replaceState(state, "", href);
  }

  function onSearch(q: string) {
    setQuery(q);
    setAgencyOptions([]);
    setAgentOptions([]);
    syncUrl(q, filters, "push");
    doSearch(q, filters, false);
  }

  function loadMore() {
    if (!nextCursor || loading || !activeSearchTermRef.current) return;
    doSearch(activeSearchTermRef.current, filters, true);
  }

  function onChangeFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    syncUrl(activeSearchTermRef.current, next);
    if (searched && activeSearchTermRef.current.trim()) doSearch(activeSearchTermRef.current, next, false);
  }

  function onClearFilters() {
    if (activeFilterCount === 0) return;
    setFilters(EMPTY_FILTERS);
    syncUrl(activeSearchTermRef.current, EMPTY_FILTERS);
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
    function restoreFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const nextQuery = params.get("q") ?? "";
      const nextFilters = { agency: params.get("agency") ?? "", agent: params.get("agent") ?? "" };
      setQuery(nextQuery);
      setFilters(nextFilters);
      setAgencyOptions([]);
      setAgentOptions([]);
      if (nextQuery.trim()) {
        doSearch(nextQuery, nextFilters, false);
      } else {
        requestRef.current?.abort();
        setCards([]);
        setNextCursor(null);
        setSearched(false);
        setSearchError(null);
      }
      const scrollY = window.history.state?.scrollY;
      if (typeof scrollY === "number") window.requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "auto" }));
    }
    window.addEventListener("popstate", restoreFromUrl);
    return () => window.removeEventListener("popstate", restoreFromUrl);
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

  // Both derivations walk the whole accumulated result set, and the panel
  // re-renders on every loading toggle and viewer open, so they are memoised on
  // the only input they read.
  const advertiserCount = useMemo(
    () => unique(cards.map((c) => c.pageId ?? c.pageName)).length,
    [cards],
  );
  const newestSeenAt = useMemo(
    () =>
      cards
        .map((c) => c.lastSeenAt)
        .filter((v): v is string => Boolean(v))
        .sort()
        .at(-1),
    [cards],
  );
  const resultsPending = loading && cards.length > 0;

  return (
    <>
      <section className="grid gap-4 rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card">
        <AdRadarLocationForm
          buttonLabel={loading ? "Searching..." : "Search"}
          initialNote={initialNote}
          initialValue={query}
          inputLabel="Search Ad Radar"
          isSubmitting={loading}
          onSearch={onSearch}
          placeholder={niche.copy.adRadar.searchPlaceholder}
          surface="research"
        />

        {/* Search actions and current result freshness. */}
        <div className="grid gap-2.5 border-t border-(--line) pt-4 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex min-w-0 items-center gap-2.5">
            <Button
              type="button"
              variant="ghost-pill"
              size="pill"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
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
            </Button>

            <Button asChild variant="ghost-pill" size="pill">
              <Link href="/ad-radar/swipe-file">
                <Bookmark size={13} aria-hidden />
                Saved inspiration
              </Link>
            </Button>

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
              <Button
                type="button"
                variant="ghost-pill"
                size="pill"
                onClick={onClearFilters}
                disabled={activeFilterCount === 0}
              >
                Clear all
              </Button>
            </div>
          </div>
        ) : null}

        {/* Mobile shows this inline in the actions row above. */}
        <div className="hidden items-center gap-1.5 text-[11.5px] text-(--faint) sm:flex">
          <Clock3 size={13} aria-hidden />
          {newestSeenAt ? `Last seen ${formatDateTime(newestSeenAt)}` : "No live observations yet"}
        </div>
      </section>

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
          <Button
            type="button"
            size="pill"
            className="w-fit"
            onClick={() => doSearch(activeSearchTermRef.current, filters, Boolean(cards.length && nextCursor))}
            disabled={loading}
          >
            <RotateCw size={14} aria-hidden />
            {loading ? "Trying again…" : "Try again"}
          </Button>
        </section>
        {cards.length > 0 ? (
          <section className="grid gap-3.5">
            <PendingResultsGrid cards={cards} pending={resultsPending} />
            {nextCursor ? (
              <div className="flex justify-center">
                <Button type="button" variant="ghost-pill" size="pill" onClick={loadMore} disabled={loading}>
                  {loading ? "Loading more..." : "Load more"}
                </Button>
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
              <PendingResultsGrid cards={cards} pending={resultsPending} />
              {nextCursor ? (
                <div className="flex justify-center">
                  <Button type="button" variant="ghost-pill" size="pill" onClick={loadMore} disabled={loading}>
                    {loading ? "Loading more..." : "Load more"}
                  </Button>
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

/**
 * Holds the previous results on screen while a new set loads, dimmed the way the
 * monitor dashboard dims a refreshing panel. Blanking the grid on a filter change
 * threw away painted cards and forced a full relayout for no user-visible gain.
 */
function PendingResultsGrid({
  cards,
  pending,
}: {
  cards: CustomerMetaAdLibraryCard[];
  pending: boolean;
}) {
  return (
    <div
      aria-busy={pending || undefined}
      className={`transition-opacity duration-250 motion-reduce:transition-none ${pending ? "opacity-55" : ""}`}
    >
      <AdRadarResultsGrid cards={cards} />
    </div>
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
