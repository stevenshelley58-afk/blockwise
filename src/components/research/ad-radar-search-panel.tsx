"use client";

import { Bookmark, ChevronDown, Clock3, FileSearch, ImageIcon, MapPin, SlidersHorizontal, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { MetricCard } from "@/components/metric-card";
import { AdRadarLocationForm } from "@/components/research/ad-radar-location-form";
import { AdRadarResultsGrid } from "@/components/research/ad-radar-results-grid";
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

const AD_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "listing", label: "Listing" },
  { value: "just_sold", label: "Just sold" },
  { value: "appraisal", label: "Appraisal" },
  { value: "open_home", label: "Open home" },
  { value: "property_management", label: "Property mgmt" },
  { value: "market_update", label: "Market update" },
  { value: "agency_brand", label: "Agency brand" },
];

const FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "carousel", label: "Carousel" },
];

const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const fieldLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "var(--muted)",
};
const controlStyle: CSSProperties = {
  minHeight: 36,
  padding: "0 10px",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-card, 10px)",
  background: "var(--surface)",
  color: "var(--ink)",
  fontSize: 13,
};

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

  const sortButtonStyle = (active: boolean): CSSProperties => ({
    fontSize: 13,
    fontWeight: 700,
    padding: "6px 14px",
    border: "none",
    background: active ? "var(--navy, #131b2e)" : "transparent",
    color: active ? "#fff" : "var(--ink)",
    cursor: "pointer",
  });

  return (
    <>
      <style>{`
        .ad-radar-search-card { flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 14px; }
        .ad-radar-search-card .research-search-form { width: 100%; align-items: center; }
        .ad-radar-search-card .research-search-form > label { flex: 1 1 260px; min-width: 0; }
        .ad-radar-search-card .research-location-field { width: 100%; }
        .ad-radar-search-card .research-location-note { flex-basis: 100%; margin: 4px 0 0; font-size: 12px; color: var(--muted); }
        .ad-radar-filters-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 16px; border-top: 1px solid var(--line); padding-top: 14px; }
      `}</style>
      <section className="panel research-search-panel ad-radar-search-card">
        <AdRadarLocationForm
          buttonLabel={loading ? "Searching..." : "Search"}
          initialNote={initialNote}
          initialValue={initialQuery || initialLocationLabel}
          inputLabel="Search Ad Radar"
          isSubmitting={loading}
          onSearch={onSearch}
          placeholder="Postcode, suburb, agency, or agent"
          surface="research"
        />

        <label className="research-surrounding-toggle">
          <input
            checked={includeSurrounding}
            name="includeSurrounding"
            onChange={(event) => onToggleSurrounding(event.target.checked)}
            type="checkbox"
            value="1"
          />
          <span>Include surrounding suburbs</span>
        </label>

        <div className="ad-radar-filters-row">
          <button
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              minHeight: 36,
              padding: "0 14px",
              border: "1px solid var(--line)",
              borderRadius: 999,
              background: "var(--surface)",
              color: "var(--ink)",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <SlidersHorizontal size={16} />
            Filters
            {activeFilterCount > 0 && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 18,
                  height: 18,
                  padding: "0 5px",
                  borderRadius: 999,
                  background: "var(--navy, #131b2e)",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {activeFilterCount}
              </span>
            )}
            <ChevronDown size={15} style={{ transform: filtersOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }} />
          </button>

          <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 10 }}>
            <Link
              href="/ad-radar/swipe-file"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700, color: "var(--ink)", textDecoration: "none" }}
            >
              <Bookmark size={13} /> Swipe file
            </Link>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Sort</span>
            <div
              role="group"
              aria-label="Sort ads"
              style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden" }}
            >
              <button type="button" aria-pressed={sort === "recent"} onClick={() => onChangeSort("recent")} style={sortButtonStyle(sort === "recent")}>
                Most recent
              </button>
              <button type="button" aria-pressed={sort === "longest"} onClick={() => onChangeSort("longest")} style={{ ...sortButtonStyle(sort === "longest"), borderLeft: "1px solid var(--line)" }}>
                Longest running
              </button>
            </div>
          </div>
        </div>

        {filtersOpen && (
          <div style={{ paddingTop: 4 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>Status</span>
                <select style={controlStyle} value={filters.status} onChange={(e) => onChangeFilter("status", e.target.value as Filters["status"])}>
                  <option value="">Any</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>Ad type</span>
                <select style={controlStyle} value={filters.adType} onChange={(e) => onChangeFilter("adType", e.target.value)}>
                  <option value="">All</option>
                  {AD_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>Format</span>
                <select style={controlStyle} value={filters.format} onChange={(e) => onChangeFilter("format", e.target.value)}>
                  <option value="">All</option>
                  {FORMAT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>Agency</span>
                <select style={controlStyle} value={filters.agency} onChange={(e) => onChangeFilter("agency", e.target.value)}>
                  <option value="">All agencies</option>
                  {agencyOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>Agent</span>
                <select style={controlStyle} value={filters.agent} onChange={(e) => onChangeFilter("agent", e.target.value)}>
                  <option value="">All agents</option>
                  {agentOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>Hook contains</span>
                <input
                  style={controlStyle}
                  type="text"
                  value={filters.hook}
                  placeholder="e.g. free appraisal"
                  onChange={(e) => onChangeFilter("hook", e.target.value)}
                />
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button
                type="button"
                onClick={onClearFilters}
                disabled={activeFilterCount === 0}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 999,
                  background: "var(--surface)",
                  color: "var(--ink)",
                  fontSize: 13,
                  fontWeight: 700,
                  minHeight: 34,
                  padding: "0 14px",
                  cursor: activeFilterCount === 0 ? "default" : "pointer",
                  opacity: activeFilterCount === 0 ? 0.5 : 1,
                }}
              >
                Clear all
              </button>
            </div>
          </div>
        )}

        <div className="research-freshness">
          <Clock3 size={14} />
          {newestSeenAt ? `Last seen ${formatDateTime(newestSeenAt)}` : "No live observations yet"}
        </div>
      </section>

      {searched && (
        <section className="grid cols-4">
          <MetricCard icon={FileSearch} label="Ads in view" value={String(cards.length)} note="Meta Ad Library results" />
          <MetricCard icon={Users} label="Advertisers" value={String(advertiserCount)} note="Meta pages with visible ads" />
          <MetricCard icon={MapPin} label="Postcodes" value={String(allPostcodes.length)} note="Matched ad areas" />
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
                {advertiserCount === 1 ? "" : "s"}
                {activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} applied` : ""}.
              </p>
            </div>
          </div>

          {cards.length > 0 ? (
            <AdRadarResultsGrid cards={cards} />
          ) : activeFilterCount > 0 ? (
            <div className="research-empty-state">
              <h3>No ads matched your filters</h3>
              <p>Try clearing a filter or widening the search area.</p>
            </div>
          ) : (
            <div className="research-empty-state">
              <h3>No ads matched</h3>
              <p>Try a nearby postcode.</p>
            </div>
          )}
        </section>
      )}
    </>
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
