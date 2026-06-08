"use client";

import { useMemo, useState } from "react";

import { formatCurrency, formatPercent } from "@/lib/meta-monitor/calculations";
import type { MetaAdPerformance } from "@/lib/meta-monitor/types";

import { CreativePreview, StatusPill } from "./AdPerformanceCard";

type SortKey = "spend" | "validLeads" | "validCpl" | "status";

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "spend", label: "Spend" },
  { value: "validLeads", label: "Valid leads" },
  { value: "validCpl", label: "Valid CPL" },
  { value: "status", label: "Status" },
];

export function AdsSummaryTable({
  ads,
  onSelectAd,
}: {
  ads: MetaAdPerformance[];
  onSelectAd: (adId: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [descending, setDescending] = useState(true);

  const rows = useMemo(() => {
    const sorted = [...ads].sort((a, b) => {
      const left = sortValue(a, sortKey, descending);
      const right = sortValue(b, sortKey, descending);

      return descending ? right - left : left - right;
    });

    return sorted;
  }, [ads, sortKey, descending]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDescending((current) => !current);
    } else {
      setSortKey(key);
      setDescending(true);
    }
  }

  return (
    <section className="panel mm-table-panel">
      <div className="mm-table-head">
        <h3>Ads summary</h3>
        <label className="mm-sort">
          Sort by
          <select
            value={sortKey}
            onChange={(event) => {
              setSortKey(event.target.value as SortKey);
              setDescending(true);
            }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mm-table-scroll">
        <table className="mm-table">
          <thead>
            <tr>
              <th className="mm-th-left">Ad</th>
              <th className="mm-th-left">Campaign / Ad set</th>
              <th className="mm-th-left">Suburb</th>
              <SortableTh label="Spend" sortKey="spend" activeKey={sortKey} descending={descending} onSort={toggleSort} />
              <th>Impressions</th>
              <th>Clicks</th>
              <th>CTR</th>
              <th>Leads</th>
              <SortableTh label="Valid leads" sortKey="validLeads" activeKey={sortKey} descending={descending} onSort={toggleSort} />
              <th>Valid rate</th>
              <SortableTh label="Valid CPL" sortKey="validCpl" activeKey={sortKey} descending={descending} onSort={toggleSort} />
              <SortableTh label="Status" sortKey="status" activeKey={sortKey} descending={descending} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {rows.map((ad) => (
              <tr
                key={ad.adId}
                tabIndex={0}
                onClick={() => onSelectAd(ad.adId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectAd(ad.adId);
                  }
                }}
              >
                <td className="mm-th-left">
                  <span className="mm-ad-cell">
                    <CreativePreview ad={ad} size={34} />
                    <b>{ad.adName}</b>
                  </span>
                </td>
                <td className="mm-th-left">
                  <span className="mm-campaign">{ad.campaignName}</span>
                  <span className="mm-adset">{ad.adsetName || "—"}</span>
                </td>
                <td className="mm-th-left">{ad.suburb ?? "—"}</td>
                <td>
                  <b>{formatCurrency(ad.metrics.spend)}</b>
                </td>
                <td>{ad.metrics.impressions.toLocaleString("en-AU")}</td>
                <td>{ad.metrics.clicks.toLocaleString("en-AU")}</td>
                <td>{ad.metrics.ctr != null ? formatPercent(ad.metrics.ctr, 2) : "—"}</td>
                <td>{ad.metrics.leads}</td>
                <td>
                  <b>{ad.metrics.validLeads}</b>
                </td>
                <td>{ad.metrics.validRate != null ? formatPercent(ad.metrics.validRate) : "—"}</td>
                <td>
                  <b>{ad.metrics.validCpl != null ? formatCurrency(ad.metrics.validCpl) : "—"}</b>
                </td>
                <td>
                  <StatusPill status={ad.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mm-mobile-ad-list" aria-label="Ads summary">
        {rows.map((ad) => (
          <button
            type="button"
            className="mm-mobile-ad-card"
            key={ad.adId}
            onClick={() => onSelectAd(ad.adId)}
          >
            <span className="mm-mobile-ad-head">
              <CreativePreview ad={ad} size={48} />
              <span className="mm-mobile-ad-title">
                <span className="mm-mobile-label">Ad</span>
                <b>{ad.adName}</b>
                <StatusPill status={ad.status} />
              </span>
            </span>
            <span className="mm-mobile-ad-context">
              <span>
                <span className="mm-mobile-label">Campaign</span>
                <b>{ad.campaignName}</b>
              </span>
              <span>
                <span className="mm-mobile-label">Ad set</span>
                <b>{ad.adsetName || "-"}</b>
              </span>
              <span>
                <span className="mm-mobile-label">Suburb</span>
                <b>{ad.suburb ?? "-"}</b>
              </span>
            </span>
            <span className="mm-mobile-ad-metrics">
              <span>
                <span className="mm-mobile-label">Spend</span>
                <b>{formatCurrency(ad.metrics.spend)}</b>
              </span>
              <span>
                <span className="mm-mobile-label">Valid leads</span>
                <b>{ad.metrics.validLeads}</b>
              </span>
              <span>
                <span className="mm-mobile-label">Valid CPL</span>
                <b>{ad.metrics.validCpl != null ? formatCurrency(ad.metrics.validCpl) : "-"}</b>
              </span>
              <span>
                <span className="mm-mobile-label">Leads</span>
                <b>{ad.metrics.leads}</b>
              </span>
              <span>
                <span className="mm-mobile-label">CTR</span>
                <b>{ad.metrics.ctr != null ? formatPercent(ad.metrics.ctr, 2) : "-"}</b>
              </span>
              <span>
                <span className="mm-mobile-label">Valid rate</span>
                <b>{ad.metrics.validRate != null ? formatPercent(ad.metrics.validRate) : "-"}</b>
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SortableTh(props: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  descending: boolean;
  onSort: (key: SortKey) => void;
}) {
  const isActive = props.activeKey === props.sortKey;

  return (
    <th
      className="mm-th-sortable"
      role="columnheader"
      aria-sort={isActive ? (props.descending ? "descending" : "ascending") : "none"}
    >
      <button type="button" onClick={() => props.onSort(props.sortKey)}>
        {props.label} <span aria-hidden>{isActive ? (props.descending ? "▼" : "▲") : ""}</span>
      </button>
    </th>
  );
}

function sortValue(ad: MetaAdPerformance, key: SortKey, descending: boolean): number {
  if (key === "status") {
    return ad.status === "ACTIVE" ? 2 : ad.status === "PAUSED" ? 1 : 0;
  }

  if (key === "validCpl") {
    // Nulls always sink to the bottom regardless of direction.
    return ad.metrics.validCpl ?? (descending ? -Infinity : Infinity);
  }

  return ad.metrics[key];
}
