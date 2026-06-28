"use client";

import { Bookmark, ChevronDown, Clock3, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

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
  const newestSeenAt = cards
    .map((c) => c.lastSeenAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);

  const sortButtonStyle = (active: boolean): CSSProperties => ({
    fontSize: 13,
    fontWeight: 700,
    minHeight: 40,
    padding: "0 12px",
    border: "none",
    background: active ? "var(--navy, #131b2e)" : "transparent",
    color: active ? "#fff" : "var(--ink)",
    cursor: "pointer",
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  });

  return (
    <>
      <style>{`
        .ad-radar-search-card { flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 12px; }
        .ad-radar-search-card .research-search-form { width: 100%; align-items: center; }
        .ad-radar-search-card .research-search-form > label { flex: 1 1 260px; min-width: 0; }
        .ad-radar-search-card .research-location-field { width: 100%; }
        .ad-radar-search-card .research-location-note { flex-basis: 100%; margin: 4px 0 0; font-size: 12px; color: var(--muted); }
        .ad-radar-support-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 16px; color: var(--muted); }
        .ad-radar-support-row .research-surrounding-toggle,
        .ad-radar-support-row .research-freshness { min-height: 28px; font-size: 12.5px; }
        .ad-radar-support-row .research-surrounding-toggle { min-height: 40px; font-weight: 700; }
        .ad-radar-support-row .research-freshness { margin-left: auto; }
        .ad-radar-controls-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px 12px; border-top: 1px solid var(--line); padding-top: 12px; }
        .ad-radar-control-cluster,
        .ad-radar-sort-wrap { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
        .ad-radar-control-button,
        .ad-radar-swipe-link,
        .ad-radar-sort-button {
          transition: transform 150ms ease, background-color 150ms ease, color 150ms ease, border-color 150ms ease;
        }
        .ad-radar-control-button:active,
        .ad-radar-swipe-link:active,
        .ad-radar-sort-button:active { transform: scale(0.96); }
        .ad-radar-control-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 40px;
          padding: 0 14px;
          border: 1px solid var(--line);
          border-radius: 999px;
          background: var(--surface);
          color: var(--ink);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
        }
        .ad-radar-swipe-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          min-height: 40px;
          padding: 0 12px;
          border-radius: 999px;
          color: var(--ink);
          font-size: 13px;
          font-weight: 700;
          text-decoration: none;
          white-space: nowrap;
        }
        .ad-radar-sort-label { color: var(--muted); font-size: 12px; white-space: nowrap; }
        .ad-radar-sort-group { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
        @media (max-width: 520px) {
          .ad-radar-support-row .research-freshness { margin-left: 0; }
          .ad-radar-controls-row { align-items: stretch; }
          .ad-radar-control-cluster,
          .ad-radar-sort-wrap { width: 100%; }
          .ad-radar-control-button,
          .ad-radar-swipe-link { flex: 1 1 0; }
          .ad-radar-sort-wrap { justify-content: space-between; }
          .ad-radar-sort-group { flex: 1; }
          .ad-radar-sort-button { flex: 1 1 0; padding: 0 8px; font-size: 12.5px; }
        }
      `}</style>
      <section className="panel research-search-panel ad-radar-search-card">
        <AdRadarLocationForm
          buttonLabel={loading ? "Searching..." : "Search"}
          initialNote={initialNote}
          initialValue={initialQuery || initialLocationLabel}
          isSubmitting={loading}
          onSearch={onSearch}
          placeholder="Postcode, suburb, agency, or agent"
          surface="research"
        />

        <div className="ad-radar-support-row">
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

          <div className="research-freshness">
            <Clock3 size={14} />
            {newestSeenAt ? `Last seen ${formatDateTime(newestSeenAt)}` : "No live observations yet"}
          </div>
        </div>

        <div className="ad-radar-controls-row">
          <div className="ad-radar-control-cluster">
            <button
              type="button"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
              className="ad-radar-control-button"
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

            <Link
              href="/ad-radar/swipe-file"
              className="ad-radar-swipe-link"
            >
              <Bookmark size={13} /> Swipe file
            </Link>
          </div>

          <div className="ad-radar-sort-wrap">
            <span className="ad-radar-sort-label">Sort</span>
            <div
              className="ad-radar-sort-group"
              role="group"
              aria-label="Sort ads"
            >
              <button className="ad-radar-sort-button" type="button" aria-pressed={sort === "recent"} onClick={() => onChangeSort("recent")} style={sortButtonStyle(sort === "recent")}>
                Most recent
              </button>
              <button className="ad-radar-sort-button" type="button" aria-pressed={sort === "longest"} onClick={() => onChangeSort("longest")} style={{ ...sortButtonStyle(sort === "longest"), borderLeft: "1px solid var(--line)" }}>
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
      </section>

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
              <p>Try a WA postcode such as 6008 or 6000 while the background collector expands coverage.</p>
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
