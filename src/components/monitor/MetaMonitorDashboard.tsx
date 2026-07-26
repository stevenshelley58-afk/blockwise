"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Eye,
  ImageOff,
  MousePointerClick,
  Percent,
  Play,
  UserPlus,
  Wallet,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { calculateTrend, formatCurrency, formatPercent, safeRate } from "@/lib/meta-monitor/calculations";
import {
  buildResultsHierarchy,
  type ResultsCampaignRow,
  type ResultsHierarchyStatus,
} from "@/lib/meta-monitor/results-hierarchy";
import type { AnglePerformance, MetaMonitorPayload, MonitorRange } from "@/lib/meta-monitor/types";

import { AdPerformanceCard, adCardDomId } from "./AdPerformanceCard";
import { AdManagementControls, BudgetManagementControl } from "./AdManagementControls";
import { DemoModeNotice } from "./DemoModeNotice";
import { EmptyMetaState } from "./EmptyMetaState";
import { MetaKpiCard } from "./MetaKpiCard";
import { MetaMonitorHeader } from "./MetaMonitorHeader";
import { MonitorDashboardSkeleton } from "./MonitorDashboardSkeleton";
import { SuburbBarChart } from "./SuburbBarChart";

// Recharts is heavy; load the chart bundles on demand so they don't ship in the
// initial /results JS on mobile. Behaviour is unchanged — charts still render client-side.
const SmoothAreaChart = dynamic(() => import("./SmoothAreaChart").then((m) => m.SmoothAreaChart), { ssr: false });
const BudgetPacingChart = dynamic(() => import("./BudgetPacingChart").then((m) => m.BudgetPacingChart), { ssr: false });

const SPEND_COLOR = "#123e75";
// One data colour across every chart (Premium V2 restraint). Green is reserved
// for positive deltas in the KPI strip, not used as a series colour.
const LEADS_COLOR = "#123e75";

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
  const [customRange, setCustomRange] = useState<{ since: string; until: string }>({
    since: initialPayload.range.since,
    until: initialPayload.range.until,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  async function refresh(
    nextRange: MonitorRange = rangeKey,
    nextCustomRange: { since: string; until: string } = customRange,
  ) {
    setIsRefreshing(true);
    setError(null);

    try {
      const params = new URLSearchParams({ range: nextRange });

      if (nextRange === "custom") {
        params.set("since", nextCustomRange.since);
        params.set("until", nextCustomRange.until);
      }

      const response = await fetch(`/api/monitor-dashboard?${params.toString()}`, { cache: "no-store" });

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

  function handleCustomRangeChange(nextCustomRange: { since: string; until: string }) {
    setRangeKey("custom");
    setCustomRange(nextCustomRange);

    if (nextCustomRange.since && nextCustomRange.until) {
      void refresh("custom", nextCustomRange);
    }
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
        customRange={customRange}
        lastSyncedAt={summary?.lastSyncedAt ?? null}
        isRefreshing={isRefreshing}
        isSample={payload.source === "sample"}
        onRangeChange={handleRangeChange}
        onCustomRangeChange={handleCustomRangeChange}
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
  const hierarchy = useMemo(() => buildResultsHierarchy(payload.ads), [payload.ads]);
  const ctr = safeRate(summary.clicks, summary.impressions);
  const previousCtr = previous ? safeRate(previous.clicks, previous.impressions) : null;
  const compare = previous ? `vs previous ${payload.range.days} day${payload.range.days === 1 ? "" : "s"}` : undefined;
  const wrapperStyle = refreshing
    ? ({ opacity: 0.55, pointerEvents: "none" as const, transition: "opacity 200ms ease" })
    : undefined;

  return (
    <div className="mm-dashboard-body" style={wrapperStyle} aria-busy={refreshing || undefined} aria-live="polite">
      <div className="mm-kpi-grid">
        <MetaKpiCard
          icon={Eye}
          iconTone="blue"
          label="Reach"
          value={summary.reach.toLocaleString("en-AU")}
          compareText={compare}
          trend={previous ? calculateTrend(summary.reach, previous.reach) : null}
        />
        <MetaKpiCard
          icon={BarChart3}
          iconTone="slate"
          label="Impressions"
          value={summary.impressions.toLocaleString("en-AU")}
          compareText={compare}
          trend={previous ? calculateTrend(summary.impressions, previous.impressions) : null}
        />
        <MetaKpiCard
          icon={MousePointerClick}
          iconTone="indigo"
          label="Link clicks"
          value={summary.clicks.toLocaleString("en-AU")}
          compareText={compare}
          trend={previous ? calculateTrend(summary.clicks, previous.clicks) : null}
        />
        <MetaKpiCard
          icon={Percent}
          iconTone="orange"
          label="CTR"
          value={ctr != null ? formatPercent(ctr, 2) : "Unavailable"}
          compareText={compare}
          trend={previous ? calculateTrend(ctr, previousCtr) : null}
        />
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
          <h3>Spend over time</h3>
          <SmoothAreaChart
            id="spend"
            color={SPEND_COLOR}
            data={payload.daily.map((point) => ({ date: point.date, value: point.spend }))}
            valueFormatter={(value) => formatCurrency(value)}
          />
        </section>
        <section className="panel mm-chart-panel">
          <h3>Valid leads over time</h3>
          <SmoothAreaChart
            id="valid-leads"
            color={LEADS_COLOR}
            data={payload.daily.map((point) => ({ date: point.date, value: point.validLeads }))}
            valueFormatter={(value) => String(Math.round(value))}
          />
        </section>
        <section className="panel mm-chart-panel">
          <h3>Valid CPL over time</h3>
          <p className="mm-chart-note">Gaps mark days with no valid leads — a $0 CPL is never shown.</p>
          <SmoothAreaChart
            id="valid-cpl"
            color={LEADS_COLOR}
            data={payload.daily.map((point) => ({ date: point.date, value: point.validCpl }))}
            valueFormatter={(value) => formatCurrency(value)}
          />
        </section>
      </div>

      {payload.ads.length > 0 ? (
        <>
          <CampaignManagementTable rows={hierarchy} onSelectAd={onSelectAd} />
          <div className="mm-section-heading">
            <div>
              <h2>Lead results</h2>
              <p>Results by listing or offer, with lead quality, cost, and the next action.</p>
            </div>
          </div>
          <div className="mm-ad-grid">
            {payload.ads.map((ad) => (
              <AdPerformanceCard key={ad.adId} ad={ad} />
            ))}
          </div>
        </>
      ) : null}

      <div className="mm-chart-grid two mm-secondary-grid">
        {payload.suburbPerformance.length > 0 ? (
          <section className="panel mm-chart-panel">
            <h3>Valid leads by suburb</h3>
            <SuburbBarChart rows={payload.suburbPerformance} />
          </section>
        ) : null}
        <section className="panel mm-chart-panel">
          <h3>Budget pacing</h3>
          <BudgetPacingChart
            daily={payload.daily}
            budget={summary.budget}
            spend={summary.spend}
            range={payload.range}
          />
        </section>
      </div>

      {(payload.anglePerformance?.length ?? 0) > 0 ? (
        <AnglePerformanceTable rows={payload.anglePerformance ?? []} />
      ) : null}
    </div>
  );
}

function CampaignManagementTable({
  rows,
  onSelectAd,
}: {
  rows: ResultsCampaignRow[];
  onSelectAd: (adId: string) => void;
}) {
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set(rows.map((row) => row.id)));

  function toggle(rowId: string) {
    setOpenRows((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="panel mm-campaign-panel">
      <div className="mm-section-heading">
        <div>
          <h2>Campaigns</h2>
          <p>Expand campaigns to manage ad sets and ads with approval-gated Meta changes.</p>
        </div>
        <div className="mm-campaign-legend" aria-label="Row labels">
          <OriginTag managed />
          <OriginTag managed={false} />
          <span className="mm-origin-tag fatigue">Fatigue</span>
        </div>
      </div>
      <div className="mm-table-scroll">
        <table className="mm-table mm-campaign-table">
          <thead>
            <tr>
              <th className="mm-th-left">Campaign / ad set / ad</th>
              <th>Status</th>
              <th>Daily budget</th>
              <th>Spend</th>
              <th>Leads</th>
              <th>Valid</th>
              <th>CPL</th>
              <th className="mm-th-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((campaign) => {
              const campaignOpen = openRows.has(campaign.id);
              return (
                <Fragment key={campaign.id}>
                  <tr className="mm-campaign-row">
                    <NameCell
                      depth={0}
                      label={campaign.name}
                      open={campaignOpen}
                      onToggle={() => toggle(campaign.id)}
                      managedByBlockwise={campaign.managedByBlockwise}
                      fatigued={campaign.fatigued}
                    />
                    <StatusCell status={campaign.status} />
                    <td className="muted">-</td>
                    <MetricCells metrics={campaign.metrics} />
                    <td className="mm-th-left">
                      <AdManagementControls
                        target={{ kind: "campaign", campaignId: campaign.campaignId }}
                        status={campaign.status}
                        disabledReason={campaign.campaignId ? undefined : "Missing Meta id"}
                      />
                    </td>
                  </tr>
                  {campaignOpen
                    ? campaign.adSets.map((adSet) => (
                        <Fragment key={adSet.id}>
                          <tr className="mm-adset-row">
                            <NameCell
                              depth={1}
                              label={adSet.name}
                              managedByBlockwise={adSet.managedByBlockwise}
                              fatigued={adSet.fatigued}
                            />
                            <StatusCell status={adSet.status} />
                            <td>
                              <BudgetManagementControl
                                adSetId={adSet.adsetId}
                                dailyBudgetDollars={adSet.dailyBudgetDollars}
                                disabledReason={adSet.dailyBudgetDollars == null ? "Unavailable" : undefined}
                              />
                            </td>
                            <MetricCells metrics={adSet.metrics} />
                            <td className="mm-th-left">
                              <AdManagementControls
                                target={{ kind: "adset", adSetId: adSet.adsetId }}
                                status={adSet.status}
                                disabledReason={adSet.adsetId ? undefined : "Missing Meta id"}
                              />
                            </td>
                          </tr>
                          {adSet.ads.map((ad) => (
                            <tr className="mm-leaf-ad-row" key={ad.id}>
                              <td className="mm-th-left">
                                <div className="mm-row-name mm-depth-2">
                                  <TableCreativePreview ad={ad.ad} />
                                  <button type="button" className="mm-ad-name-btn" onClick={() => onSelectAd(ad.id)}>
                                    {ad.name}
                                  </button>
                                  {ad.fatigued ? <span className="mm-origin-tag fatigue">Fatigue</span> : null}
                                </div>
                              </td>
                              <StatusCell status={ad.status} />
                              <td className="muted">-</td>
                              <MetricCells metrics={ad.metrics} />
                              <td className="mm-th-left">
                                <AdManagementControls
                                  target={{ kind: "ad", adId: ad.id }}
                                  status={ad.status}
                                  showExport
                                  disabledReason={ad.id ? undefined : "Missing Meta id"}
                                />
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      ))
                    : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TableCreativePreview({ ad }: { ad: ResultsCampaignRow["adSets"][number]["ads"][number]["ad"] }) {
  const src = ad.creative.thumbnailUrl ?? ad.creative.imageUrl ?? ad.creative.videoThumbnailUrl;
  const mediaLabel = ad.creative.type === "VIDEO" ? "Video preview" : "Image preview";

  if (!src) {
    return (
      <span className="mm-table-creative mm-table-creative-empty" aria-label="No creative preview">
        <ImageOff size={15} aria-hidden />
      </span>
    );
  }

  return (
    <span className="mm-table-creative">
      {/* Meta CDN thumbnails are short-lived signed URLs; next/image optimization would break them. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`${ad.adName} ${mediaLabel.toLowerCase()}`} width={36} height={36} loading="lazy" />
      {ad.creative.type === "VIDEO" ? (
        <span className="mm-table-creative-play" aria-label={mediaLabel}>
          <Play size={10} aria-hidden />
        </span>
      ) : null}
    </span>
  );
}

function NameCell({
  depth,
  label,
  open,
  onToggle,
  managedByBlockwise,
  fatigued,
}: {
  depth: 0 | 1;
  label: string;
  open?: boolean;
  onToggle?: () => void;
  managedByBlockwise: boolean;
  fatigued: boolean;
}) {
  return (
    <td className="mm-th-left">
      <div className={`mm-row-name mm-depth-${depth}`}>
        {onToggle ? (
          <button type="button" className="mm-disclosure" aria-expanded={open} onClick={onToggle}>
            {open ? <ChevronDown aria-hidden size={14} /> : <ChevronRight aria-hidden size={14} />}
            {label}
          </button>
        ) : (
          <span className="mm-row-title">{label}</span>
        )}
        <OriginTag managed={managedByBlockwise} />
        {fatigued ? <span className="mm-origin-tag fatigue">Fatigue</span> : null}
      </div>
    </td>
  );
}

function MetricCells({ metrics }: { metrics: ResultsCampaignRow["metrics"] }) {
  return (
    <>
      <td>
        <b>{formatCurrency(metrics.spend)}</b>
      </td>
      <td>{metrics.leads.toLocaleString("en-AU")}</td>
      <td>
        <b>{metrics.validLeads.toLocaleString("en-AU")}</b>
      </td>
      <td>{metrics.validCpl != null ? formatCurrency(metrics.validCpl) : "-"}</td>
    </>
  );
}

function StatusCell({ status }: { status: ResultsHierarchyStatus }) {
  return (
    <td>
      <span className={`mm-pill ${statusTone(status)}`}>{statusLabel(status)}</span>
    </td>
  );
}

function OriginTag({ managed }: { managed: boolean }) {
  return (
    <span className={`mm-origin-tag ${managed ? "blockwise" : "meta"}`}>
      {managed ? "Blockwise" : "In Meta"}
    </span>
  );
}

function statusTone(status: ResultsHierarchyStatus): "green" | "amber" | "neutral" {
  if (status === "ACTIVE") return "green";
  if (status === "PAUSED") return "amber";

  return "neutral";
}

function statusLabel(status: ResultsHierarchyStatus): string {
  if (status === "MIXED") return "Mixed";
  return status.charAt(0) + status.slice(1).toLowerCase();
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
