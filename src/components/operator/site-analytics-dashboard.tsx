"use client";

import { Activity, Eye, MousePointerClick, UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { MetricCard } from "@/components/metric-card";
import { SmoothAreaChart } from "@/components/monitor/SmoothAreaChart";
import type { AnalyticsSummary } from "@/lib/analytics/summarize";

const RANGE_OPTIONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

const integer = new Intl.NumberFormat("en-AU");
let regionNames: Intl.DisplayNames | null = null;
try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  regionNames = null;
}

function countryLabel(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code;
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

function deviceLabel(device: string): string {
  return device.charAt(0).toUpperCase() + device.slice(1);
}

export function SiteAnalyticsDashboard() {
  const [days, setDays] = useState<number>(7);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (range: number) => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/operator/analytics?days=${range}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`analytics ${response.status}`);
      setSummary((await response.json()) as AnalyticsSummary);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const totals = summary?.totals;
  const empty = !loading && !failed && (totals?.pageViews ?? 0) === 0;

  return (
    <>
      <section className="panel" aria-label="Date range">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {RANGE_OPTIONS.map((option) => (
            <button
              className={option.days === days ? "button compact primary" : "button compact secondary"}
              key={option.days}
              type="button"
              aria-pressed={option.days === days}
              onClick={() => setDays(option.days)}
            >
              {option.label}
            </button>
          ))}
          <span className="item-meta" style={{ marginLeft: "auto" }}>
            {loading ? "Loading…" : failed ? "Could not load analytics." : `Last ${days} days · bots filtered`}
          </span>
          {failed ? (
            <button className="button compact secondary" type="button" onClick={() => void load(days)}>
              Retry
            </button>
          ) : null}
        </div>
      </section>

      <section className="grid cols-4" aria-label="Traffic metrics">
        <MetricCard icon={UsersRound} label="Visitors" value={integer.format(totals?.visitors ?? 0)} note="Unique daily visitors (cookie-free)" />
        <MetricCard icon={Eye} label="Page views" value={integer.format(totals?.pageViews ?? 0)} note="Tracked pages, operator surfaces excluded" />
        <MetricCard icon={MousePointerClick} label="Sessions" value={integer.format(totals?.sessions ?? 0)} note="Visits split on 30 min of inactivity" />
        <MetricCard
          icon={Activity}
          label="Bounce rate"
          value={`${Math.round((totals?.bounceRate ?? 0) * 100)}%`}
          note={`Single-page sessions · ${(totals?.viewsPerSession ?? 0).toFixed(1)} views/session`}
        />
      </section>

      <section className="panel" aria-label="Daily page views">
        <h2>Daily Page Views</h2>
        {empty ? (
          <p className="item-meta">
            No page views recorded yet. Data appears here as soon as the next visitor lands on the site.
          </p>
        ) : (
          <SmoothAreaChart
            id="site-analytics-views"
            data={(summary?.daily ?? []).map((point) => ({ date: point.date, value: point.pageViews }))}
            color="#6366f1"
            valueFormatter={(value) => integer.format(value)}
          />
        )}
      </section>

      <section className="split">
        <div className="panel">
          <h2>Top Pages</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Path</th>
                <th>Views</th>
                <th>Visitors</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.topPages ?? []).map((row) => (
                <tr key={row.path}>
                  <td>{row.path}</td>
                  <td>{integer.format(row.views)}</td>
                  <td>{integer.format(row.visitors)}</td>
                </tr>
              ))}
              {(summary?.topPages ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3}>No data yet</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Referrers</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Views</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.referrers ?? []).map((row) => (
                <tr key={row.host}>
                  <td>{row.host}</td>
                  <td>{integer.format(row.views)}</td>
                </tr>
              ))}
              {(summary?.referrers ?? []).length === 0 ? (
                <tr>
                  <td colSpan={2}>Direct traffic only so far</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="split">
        <div className="panel">
          <h2>Devices</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Device</th>
                <th>Views</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.devices ?? []).map((row) => (
                <tr key={row.device}>
                  <td>{deviceLabel(row.device)}</td>
                  <td>{integer.format(row.views)}</td>
                  <td>{Math.round(row.share * 100)}%</td>
                </tr>
              ))}
              {(summary?.devices ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3}>No data yet</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Countries</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Country</th>
                <th>Views</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.countries ?? []).map((row) => (
                <tr key={row.country}>
                  <td>{countryLabel(row.country)}</td>
                  <td>{integer.format(row.views)}</td>
                </tr>
              ))}
              {(summary?.countries ?? []).length === 0 ? (
                <tr>
                  <td colSpan={2}>No data yet</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
