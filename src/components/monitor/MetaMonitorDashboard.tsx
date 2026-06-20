"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

import { Eye, MousePointerClick, Percent, UserPlus, Users, Wallet } from "lucide-react";
import { useState } from "react";

import { calculateTrend, formatCurrency, formatPercent } from "@/lib/meta-monitor/calculations";
import type { AnglePerformance, MetaMonitorPayload, MonitorRange } from "@/lib/meta-monitor/types";

import { AdPerformanceCard, adCardDomId } from "./AdPerformanceCard";
import { CampaignsManagement } from "./CampaignsManagement";
import { DemoModeNotice } from "./DemoModeNotice";
import { EmptyMetaState } from "./EmptyMetaState";
import { MetaKpiCard } from "./MetaKpiCard";
import { MetaMonitorHeader } from "./MetaMonitorHeader";
import { MonitorDashboardSkeleton } from "./MonitorDashboardSkeleton";

// Recharts is heavy; load the chart bundles on demand so they don't ship in the
// initial /results JS on mobile. Behaviour is unchanged — charts still render client-side.
const SmoothAreaChart = dynamic(() => import("./SmoothAreaChart").then((m) => m.SmoothAreaChart), { ssr: false });

const IMPRESSIONS_COLOR = "#3b82f6";
const CLICKS_COLOR = "#22a06b";
const SPEND_COLOR = "#6d5ae6";

export type OAuthNotice = {
  tone: "success" | "error" | "warning";
  message: string;
  settingsLink?: boolean;
};

export function MetaMonitorDashboard({
  initialPayload,
  metaConnectHref,
  oauthNotice,
}: {
  initialPayload: MetaMonitorPayload;
  metaConnectHref?: string;
  oauthNotice?: OAuthNotice | null;
}) {
  const [payload, setPayload] = useState(initialPayload);
  const [rangeKey, setRangeKey] = useState<MonitorRange>(initialPayload.range.key);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  async function refresh(nextRange: MonitorRange = rangeKey) {
    setIsRefreshing(true);
    setError(null);

    try {
      const response = await fetch(`/api/monitor-dashboard?range=${nextRange}`, { cache: "no-store" });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;

        throw new Error(body?.error ?? `Refresh failed with ${response.status}.`);
      }

      setPayload((await response.json()) as MetaMonitorPayload);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleRangeChange(nextRange: MonitorRange) {
    setRangeKey(nextRange);
    void refresh(nextRange);
  }

  function scrollToAd(adId: string) {
    const card = document.getElementById(adCardDomId(adId));

    if (!card) {
      return;
    }

    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("mm-flash");
    window.setTimeout(() => card.classList.remove("mm-flash"), 1600);
  }

  const summary = payload.summary;

  return (
    <div className="content mm-page">
      <MetaMonitorHeader
        range={payload.range}
        rangeKey={rangeKey}
        lastSyncedAt={summary?.lastSyncedAt ?? null}
        isRefreshing={isRefreshing}
        isSample={payload.source === "sample"}
        onRangeChange={handleRangeChange}
        onRefresh={() => void refresh()}
      />

      {error ? <p className="mm-error" role="alert">{error}</p> : null}

      {oauthNotice && !noticeDismissed ? (
        <div className={`mm-oauth-notice mm-oauth-notice--${oauthNotice.tone}`} role="alert">
          <span>{oauthNotice.message}</span>
          {oauthNotice.settingsLink ? (
            <Link href="/settings" className="mm-oauth-notice-link">Go to Settings</Link>
          ) : null}
          <button type="button" className="mm-oauth-notice-dismiss" aria-label="Dismiss" onClick={() => setNoticeDismissed(true)}>✕</button>
        </div>
      ) : null}

      {payload.source === "sample" && !payload.connected && metaConnectHref ? (
        <DemoModeNotice metaConnectHref={metaConnectHref} />
      ) : null}

      {payload.source === "sample" && payload.connected ? (
        <div className="mm-oauth-notice mm-oauth-notice--warning" role="status">
          <span>
            Showing sample data — your live Meta results will appear here automatically once your ads start delivering.
          </span>
        </div>
      ) : null}

      {!summary ? (
        isRefreshing ? <MonitorDashboardSkeleton /> : (
          <EmptyMetaState issue={payload.issue} connected={payload.connected} metaConnectHref={metaConnectHref} />
        )
      ) : isRefreshing ? (
        <Dashboard payload={payload} onSelectAd={scrollToAd} refreshing />
      ) : (
        <Dashboard payload={payload} onSelectAd={scrollToAd} />
      )}
    </div>
  );
}

function Dashboard({ payload, onSelectAd, refreshing = false }: { payload: MetaMonitorPayload; onSelectAd: (adId: string) => void; refreshing?: boolean }) {
  const summary = payload.summary!;
  const previous = summary.previousPeriod;
  const reach = summary.reach ?? 0;
  const ctr = summary.impressions > 0 ? summary.clicks / summary.impressions : null;
  const dailyNote = `Daily · last ${payload.range.days} day${payload.range.days === 1 ? "" : "s"}`;
  const totalStyle = { fontSize: 28, fontWeight: 650, letterSpacing: "-0.02em", margin: "2px 0 12px" } as const;
  const compare = previous ? `vs previous ${payload.range.days} day${payload.range.days === 1 ? "" : "s"}` : undefined;
  const wrapperStyle = refreshing
    ? ({ opacity: 0.55, pointerEvents: "none" as const, transition: "opacity 200ms ease" })
    : undefined;

  return (
    <div style={wrapperStyle} aria-busy={refreshing || undefined} aria-live="polite">
      <div className="mm-kpi-grid">
        <MetaKpiCard icon={Users} iconTone="blue" label="Reach" value={reach.toLocaleString("en-AU")} compareText="people reached" />
        <MetaKpiCard icon={Eye} iconTone="indigo" label="Impressions" value={summary.impressions.toLocaleString("en-AU")} compareText={compare} />
        <MetaKpiCard icon={MousePointerClick} iconTone="green" label="Link clicks" value={summary.clicks.toLocaleString("en-AU")} compareText={compare} />
        <MetaKpiCard icon={Percent} iconTone="slate" label="CTR" value={ctr != null ? formatPercent(ctr, 1) : "—"} compareText="clicks ÷ impressions" />
        <MetaKpiCard
          icon={UserPlus}
          iconTone="green"
          label="Leads"
          value={summary.leads.toLocaleString("en-AU")}
          compareText={compare}
          trend={previous ? calculateTrend(summary.leads, previous.leads) : null}
        />
        <MetaKpiCard
          icon={Wallet}
          iconTone="rose"
          label="Spend"
          value={formatCurrency(summary.spend)}
          compareText={compare}
          trend={previous ? calculateTrend(summary.spend, previous.spend) : null}
        />
      </div>

      <div className="mm-chart-grid">
        <section className="panel mm-chart-panel">
          <h3>Impressions over time</h3>
          <p className="mm-chart-note">{dailyNote}</p>
          <div style={totalStyle}>{summary.impressions.toLocaleString("en-AU")}</div>
          <SmoothAreaChart
            id="impressions"
            color={IMPRESSIONS_COLOR}
            data={payload.daily.map((point) => ({ date: point.date, value: point.impressions ?? 0 }))}
            valueFormatter={(value) => Math.round(value).toLocaleString("en-AU")}
          />
        </section>
        <section className="panel mm-chart-panel">
          <h3>Link clicks over time</h3>
          <p className="mm-chart-note">{dailyNote}</p>
          <div style={totalStyle}>{summary.clicks.toLocaleString("en-AU")}</div>
          <SmoothAreaChart
            id="clicks"
            color={CLICKS_COLOR}
            data={payload.daily.map((point) => ({ date: point.date, value: point.clicks ?? 0 }))}
            valueFormatter={(value) => Math.round(value).toLocaleString("en-AU")}
          />
        </section>
        <section className="panel mm-chart-panel">
          <h3>Spend over time</h3>
          <p className="mm-chart-note">{dailyNote}</p>
          <div style={totalStyle}>{formatCurrency(summary.spend)}</div>
          <SmoothAreaChart
            id="spend"
            color={SPEND_COLOR}
            data={payload.daily.map((point) => ({ date: point.date, value: point.spend }))}
            valueFormatter={(value) => formatCurrency(value)}
          />
        </section>
      </div>

      {(payload.anglePerformance?.length ?? 0) > 0 ? (
        <AnglePerformanceTable rows={payload.anglePerformance ?? []} />
      ) : null}

      {payload.ads.length > 0 ? (
        <>
          <CampaignsManagement ads={payload.ads} onSelectAd={onSelectAd} />
          <h3 className="mm-section-title">Ad breakdown</h3>
          <div className="mm-ad-grid">
            {payload.ads.map((ad) => (
              <AdPerformanceCard key={ad.adId} ad={ad} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function AnglePerformanceTable({ rows }: { rows: AnglePerformance[] }) {
  return (
    <section className="panel mm-table-panel">
      <div className="mm-table-head">
        <h3>Angle performance</h3>
      </div>
      <p className="mm-chart-note">
        Built from Ad Studio variant tags in ad names. Ads published outside Ad Studio group under
        &quot;Untagged&quot;.
      </p>
      <div className="mm-table-scroll">
        <table className="mm-table">
          <thead>
            <tr>
              <th className="mm-th-left">Angle</th>
              <th className="mm-th-left">Template</th>
              <th>Ads</th>
              <th>Spend</th>
              <th>CTR</th>
              <th>Leads</th>
              <th>Valid leads</th>
              <th>Valid CPL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.angle}-${row.template ?? ""}`}>
                <td className="mm-th-left">
                  <b>{row.angle}</b>
                </td>
                <td className="mm-th-left">{row.template ?? "—"}</td>
                <td>{row.ads}</td>
                <td>
                  <b>{formatCurrency(row.spend)}</b>
                </td>
                <td>{row.ctr != null ? formatPercent(row.ctr, 2) : "—"}</td>
                <td>{row.leads}</td>
                <td>
                  <b>{row.validLeads}</b>
                </td>
                <td>
                  <b>{row.validCpl != null ? formatCurrency(row.validCpl) : "—"}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
