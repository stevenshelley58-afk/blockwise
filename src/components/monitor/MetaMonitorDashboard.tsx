"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

import { ChevronDown, ChevronRight, ImageOff, Play, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { changeBetween, MetricCard, type MetricChange } from "@/components/ui/metric-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { niche } from "@/config/niche";
import { formatCurrency, formatPercent, safeRate } from "@/lib/meta-monitor/calculations";
import { hasNoMetaConnection } from "@/lib/meta-monitor/payload-state";
import {
  buildResultsHierarchy,
  type ResultsCampaignRow,
  type ResultsHierarchyStatus,
} from "@/lib/meta-monitor/results-hierarchy";
import { buildSampleMetaMonitorPayload } from "@/lib/meta-monitor/sampleMetaMonitorData";
import type { AnglePerformance, MetaMonitorPayload, MonitorRange } from "@/lib/meta-monitor/types";
import {
  READ_MODEL_SCHEMA_VERSION,
  readLocalReadModel,
  writeLocalReadModel,
} from "@/lib/read-models/browser-store";
import { useReportingInvalidation } from "@/lib/read-models/use-reporting-invalidation";

import { AdPerformanceCard, adCardDomId } from "./AdPerformanceCard";
import { AdManagementControls, BudgetManagementControl } from "./AdManagementControls";
import { DemoModeNotice } from "./DemoModeNotice";
import { EmptyMetaState } from "./EmptyMetaState";
import { MetaMonitorHeader } from "./MetaMonitorHeader";
import { MonitorDashboardSkeleton } from "./MonitorDashboardSkeleton";
import { SuburbBarChart } from "./SuburbBarChart";

// Recharts is heavy; load the chart bundles on demand so they don't ship in the
// initial /results JS on mobile. Behaviour is unchanged — charts still render client-side.
const SmoothAreaChart = dynamic(() => import("./SmoothAreaChart").then((m) => m.SmoothAreaChart), { ssr: false });
const BudgetPacingChart = dynamic(() => import("./BudgetPacingChart").then((m) => m.BudgetPacingChart), { ssr: false });

// One data colour across every chart (Premium V2 restraint). Green is reserved
// for positive deltas in the KPI strip, not used as a series colour.
const DATA_HUE = "var(--ui-data)";

const panelClass = "min-w-0 rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card";
const panelTitleClass = "font-display text-[15.5px] font-extrabold tracking-[-0.015em]";
const thClass = "font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase";

type ChartMetric = "spend" | "leads" | "cpl";

const CHART_METRICS: ChartMetric[] = ["spend", "leads", "cpl"];

const wholeNumber = (value: number) => Math.round(value).toLocaleString("en-AU");

/**
 * The comparison as one sentence for assistive technology. The visible note
 * prints the percentage beside the arrow, so the spoken version has to carry
 * the direction in words.
 */
function spokenChange(current: number, prior: number | null, days: number): string | undefined {
  const change = changeBetween(current, prior);
  if (!change) return undefined;
  const period = `the previous ${days} day${days === 1 ? "" : "s"}`;
  return change.direction === "level"
    ? `No change from ${period}`
    : `${change.percent}% ${change.direction === "up" ? "higher" : "lower"} than ${period}`;
}

export type OAuthNotice = {
  tone: "success" | "error" | "warning";
  message: string;
  settingsLink?: boolean;
};

const noticeToneClass: Record<OAuthNotice["tone"], string> = {
  success: "border-success/25 bg-success-soft text-success",
  error: "border-error/25 bg-error-soft text-error",
  warning: "border-warning/30 bg-warning-soft text-warning",
};

export function MetaMonitorDashboard({
  initialPayload,
  initialEtag,
  initialGeneratedAt,
  userId,
  workspaceId,
  metaConnectHref,
  oauthNotice,
  focusCampaignId,
  showExample = false,
}: {
  initialPayload: MetaMonitorPayload;
  initialEtag: string;
  initialGeneratedAt: string;
  userId: string;
  workspaceId: string;
  metaConnectHref?: string;
  oauthNotice?: OAuthNotice | null;
  focusCampaignId?: string | null;
  showExample?: boolean;
}) {
  const [payload, setPayload] = useState(initialPayload);
  const [etag, setEtag] = useState(initialEtag);
  const [generatedAt, setGeneratedAt] = useState(initialGeneratedAt);
  const [rangeKey, setRangeKey] = useState<MonitorRange>(initialPayload.range.key);
  const [customRange, setCustomRange] = useState<{ since: string; until: string }>({
    since: initialPayload.range.since,
    until: initialPayload.range.until,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const refreshRequestRef = useRef(0);
  const refreshControllerRef = useRef<AbortController | null>(null);

  const surfaceFor = useCallback((
    nextRange: MonitorRange,
    nextCustomRange: { since: string; until: string },
  ) => {
    const suffix =
      nextRange === "custom"
        ? `custom:${nextCustomRange.since}:${nextCustomRange.until}`
        : nextRange;
    return `performance:${suffix}` as const;
  }, []);

  const refresh = useCallback(async (
    nextRange: MonitorRange = rangeKey,
    nextCustomRange: { since: string; until: string } = customRange,
    options: { manual?: boolean; cachedEtag?: string | null } = {},
  ) => {
    if (showExample) return;
    const requestId = refreshRequestRef.current + 1;
    refreshRequestRef.current = requestId;
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    setIsRefreshing(true);
    setError(null);

    try {
      const params = new URLSearchParams({ range: nextRange });

      if (nextRange === "custom") {
        params.set("since", nextCustomRange.since);
        params.set("until", nextCustomRange.until);
      }

      const response = await fetch(`/api/monitor-dashboard?${params.toString()}`, {
        method: options.manual ? "POST" : "GET",
        cache: "no-store",
        headers:
          !options.manual && (options.cachedEtag ?? etag)
            ? { "if-none-match": options.cachedEtag ?? etag }
            : undefined,
        signal: controller.signal,
      });

      if (response.status === 304) {
        if (requestId === refreshRequestRef.current) setIsRefreshing(false);
        return;
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;

        throw new Error(body?.error ?? `Refresh failed with ${response.status}.`);
      }

      const nextPayload = (await response.json()) as MetaMonitorPayload;
      const nextEtag = response.headers.get("etag") ?? etag;
      const nextGeneratedAt =
        response.headers.get("x-bw-snapshot-generated-at") ?? new Date().toISOString();
      if (requestId !== refreshRequestRef.current) return;
      if (!options.manual) {
        setPayload(nextPayload);
        setEtag(nextEtag);
        setGeneratedAt(nextGeneratedAt);
        await writeLocalReadModel({
          schemaVersion: READ_MODEL_SCHEMA_VERSION,
          userId,
          workspaceId,
          surface: surfaceFor(nextRange, nextCustomRange),
          etag: nextEtag,
          fetchedAt: nextGeneratedAt,
          data: nextPayload,
        });
        setIsRefreshing(false);
      } else {
        setIsRefreshing(false);
      }
    } catch (refreshError) {
      if (controller.signal.aborted || requestId !== refreshRequestRef.current) return;
      setError(refreshError instanceof Error ? refreshError.message : "Refresh failed.");
      setIsRefreshing(false);
    }
  }, [customRange, etag, rangeKey, showExample, surfaceFor, userId, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    if (showExample) {
      return () => {
        cancelled = true;
      };
    }
    const surface = surfaceFor(initialPayload.range.key, {
      since: initialPayload.range.since,
      until: initialPayload.range.until,
    });
    void (async () => {
      const cached = await readLocalReadModel<MetaMonitorPayload>({ userId, workspaceId, surface });
      if (
        !cancelled &&
        cached &&
        Date.parse(cached.fetchedAt) > Date.parse(initialGeneratedAt)
      ) {
        setPayload(cached.data);
        setEtag(cached.etag);
        setGeneratedAt(cached.fetchedAt);
      } else {
        await writeLocalReadModel({
          schemaVersion: READ_MODEL_SCHEMA_VERSION,
          userId,
          workspaceId,
          surface,
          etag: initialEtag,
          fetchedAt: initialGeneratedAt,
          data: initialPayload,
        });
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [initialEtag, initialGeneratedAt, initialPayload, showExample, surfaceFor, userId, workspaceId]);

  const handleInvalidation = useCallback(() => {
    if (!showExample) void refresh(rangeKey, customRange, { cachedEtag: etag });
  }, [customRange, etag, rangeKey, refresh, showExample]);
  useReportingInvalidation({ workspaceId, onInvalidate: handleInvalidation });

  async function handleRangeChange(nextRange: MonitorRange) {
    setRangeKey(nextRange);
    // The example report has no provider to ask: its own range is rebuilt from
    // the same sample builder the server used, so the control is honest there
    // too without a round trip.
    if (showExample) return;
    // A custom span has nothing to ask for until both its ends are chosen; the
    // date inputs drive that fetch.
    if (nextRange === "custom" && !(customRange.since && customRange.until)) return;
    const surface = surfaceFor(nextRange, customRange);
    const cached = await readLocalReadModel<MetaMonitorPayload>({ userId, workspaceId, surface }).catch(
      () => null,
    );
    if (cached) {
      setPayload(cached.data);
      setEtag(cached.etag);
      setGeneratedAt(cached.fetchedAt);
    }
    void refresh(nextRange, customRange, { cachedEtag: cached?.etag ?? null });
  }

  function handleCustomRangeChange(nextCustomRange: { since: string; until: string }) {
    setRangeKey("custom");
    setCustomRange(nextCustomRange);

    if (!showExample && nextCustomRange.since && nextCustomRange.until) {
      void refresh("custom", nextCustomRange, { cachedEtag: null });
    }
  }

  function scrollToAd(adId: string) {
    const card = document.getElementById(adCardDomId(adId));

    if (!card) {
      return;
    }

    const details = card.closest("details");
    if (details instanceof HTMLDetailsElement) details.open = true;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("ring-2", "ring-(--ink)", "ring-offset-2");
    window.setTimeout(() => card.classList.remove("ring-2", "ring-(--ink)", "ring-offset-2"), 1600);
  }

  const showDisconnectedState = !showExample && hasNoMetaConnection(payload);
  // The demo rebuilds locally for the chosen range; every other case renders
  // the snapshot the server sent.
  const examplePayload = useMemo(
    () =>
      showExample
        ? buildSampleMetaMonitorPayload({ range: rangeKey, customRange, now: new Date(), connected: false })
        : null,
    [showExample, rangeKey, customRange],
  );
  const displayPayload = showDisconnectedState
    ? { ...payload, summary: null, daily: [], suburbPerformance: [], ads: [], anglePerformance: [] }
    : (examplePayload ?? payload);
  const summary = displayPayload.summary;

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1120px] gap-3.5 px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
      <MetaMonitorHeader
        lastSyncedAt={summary?.lastSyncedAt ?? null}
        isRefreshing={isRefreshing}
        isSample={showExample && payload.source === "sample"}
        isConnected={Boolean(displayPayload.connected)}
        onRefresh={() => void refresh(rangeKey, customRange, { manual: true })}
      />

      {error ? (
        <p className="rounded-(--r-card) border border-error/25 bg-error-soft px-4 py-3 text-[13px] font-semibold text-error" role="alert">
          {error}
        </p>
      ) : null}

      {oauthNotice && !noticeDismissed ? (
        <div
          className={`flex flex-wrap items-center gap-2.5 rounded-(--r-card) border px-4 py-3 text-[13px] font-semibold ${noticeToneClass[oauthNotice.tone]}`}
          role="alert"
        >
          <span className="flex-1">{oauthNotice.message}</span>
          {oauthNotice.settingsLink ? (
            <Link href="/settings" className="underline underline-offset-2">
              Go to Settings
            </Link>
          ) : null}
          <button
            type="button"
            className="cursor-pointer opacity-70 transition-opacity hover:opacity-100"
            aria-label="Dismiss"
            onClick={() => setNoticeDismissed(true)}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}

      {showExample && hasNoMetaConnection(payload) && metaConnectHref ? (
        <DemoModeNotice metaConnectHref={metaConnectHref} />
      ) : null}

      {!summary ? (
        isRefreshing ? (
          <MonitorDashboardSkeleton />
        ) : (
          <EmptyMetaState issue={displayPayload.issue} connected={displayPayload.connected} metaConnectHref={metaConnectHref} />
        )
      ) : isRefreshing ? (
        <Dashboard
          payload={displayPayload}
          onSelectAd={scrollToAd}
          focusCampaignId={focusCampaignId}
          refreshing
          rangeKey={rangeKey}
          customRange={customRange}
          onRangeChange={handleRangeChange}
          onCustomRangeChange={handleCustomRangeChange}
        />
      ) : (
        <Dashboard
          payload={displayPayload}
          onSelectAd={scrollToAd}
          focusCampaignId={focusCampaignId}
          rangeKey={rangeKey}
          customRange={customRange}
          onRangeChange={handleRangeChange}
          onCustomRangeChange={handleCustomRangeChange}
        />
      )}
    </div>
  );
}

function Dashboard({
  payload,
  onSelectAd,
  focusCampaignId,
  refreshing = false,
  rangeKey,
  customRange,
  onRangeChange,
  onCustomRangeChange,
}: {
  payload: MetaMonitorPayload;
  onSelectAd: (adId: string) => void;
  focusCampaignId?: string | null;
  refreshing?: boolean;
  rangeKey: MonitorRange;
  customRange: { since: string; until: string };
  onRangeChange: (range: MonitorRange) => void;
  onCustomRangeChange: (range: { since: string; until: string }) => void;
}) {
  const copy = niche.copy.performance;
  const summary = payload.summary!;
  const previous = summary.previousPeriod;
  const hierarchy = useMemo(() => buildResultsHierarchy(payload.ads), [payload.ads]);
  const ctr = safeRate(summary.clicks, summary.impressions);
  const previousCtr = previous ? safeRate(previous.clicks, previous.impressions) : null;
  const days = payload.range.days;
  const compareLabel = `previous ${days} day${days === 1 ? "" : "s"}`;
  const focusedCampaignVisible = Boolean(focusCampaignId && hierarchy.some((campaign) => campaign.campaignId === focusCampaignId));
  const [chartMetric, setChartMetric] = useState<ChartMetric>("spend");
  const chartConfig = {
    spend: { title: copy.charts.spend, data: payload.daily.map((point) => ({ date: point.date, value: point.spend })), format: (value: number) => formatCurrency(value) },
    leads: { title: copy.charts.leads, data: payload.daily.map((point) => ({ date: point.date, value: point.validLeads })), format: (value: number) => String(Math.round(value)) },
    cpl: { title: copy.charts.cpl, data: payload.daily.map((point) => ({ date: point.date, value: point.validCpl })), format: (value: number) => formatCurrency(value) },
  }[chartMetric];
  const rangeOptions: Array<{ value: MonitorRange; label: string }> = [
    { value: "today", label: copy.ranges.d1 },
    { value: "last_7", label: copy.ranges.d7 },
    { value: "last_30", label: copy.ranges.d30 },
    { value: "custom", label: copy.customRange },
  ];
  const spendSeries = payload.daily.map((point) => point.spend);
  const leadSeries = payload.daily.map((point) => point.leads);
  const clickSeries = payload.daily.map((point) => point.clicks);
  const activeAds = payload.ads.filter((ad) => ad.status === "ACTIVE").length;
  return (
    <div
      className={`grid min-w-0 gap-3.5 transition-opacity duration-250 motion-reduce:transition-none ${
        refreshing ? "opacity-55" : ""
      }`}
      // `inert` keeps keyboard focus out of the stale subtree while refreshing,
      // which pointer-events alone does not.
      inert={refreshing || undefined}
      aria-busy={refreshing || undefined}
    >
      {focusCampaignId ? (
        <p className="rounded-(--r-card) border border-(--line) bg-(--surface) px-4 py-3 text-[13px] font-semibold" role="status">
          {focusedCampaignVisible
            ? "Showing the ad created from your publish plan."
            : "This ad is active. Its details will appear here after reporting refreshes."}
        </p>
      ) : null}
      <dl className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2.5 sm:gap-3.5">
        <MetricCard
          compact
          hideCompareOnPhone
          label="Enquiries"
          value={summary.leads}
          format={wholeNumber}
          series={leadSeries}
          change={changeBetween(summary.leads, previous?.leads ?? null)}
          compareLabel={compareLabel}
          spokenChange={spokenChange(summary.leads, previous?.leads ?? null, days)}
        />
        <MetricCard
          compact
          hideCompareOnPhone
          label="Spend"
          value={summary.spend}
          format={formatCurrency}
          series={spendSeries}
          change={changeBetween(summary.spend, previous?.spend ?? null)}
          compareLabel={compareLabel}
          spokenChange={spokenChange(summary.spend, previous?.spend ?? null, days)}
        />
        <MetricCard compact label="Running ads" value={activeAds} format={wholeNumber} />
      </dl>

      <section className={panelClass}>
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <Select value={chartMetric} onValueChange={(value) => setChartMetric(value as ChartMetric)}>
            <SelectTrigger
              aria-label={copy.chartMetricLabel}
              className="h-9 w-fit cursor-pointer rounded-full border-(--line-heavy) bg-(--surface) px-3.5 font-display text-[13.5px] font-extrabold text-foreground shadow-none"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHART_METRICS.map((metric) => (
                <SelectItem key={metric} value={metric} className="text-[13px] font-semibold">
                  {copy.charts[metric]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Select value={rangeKey} onValueChange={(value) => onRangeChange(value as MonitorRange)}>
              <SelectTrigger
                aria-label={copy.rangeLabel}
                className="h-9 w-fit cursor-pointer rounded-full border-(--line) bg-(--surface) px-3.5 text-[12.5px] font-bold text-foreground shadow-none"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rangeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-[13px] font-semibold">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {rangeKey === "custom" ? (
              <div
                className="inline-flex items-center gap-1.5 rounded-full border border-(--line) bg-(--surface-subtle) px-2.5 py-1 text-muted-foreground"
                role="group"
                aria-label={copy.customRange}
              >
                <input
                  type="date"
                  aria-label={copy.customFromLabel}
                  className="h-[30px] min-w-0 border-0 bg-transparent text-[12.5px] font-semibold text-(--ink) outline-none"
                  value={customRange.since}
                  max={customRange.until || undefined}
                  onChange={(event) => onCustomRangeChange({ ...customRange, since: event.target.value })}
                />
                <span aria-hidden>–</span>
                <input
                  type="date"
                  aria-label={copy.customToLabel}
                  className="h-[30px] min-w-0 border-0 bg-transparent text-[12.5px] font-semibold text-(--ink) outline-none"
                  value={customRange.until}
                  min={customRange.since || undefined}
                  onChange={(event) => onCustomRangeChange({ ...customRange, until: event.target.value })}
                />
              </div>
            ) : null}
          </div>
        </div>
        {chartMetric === "cpl" ? <p className="mt-2.5 text-[11.5px] text-(--faint)">{copy.cplGapNote}</p> : null}
        <div className="mt-3">
          {payload.daily.length > 1 ? (
            <SmoothAreaChart id={chartMetric} label={chartConfig.title} color={DATA_HUE} data={chartConfig.data} valueFormatter={chartConfig.format} />
          ) : (
            // One day is a figure, not a trend: an empty axis would read as a
            // broken chart rather than a short range.
            <p className="rounded-(--r-card) border border-dashed border-(--line-heavy) px-4 py-6 text-center text-[12.5px] text-muted-foreground">
              {copy.singleDayNote}
            </p>
          )}
        </div>
      </section>
      <details className={panelClass}>
        <summary className="cursor-pointer text-[13px] font-bold">{copy.moreDetails}</summary>
        <div className="mt-4 grid gap-3.5">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-3.5">
            <MetricCard
              label="Reach"
              value={summary.reach}
              format={wholeNumber}
              change={changeBetween(summary.reach, previous?.reach ?? null)}
              compareLabel={compareLabel}
              spokenChange={spokenChange(summary.reach, previous?.reach ?? null, days)}
            />
            <MetricCard
              label="Impressions"
              value={summary.impressions}
              format={wholeNumber}
              change={changeBetween(summary.impressions, previous?.impressions ?? null)}
              compareLabel={compareLabel}
              spokenChange={spokenChange(summary.impressions, previous?.impressions ?? null, days)}
            />
            <MetricCard
              label="Link clicks"
              value={summary.clicks}
              format={wholeNumber}
              series={clickSeries}
              change={changeBetween(summary.clicks, previous?.clicks ?? null)}
              compareLabel={compareLabel}
              spokenChange={spokenChange(summary.clicks, previous?.clicks ?? null, days)}
            />
            <MetricCard
              label="CTR"
              value={ctr}
              format={(value) => formatPercent(value, 2)}
              change={changeBetween(ctr ?? 0, previousCtr)}
              compareLabel={compareLabel}
              spokenChange={spokenChange(ctr ?? 0, previousCtr, days)}
            />
          </dl>

          <div className="grid gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            {payload.suburbPerformance.length > 0 ? (
              <section className="min-w-0">
                <h3 className={panelTitleClass}>{copy.areaBreakdown.title}</h3>
                <div className="mt-4">
                  <SuburbBarChart rows={payload.suburbPerformance} />
                </div>
              </section>
            ) : null}
            <section className="min-w-0">
              <h3 className={panelTitleClass}>{copy.budgetPacing}</h3>
              <div className="mt-4">
                <BudgetPacingChart
                  daily={payload.daily}
                  budget={summary.budget}
                  spend={summary.spend}
                  range={payload.range}
                />
              </div>
            </section>
          </div>

          {(payload.anglePerformance?.length ?? 0) > 0 ? <AnglePerformanceTable rows={payload.anglePerformance ?? []} /> : null}
        </div>
      </details>

      {payload.ads.length > 0 ? (
        <>
          <CampaignManagementTable rows={hierarchy} onSelectAd={onSelectAd} focusCampaignId={focusCampaignId} />
          <details className={panelClass} open>
            <summary className="cursor-pointer text-[13px] font-bold">{copy.adDetails}</summary>
            <div className="mt-3 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
              {payload.ads.map((ad) => <AdPerformanceCard key={ad.adId} ad={ad} />)}
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}



function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mt-2">
      <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em]">{title}</h2>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function CampaignManagementTable({
  rows,
  onSelectAd,
  focusCampaignId,
}: {
  rows: ResultsCampaignRow[];
  onSelectAd: (adId: string) => void;
  focusCampaignId?: string | null;
}) {
  // The page opens on the campaign the customer is working on, or the first
  // one, rather than on a table of closed rows.
  const [openRows, setOpenRows] = useState<Set<string>>(() => {
    const open = rows.find((row) => row.campaignId === focusCampaignId) ?? rows[0];
    return new Set(open ? [open.id] : []);
  });
  const focusedCampaignRef = useRef<string | null>(null);

  useEffect(() => {
    if (!focusCampaignId || focusedCampaignRef.current === focusCampaignId) return;
    const row = document.getElementById(campaignRowDomId(focusCampaignId));
    if (!row) return;
    focusedCampaignRef.current = focusCampaignId;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.focus({ preventScroll: true });
  }, [focusCampaignId, rows]);

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
    <details className={panelClass} open>
      <summary className="cursor-pointer text-[13px] font-bold">Manage campaigns and budgets</summary>
      <div className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeading
          title="Campaigns"
          subtitle="Pausing ads or changing daily spend asks for approval and shows the effect before it is sent to Meta."
        />
        <div className="flex flex-wrap items-center gap-1.5 pt-1" aria-label="Row labels">
          <OriginTag managed />
          <OriginTag managed={false} />
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10.5px] font-bold text-warning">Fatigue</span>
        </div>
      </div>
      <div className="mt-4 -mx-5 overflow-x-auto px-5">
        <Table className="min-w-[820px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={thClass}>Campaign / ad set / ad</TableHead>
              <TableHead className={thClass}>Status</TableHead>
              <TableHead className={thClass}>Daily budget</TableHead>
              <TableHead className={`${thClass} text-right`}>Spend</TableHead>
              <TableHead className={`${thClass} text-right`}>Leads</TableHead>
              <TableHead className={`${thClass} text-right`}>Valid</TableHead>
              <TableHead className={`${thClass} text-right`}>Cost per lead</TableHead>
              <TableHead className={thClass}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((campaign) => {
              const campaignOpen = openRows.has(campaign.id);
              return (
                <Fragment key={campaign.id}>
                  <TableRow
                    id={campaignRowDomId(campaign.campaignId)}
                    tabIndex={campaign.campaignId === focusCampaignId ? -1 : undefined}
                    className={`border-t-2 border-t-(--line-heavy) focus:outline-none ${campaign.campaignId === focusCampaignId ? "bg-primary/5 ring-2 ring-inset ring-primary/40" : ""}`}
                  >
                    <NameCell
                      depth={0}
                      label={campaign.name}
                      open={campaignOpen}
                      onToggle={() => toggle(campaign.id)}
                      managedByBlockwise={campaign.managedByBlockwise}
                      fatigued={campaign.fatigued}
                    />
                    <StatusCell status={campaign.status} />
                    <TableCell className="text-[11.5px] text-(--faint)">-</TableCell>
                    <MetricCells metrics={campaign.metrics} />
                    <TableCell>
                      <AdManagementControls
                        target={{ kind: "campaign", campaignId: campaign.campaignId }}
                        status={campaign.status}
                        disabledReason={campaign.campaignId ? undefined : "Missing Meta id"}
                      />
                    </TableCell>
                  </TableRow>
                  {campaignOpen
                    ? campaign.adSets.map((adSet) => (
                        <Fragment key={adSet.id}>
                          <TableRow className="bg-(--surface-subtle)/60">
                            <NameCell
                              depth={1}
                              label={adSet.name}
                              managedByBlockwise={adSet.managedByBlockwise}
                              fatigued={adSet.fatigued}
                            />
                            <StatusCell status={adSet.status} />
                            <TableCell>
                              <BudgetManagementControl
                                adSetId={adSet.adsetId}
                                dailyBudgetDollars={adSet.dailyBudgetDollars}
                                disabledReason={adSet.dailyBudgetDollars == null ? "Unavailable" : undefined}
                              />
                            </TableCell>
                            <MetricCells metrics={adSet.metrics} />
                            <TableCell>
                              <AdManagementControls
                                target={{ kind: "adset", adSetId: adSet.adsetId }}
                                status={adSet.status}
                                disabledReason={adSet.adsetId ? undefined : "Missing Meta id"}
                              />
                            </TableCell>
                          </TableRow>
                          {adSet.ads.map((ad) => (
                            <TableRow key={ad.id}>
                              <TableCell>
                                <div className="flex items-center gap-2.5 pl-10">
                                  <TableCreativePreview ad={ad.ad} />
                                  <button
                                    type="button"
                                    className="cursor-pointer text-left text-[12.5px] font-semibold underline-offset-2 hover:underline"
                                    onClick={() => onSelectAd(ad.id)}
                                  >
                                    {ad.name}
                                  </button>
                                  {ad.fatigued ? (
                                    <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10.5px] font-bold text-warning">
                                      Fatigue
                                    </span>
                                  ) : null}
                                </div>
                              </TableCell>
                              <StatusCell status={ad.status} />
                              <TableCell className="text-[11.5px] text-(--faint)">-</TableCell>
                              <MetricCells metrics={ad.metrics} />
                              <TableCell>
                                <AdManagementControls
                                  target={{ kind: "ad", adId: ad.id }}
                                  status={ad.status}
                                  showExport
                                  disabledReason={ad.id ? undefined : "Missing Meta id"}
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </Fragment>
                      ))
                    : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      </div>
    </details>
  );
}

function campaignRowDomId(campaignId: string): string {
  return `meta-campaign-${campaignId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function TableCreativePreview({ ad }: { ad: ResultsCampaignRow["adSets"][number]["ads"][number]["ad"] }) {
  const src = ad.creative.thumbnailUrl ?? ad.creative.imageUrl ?? ad.creative.videoThumbnailUrl;
  const mediaLabel = ad.creative.type === "VIDEO" ? "Video preview" : "Image preview";

  if (!src) {
    return (
      <span
        className="grid size-9 shrink-0 place-items-center rounded-lg border border-dashed border-(--line-heavy) bg-(--surface-subtle) text-(--faint)"
        aria-label="No creative preview"
      >
        <ImageOff size={14} aria-hidden />
      </span>
    );
  }

  return (
    <span className="relative block size-9 shrink-0 overflow-hidden rounded-lg bg-(--surface-subtle)">
      {/* Meta CDN thumbnails are short-lived signed URLs; next/image optimization would break them. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`${ad.adName} ${mediaLabel.toLowerCase()}`} width={36} height={36} loading="lazy" className="h-full w-full object-cover" />
      {ad.creative.type === "VIDEO" ? (
        <span
          className="absolute right-0.5 bottom-0.5 grid size-4 place-items-center rounded-full bg-(--ink)/75 text-white"
          aria-label={mediaLabel}
        >
          <Play size={8} aria-hidden />
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
    <TableCell>
      <div className={`flex min-w-0 items-center gap-2 ${depth === 1 ? "pl-6" : ""}`}>
        {onToggle ? (
          <button
            type="button"
            className="flex min-w-0 cursor-pointer items-center gap-1 text-left text-[13px] font-bold underline-offset-2 hover:underline"
            aria-expanded={open}
            onClick={onToggle}
          >
            {open ? <ChevronDown aria-hidden size={14} className="shrink-0" /> : <ChevronRight aria-hidden size={14} className="shrink-0" />}
            <span className="truncate">{label}</span>
          </button>
        ) : (
          <span className="truncate text-[12.5px] font-semibold">{label}</span>
        )}
        <OriginTag managed={managedByBlockwise} />
        {fatigued ? (
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10.5px] font-bold text-warning">Fatigue</span>
        ) : null}
      </div>
    </TableCell>
  );
}

function MetricCells({ metrics }: { metrics: ResultsCampaignRow["metrics"] }) {
  return (
    <>
      <TableCell className="text-right font-bold tabular-nums">{formatCurrency(metrics.spend)}</TableCell>
      <TableCell className="text-right tabular-nums">{metrics.leads.toLocaleString("en-AU")}</TableCell>
      <TableCell className="text-right font-bold tabular-nums">{metrics.validLeads.toLocaleString("en-AU")}</TableCell>
      <TableCell className="text-right tabular-nums">
        {metrics.validCpl != null ? formatCurrency(metrics.validCpl) : "-"}
      </TableCell>
    </>
  );
}

function StatusCell({ status }: { status: ResultsHierarchyStatus }) {
  const tone =
    status === "ACTIVE"
      ? "bg-success-soft text-success"
      : status === "PAUSED"
        ? "bg-warning-soft text-warning"
        : "bg-(--surface-subtle) text-muted-foreground";

  return (
    <TableCell>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold ${tone}`}>
        {statusLabel(status)}
      </span>
    </TableCell>
  );
}

function OriginTag({ managed }: { managed: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
        managed ? "bg-(--accent-tint) text-foreground" : "bg-(--surface-subtle) text-muted-foreground"
      }`}
    >
      {managed ? "Blockwise" : "In Meta"}
    </span>
  );
}

function statusLabel(status: ResultsHierarchyStatus): string {
  if (status === "MIXED") return "Mixed";
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function AnglePerformanceTable({ rows }: { rows: AnglePerformance[] }) {
  return (
    <section className={panelClass}>
      <h3 className={panelTitleClass}>Angle performance</h3>
      <p className="mt-0.5 text-[11.5px] text-(--faint)">
        Built from Ads variant tags in ad names. Ads published outside Ad Studio group under &quot;Untagged&quot;.
      </p>
      <div className="mt-4 -mx-5 overflow-x-auto px-5">
        <Table className="min-w-[680px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={thClass}>Angle</TableHead>
              <TableHead className={thClass}>Template</TableHead>
              <TableHead className={`${thClass} text-right`}>Ads</TableHead>
              <TableHead className={`${thClass} text-right`}>Spend</TableHead>
              <TableHead className={`${thClass} text-right`}>CTR</TableHead>
              <TableHead className={`${thClass} text-right`}>Leads</TableHead>
              <TableHead className={`${thClass} text-right`}>Valid leads</TableHead>
              <TableHead className={`${thClass} text-right`}>Valid cost per lead</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.angle}-${row.template ?? ""}`}>
                <TableCell className="font-bold">{row.angle}</TableCell>
                <TableCell className="text-[12.5px]">{row.template ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{row.ads}</TableCell>
                <TableCell className="text-right font-bold tabular-nums">{formatCurrency(row.spend)}</TableCell>
                <TableCell className="text-right tabular-nums">{row.ctr != null ? formatPercent(row.ctr, 2) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{row.leads}</TableCell>
                <TableCell className="text-right font-bold tabular-nums">{row.validLeads}</TableCell>
                <TableCell className="text-right font-bold tabular-nums">
                  {row.validCpl != null ? formatCurrency(row.validCpl) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
