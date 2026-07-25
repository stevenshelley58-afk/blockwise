import { RefreshCw } from "lucide-react";

import type { MonitorDateRange, MonitorRange } from "@/lib/meta-monitor/types";

const RANGE_OPTIONS: Array<{ value: MonitorRange; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7", label: "7d" },
  { value: "last_30", label: "30d" },
  { value: "maximum", label: "Max" },
];

const customRangeStyles = {
  container: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid var(--line)",
    borderRadius: 999,
    background: "var(--surface-subtle)",
    padding: "3px 10px",
    color: "var(--muted)",
  },
  input: {
    minHeight: 30,
    border: 0,
    background: "transparent",
    color: "var(--ink)",
    font: "inherit",
    fontSize: 12.5,
    fontWeight: 600,
    outline: "none",
  },
} as const;

export function MetaMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size * 1.6} height={size} viewBox="0 0 48 30" aria-hidden role="presentation">
      <defs>
        <linearGradient id="mm-meta-gradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0668E1" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <path
        d="M24 15 C19 5, 7 5, 7 15 C7 25, 19 25, 24 15 C29 5, 41 5, 41 15 C41 25, 29 25, 24 15 Z"
        fill="none"
        stroke="url(#mm-meta-gradient)"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MetaMonitorHeader(props: {
  range: MonitorDateRange;
  rangeKey: MonitorRange;
  customRange: { since: string; until: string };
  lastSyncedAt: string | null;
  isRefreshing: boolean;
  isSample: boolean;
  onRangeChange: (range: MonitorRange) => void;
  onCustomRangeChange: (range: { since: string; until: string }) => void;
  onRefresh: () => void;
}) {
  return (
    <header className="mm-header">
      <div>
        <div className="eyebrow">Performance</div>
        <div className="mm-title-row">
          <MetaMark />
          <h1>Performance</h1>
          {props.isSample ? <span className="mm-chip mm-chip-demo">Demo data</span> : null}
        </div>
      </div>
      <div className="mm-header-controls">
        <span className="mm-synced">
          <span className="mm-synced-dot" aria-hidden />
          {props.lastSyncedAt ? `Last synced ${timeAgo(props.lastSyncedAt)}` : "Not synced yet"}
        </span>
        <div className="mm-range-toolbar">
          <div className="mm-range-segment" role="group" aria-label={`Date range, ${formatRangeSpan(props.range)}`}>
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={option.value === props.rangeKey ? "active" : undefined}
                onClick={() => props.onRangeChange(option.value)}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              className={props.rangeKey === "custom" ? "active" : undefined}
              onClick={() => props.onCustomRangeChange(props.customRange)}
            >
              Custom
            </button>
          </div>
          {props.rangeKey === "custom" ? (
            <div style={customRangeStyles.container} role="group" aria-label="Custom date range">
              <input
                type="date"
                aria-label="From date"
                style={customRangeStyles.input}
                value={props.customRange.since}
                max={props.customRange.until || undefined}
                onChange={(event) => props.onCustomRangeChange({ ...props.customRange, since: event.target.value })}
              />
              <span aria-hidden>–</span>
              <input
                type="date"
                aria-label="To date"
                style={customRangeStyles.input}
                value={props.customRange.until}
                min={props.customRange.since || undefined}
                onChange={(event) => props.onCustomRangeChange({ ...props.customRange, until: event.target.value })}
              />
            </div>
          ) : null}
          <button
            className="button secondary mm-refresh-button"
            type="button"
            onClick={props.onRefresh}
            disabled={props.isRefreshing}
            aria-label={props.isRefreshing ? "Refreshing results" : "Refresh results"}
          >
            <RefreshCw size={14} className={props.isRefreshing ? "mm-spin" : undefined} aria-hidden />
            <span>{props.isRefreshing ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function formatRangeSpan(range: MonitorDateRange): string {
  return `${formatDay(range.since)} – ${formatDay(range.until)}`;
}

function formatDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);

  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);

  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
