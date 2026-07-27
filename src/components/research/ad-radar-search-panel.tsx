"use client";

import { Bookmark, ChevronDown, Clock3, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AdRadarLocationForm } from "@/components/research/ad-radar-location-form";
import { AdRadarResultsGrid } from "@/components/research/ad-radar-results-grid";
import { Switch } from "@/components/ui/switch";
import { niche } from "@/config/niche";
import type { CustomerMetaAdLibraryCard } from "@/lib/research/customer-meta-card";

type ResearchSort = "recent" | "longest";

type Filters = {
  status: "" | "active" | "inactive";
  agency: string;
  agent: string;
  adType: string;
  format: string;
  hook: string;
};

const EMPTY_FILTERS: Filters = { status: "", agency: "", agent: "", adType: "", format: "", hook: "" };

const AD_TYPE_OPTIONS = niche.copy.adRadar.filters.adTypes;

const FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "carousel", label: "Carousel" },
];

const fieldLabelClass = "font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase";
const controlClass =
  "h-9 w-full appearance-none rounded-(--r-card) border border-(--line) bg-(--surface) px-2.5 pr-7 text-[12.5px] font-semibold text-foreground outline-none transition-[border-color] duration-150 focus:border-(--ink)";
const ghostButtonClass =
  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-(--line-heavy) bg-card px-3.5 text-[12.5px] font-bold text-foreground transition-[background,box-shadow] duration-150 hover:bg-(--surface-subtle) hover:shadow-card";

type Props = {
  initialQuery: string;
  initialSort: ResearchSort;
  initialIncludeSurrounding: boolean;
  initialLocationLabel: string;
  initialNote: string;
};

type SearchResponse = { cards?: CustomerMetaAdLibraryCard[]; error?: string };

export function AdRadarSearchPanel({ initialQuery, initialSort, initialIncludeSurrounding, initialLocationLabel, initialNote }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<ResearchSort>(initialSort);
  const [includeSurrounding, setIncludeSurrounding] = useState(initialIncludeSurrounding);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [agencyOptions, setAgencyOptions] = useState<string[]>([]);
  const [agentOptions, setAgentOptions] = useState<string[]>([]);
  const [cards, setCards] = useState<CustomerMetaAdLibraryCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function doSearch(
    q: string,
    activeSort: ResearchSort = sort,
    activeIncludeSurrounding = includeSurrounding,
    activeFilters: Filters = filters,
  ) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q });
        if (activeSort !== "recent") params.set("sort", activeSort);
        if (activeIncludeSurrounding) params.set("includeSurrounding", "1");
        if (activeFilters.status) params.set("status", activeFilters.status);
        if (activeFilters.agency) params.set("agency", activeFilters.agency);
        if (activeFilters.agent) params.set("agent", activeFilters.agent);
        if (activeFilters.adType) params.set("adType", activeFilters.adType);
        if (activeFilters.format) params.set("format", activeFilters.format);
        if (activeFilters.hook) params.set("hook", activeFilters.hook);
        const res = await fetch(`/api/research/ads/search?${params.toString()}`);
        const data: SearchResponse = res.ok ? await res.json() : { cards: [] };
        const nextCards = data.cards ?? [];
        setCards(nextCards);
        setSearched(true);
        // Accumulate agency/agent options across the query session so picking
        // one filter doesn't erase the others from the dropdowns.
        setAgencyOptions((prev) => mergeOptions(prev, nextCards.map((c) => c.agencyName)));
        setAgentOptions((prev) => mergeOptions(prev, nextCards.map((c) => c.agentName)));
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function onSearch(q: string) {
    setQuery(q);
    setAgencyOptions([]);
    setAgentOptions([]);
    doSearch(q, sort, includeSurrounding, filters);
  }

  function onToggleSurrounding(nextValue: boolean) {
    setIncludeSurrounding(nextValue);
    if (searched && query.trim()) doSearch(query, sort, nextValue, filters);
  }

  function onChangeFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    if (searched && query.trim()) doSearch(query, sort, includeSurrounding, next);
  }

  function onClearFilters() {
    if (activeFilterCount === 0) return;
    setFilters(EMPTY_FILTERS);
    if (searched && query.trim()) doSearch(query, sort, includeSurrounding, EMPTY_FILTERS);
  }

  function onChangeSort(nextSort: ResearchSort) {
    if (nextSort === sort) return;
    setSort(nextSort);
    if (searched && query.trim()) doSearch(query, nextSort, includeSurrounding, filters);
  }

  useEffect(() => {
    if (initialQuery) doSearch(initialQuery, initialSort, initialIncludeSurrounding);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const sortChipClass = (active: boolean) =>
    `cursor-pointer rounded-full px-3 py-1.5 text-xs font-bold transition-[background,color] duration-150 ${
      active ? "bg-(--ink) text-white" : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <>
      <section className="grid gap-4 rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card">
        <AdRadarLocationForm
          buttonLabel={loading ? "Searching..." : "Search"}
          initialNote={initialNote}
          initialValue={initialQuery || initialLocationLabel}
          inputLabel="Search Ad Radar"
          isSubmitting={loading}
          onSearch={onSearch}
          placeholder={niche.copy.adRadar.searchPlaceholder}
          surface="research"
        />

        <label className="flex w-fit cursor-pointer items-center gap-2.5">
          <Switch checked={includeSurrounding} onCheckedChange={onToggleSurrounding} />
          <span className="text-[12.5px] font-bold text-foreground">{niche.copy.adRadar.includeSurrounding}</span>
        </label>

        <div className="flex flex-wrap items-center gap-2.5 border-t border-(--line) pt-4">
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

          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            <Link href="/ad-radar/swipe-file" className={ghostButtonClass}>
              <Bookmark size={13} aria-hidden />
              Swipe file
            </Link>
            <span className="text-[11.5px] font-bold text-(--faint)">Sort</span>
            <div
              role="group"
              aria-label="Sort ads"
              className="inline-flex items-center rounded-full border border-(--line) bg-(--surface) p-0.5"
            >
              <button type="button" aria-pressed={sort === "recent"} onClick={() => onChangeSort("recent")} className={sortChipClass(sort === "recent")}>
                Most recent
              </button>
              <button type="button" aria-pressed={sort === "longest"} onClick={() => onChangeSort("longest")} className={sortChipClass(sort === "longest")}>
                Longest running
              </button>
            </div>
          </div>
        </div>

        {filtersOpen ? (
          <div className="border-t border-(--line) pt-4">
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
              <label className="grid gap-1.5">
                <span className={fieldLabelClass}>Status</span>
                <SelectWrap>
                  <select className={controlClass} value={filters.status} onChange={(e) => onChangeFilter("status", e.target.value as Filters["status"])}>
                    <option value="">Any</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </SelectWrap>
              </label>
              <label className="grid gap-1.5">
                <span className={fieldLabelClass}>Ad type</span>
                <SelectWrap>
                  <select className={controlClass} value={filters.adType} onChange={(e) => onChangeFilter("adType", e.target.value)}>
                    <option value="">All</option>
                    {AD_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </SelectWrap>
              </label>
              <label className="grid gap-1.5">
                <span className={fieldLabelClass}>Format</span>
                <SelectWrap>
                  <select className={controlClass} value={filters.format} onChange={(e) => onChangeFilter("format", e.target.value)}>
                    <option value="">All</option>
                    {FORMAT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </SelectWrap>
              </label>
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
              <label className="grid gap-1.5">
                <span className={fieldLabelClass}>Hook contains</span>
                <input
                  className="h-9 w-full rounded-(--r-card) border border-(--line) bg-(--surface) px-2.5 text-[12.5px] font-semibold text-foreground outline-none transition-[border-color] duration-150 placeholder:text-(--faint) focus:border-(--ink)"
                  type="text"
                  value={filters.hook}
                  placeholder={niche.copy.adRadar.filters.hookPlaceholder}
                  onChange={(e) => onChangeFilter("hook", e.target.value)}
                />
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

        <div className="flex items-center gap-1.5 text-[11.5px] text-(--faint)">
          <Clock3 size={13} aria-hidden />
          {newestSeenAt ? `Last seen ${formatDateTime(newestSeenAt)}` : "No live observations yet"}
        </div>
      </section>

      {searched ? (
        <section className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
          <StatTile label="Ads in view" value={String(cards.length)} note="Current matching ads" />
          <StatTile label="Advertisers" value={String(advertiserCount)} note="Pages with visible ads" />
          <StatTile label="Postcodes" value={String(allPostcodes.length)} note="Matched ad areas" />
          <StatTile label="Media visible" value={String(mediaReady)} note="Images, videos, or carousel media" />
        </section>
      ) : null}

      {searched ? (
        <section className="grid gap-3.5">
          <div>
            <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em]">
              {query ? `Results for "${query}"` : `Ads near ${initialLocationLabel}`}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {cards.length} ad{cards.length === 1 ? "" : "s"} across {advertiserCount} advertiser page
              {advertiserCount === 1 ? "" : "s"}
              {activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} applied` : ""}.
            </p>
          </div>

          {cards.length > 0 ? (
            <AdRadarResultsGrid cards={cards} />
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
