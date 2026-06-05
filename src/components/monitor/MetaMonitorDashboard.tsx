"use client";

import { BadgePercent, MousePointerClick, Tag, UserCheck, UserPlus, Wallet } from "lucide-react";
import { useState } from "react";

import { calculateTrend, formatCurrency, formatPercent, safeCpl, safeRate } from "@/lib/meta-monitor/calculations";
import type { MetaMonitorPayload, MonitorRange } from "@/lib/meta-monitor/types";

import { AdPerformanceCard, adCardDomId } from "./AdPerformanceCard";
import { AdsSummaryTable } from "./AdsSummaryTable";
import { BudgetPacingChart } from "./BudgetPacingChart";
import { EmptyMetaState } from "./EmptyMetaState";
import { MetaKpiCard } from "./MetaKpiCard";
import { MetaMonitorHeader } from "./MetaMonitorHeader";
import { SmoothAreaChart } from "./SmoothAreaChart";
import { SuburbBarChart } from "./SuburbBarChart";

const SPEND_COLOR = "#123e75";
const LEADS_COLOR = "#31c46f";

export function MetaMonitorDashboard({ initialPayload }: { initialPayload: MetaMonitorPayload }) {
  const [payload, setPayload] = useState(initialPayload);
  const [rangeKey, setRangeKey] = useState<MonitorRange>(initialPayload.range.key);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      {!summary ? (
        <EmptyMetaState issue={payload.issue} connected={payload.connected} />
      ) : (
        <Dashboard payload={payload} onSelectAd={scrollToAd} />
      )}
    </div>
  );
}

function Dashboard({ payload, onSelectAd }: { payload: MetaMonitorPayload; onSelectAd: (adId: string) => void }) {
  const summary = payload.summary!;
  const previous = summary.previousPeriod;
  const validLeadRate = safeRate(summary.validLeads, summary.leads);
  const validCpl = safeCpl(summary.spend, summary.validLeads);
  const budgetRemaining = summary.budget != null ? Math.max(summary.budget - summary.spend, 0) : null;
  const compare = previous ? `vs previous ${payload.range.days} day${payload.range.days === 1 ? "" : "s"}` : undefined;

  return (
    <>
      <div className="mm-kpi-grid">
        <MetaKpiCard
          icon={Wallet}
          iconTone="blue"
          label="Spend"
          value={formatCurrency(summary.spend)}
          compareText={compare}
          trend={previous ? calculateTrend(summary.spend, previous.spend) : null}
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
          icon={UserCheck}
          iconTone="purple"
          label="Valid leads"
          value={summary.validLeads.toLocaleString("en-AU")}
          compareText={compare}
          trend={previous ? calculateTrend(summary.validLeads, previous.validLeads) : null}
        />
        <MetaKpiCard
          icon={BadgePercent}
          iconTone="orange"
          label="Valid lead rate"
          value={validLeadRate != null ? formatPercent(validLeadRate, 1) : "Unavailable"}
          compareText={compare}
          trend={previous ? calculateTrend(validLeadRate, previous.validLeadRate) : null}
        />
        <MetaKpiCard
          icon={Tag}
          iconTone="rose"
          label="Valid CPL"
          value={validCpl != null ? formatCurrency(validCpl) : "Unavailable"}
          compareText={compare}
          trend={previous ? calculateTrend(validCpl, previous.validCpl) : null}
          goodWhenDown
        />
        <MetaKpiCard
          icon={MousePointerClick}
          iconTone="indigo"
          label="Budget remaining"
          value={budgetRemaining != null ? formatCurrency(budgetRemaining) : "Not set"}
          compareText={summary.budget != null ? `of ${formatCurrency(summary.budget)}` : "Set META_MONITOR_BUDGET_AUD"}
          progress={summary.budget != null && summary.budget > 0 ? summary.spend / summary.budget : undefined}
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

      <div className="mm-chart-grid two">
        <section className="panel mm-chart-panel">
          <h3>Valid leads by suburb</h3>
          <SuburbBarChart rows={payload.suburbPerformance} />
        </section>
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

      {payload.ads.length > 0 ? (
        <>
          <AdsSummaryTable ads={payload.ads} onSelectAd={onSelectAd} />
          <h3 className="mm-section-title">Ad performance details</h3>
          <div className="mm-ad-grid">
            {payload.ads.map((ad) => (
              <AdPerformanceCard key={ad.adId} ad={ad} />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
