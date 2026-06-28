import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReactNode } from "react";

import { calculateTrend, formatCurrency, formatPercent, safeRate } from "@/lib/meta-monitor/calculations";
import type { MetaDailyPoint, MetaMonitorSummary } from "@/lib/meta-monitor/types";

import { formatDayTick, tooltipStyle } from "./SmoothAreaChart";

type ChartPoint = {
  date: string;
  reach: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  leads: number;
  spend: number;
};

type MetricSummary = {
  label: string;
  value: string;
  trend: number | null;
  goodWhenDown?: boolean;
};

const REACH_COLOR = "var(--accent)";
const IMPRESSIONS_COLOR = "var(--green)";
const CLICKS_COLOR = "var(--blue)";
const CTR_COLOR = "var(--rose)";
const LEADS_COLOR = "var(--green)";
const SPEND_COLOR = "var(--accent)";

const compactNumber = new Intl.NumberFormat("en-AU", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function PerformanceOverviewCharts({
  daily,
  summary,
  rangeLabel,
  compareText,
}: {
  daily: MetaDailyPoint[];
  summary: MetaMonitorSummary;
  rangeLabel: string;
  compareText?: string;
}) {
  const previous = summary.previousPeriod;
  const ctr = safeRate(summary.clicks, summary.impressions);
  const previousCtr = previous ? safeRate(previous.clicks, previous.impressions) : null;
  const chartData = daily.map((point): ChartPoint => {
    const impressions = point.impressions ?? 0;
    const clicks = point.clicks ?? 0;

    return {
      date: point.date,
      reach: point.reach ?? 0,
      impressions,
      clicks,
      ctr: point.ctr ?? safeRate(clicks, impressions),
      leads: point.leads,
      spend: point.spend,
    };
  });

  return (
    <section className="mm-performance-overview" aria-labelledby="mm-performance-overview-title">
      <div className="mm-section-heading mm-performance-heading">
        <div>
          <h2 id="mm-performance-overview-title">Performance overview</h2>
          <p>{rangeLabel}</p>
        </div>
      </div>
      <div className="mm-performance-grid">
        <PerformancePanel
          className="mm-performance-card-primary"
          title="Reach + impressions"
          note="Audience size and delivery volume"
          metrics={[
            {
              label: "Reach",
              value: summary.reach.toLocaleString("en-AU"),
              trend: previous ? calculateTrend(summary.reach, previous.reach) : null,
            },
            {
              label: "Impressions",
              value: summary.impressions.toLocaleString("en-AU"),
              trend: previous ? calculateTrend(summary.impressions, previous.impressions) : null,
            },
          ]}
          compareText={compareText}
        >
          <VolumeChart data={chartData} />
        </PerformancePanel>

        <PerformancePanel
          title="Clicks + CTR"
          note="Traffic response and click-through rate"
          metrics={[
            {
              label: "Link clicks",
              value: summary.clicks.toLocaleString("en-AU"),
              trend: previous ? calculateTrend(summary.clicks, previous.clicks) : null,
            },
            {
              label: "CTR",
              value: ctr != null ? formatPercent(ctr, 2) : "Unavailable",
              trend: previous ? calculateTrend(ctr, previousCtr) : null,
            },
          ]}
          compareText={compareText}
        >
          <ClicksCtrChart data={chartData} />
        </PerformancePanel>

        <PerformancePanel
          title="Leads + spend"
          note="Lead volume against media spend"
          metrics={[
            {
              label: "Leads",
              value: summary.leads.toLocaleString("en-AU"),
              trend: previous ? calculateTrend(summary.leads, previous.leads) : null,
            },
            {
              label: "Spend",
              value: formatCurrency(summary.spend),
              trend: previous ? calculateTrend(summary.spend, previous.spend) : null,
            },
          ]}
          compareText={compareText}
        >
          <LeadsSpendChart data={chartData} />
        </PerformancePanel>
      </div>
    </section>
  );
}

function PerformancePanel({
  className = "",
  title,
  note,
  metrics,
  compareText,
  children,
}: {
  className?: string;
  title: string;
  note: string;
  metrics: MetricSummary[];
  compareText?: string;
  children: ReactNode;
}) {
  return (
    <article className={`panel mm-performance-card ${className}`.trim()}>
      <header className="mm-performance-card-head">
        <div>
          <h3>{title}</h3>
          <p>{note}</p>
        </div>
        {compareText ? <span>{compareText}</span> : null}
      </header>
      <dl className="mm-performance-metrics">
        {metrics.map((metric) => (
          <div className="mm-performance-metric" key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
            <TrendBadge trend={metric.trend} goodWhenDown={metric.goodWhenDown} />
          </div>
        ))}
      </dl>
      <div className="mm-performance-chart">{children}</div>
    </article>
  );
}

function TrendBadge({ trend, goodWhenDown = false }: { trend: number | null; goodWhenDown?: boolean }) {
  if (trend == null) {
    return null;
  }

  const isGood = goodWhenDown ? trend <= 0 : trend >= 0;

  return (
    <span className={`mm-performance-trend ${isGood ? "good" : "bad"}`}>
      {formatSignedPercent(trend)}
    </span>
  );
}

function VolumeChart({ data }: { data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={232}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
        <CartesianGrid vertical={false} stroke="var(--line-soft)" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDayTick}
          tick={{ fontSize: 10, fill: "var(--faint)" }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={36}
        />
        <YAxis
          yAxisId="reach"
          width={42}
          tick={{ fontSize: 10, fill: "var(--faint)" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatCompact}
        />
        <YAxis
          yAxisId="impressions"
          orientation="right"
          width={42}
          tick={{ fontSize: 10, fill: "var(--faint)" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatCompact}
        />
        <Tooltip
          cursor={{ stroke: "var(--line)", strokeWidth: 1 }}
          contentStyle={tooltipStyle}
          labelFormatter={(label) => formatDayTick(String(label))}
          formatter={volumeTooltipFormatter}
        />
        <Line
          yAxisId="reach"
          type="monotone"
          dataKey="reach"
          name="Reach"
          stroke={REACH_COLOR}
          strokeWidth={2.6}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
        <Line
          yAxisId="impressions"
          type="monotone"
          dataKey="impressions"
          name="Impressions"
          stroke={IMPRESSIONS_COLOR}
          strokeWidth={2.1}
          strokeDasharray="5 5"
          dot={false}
          activeDot={{ r: 3.5 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function ClicksCtrChart({ data }: { data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={206}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
        <CartesianGrid vertical={false} stroke="var(--line-soft)" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDayTick}
          tick={{ fontSize: 10, fill: "var(--faint)" }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={36}
        />
        <YAxis
          yAxisId="clicks"
          width={42}
          tick={{ fontSize: 10, fill: "var(--faint)" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatCompact}
        />
        <YAxis
          yAxisId="ctr"
          orientation="right"
          width={40}
          tick={{ fontSize: 10, fill: "var(--faint)" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => formatPercent(value, 1)}
        />
        <Tooltip
          cursor={{ fill: "rgba(16, 18, 23, 0.04)" }}
          contentStyle={tooltipStyle}
          labelFormatter={(label) => formatDayTick(String(label))}
          formatter={clicksTooltipFormatter}
        />
        <Bar
          yAxisId="clicks"
          dataKey="clicks"
          name="Link clicks"
          fill="var(--accent-tint)"
          stroke={CLICKS_COLOR}
          strokeOpacity={0.22}
          radius={[5, 5, 0, 0]}
          isAnimationActive={false}
        />
        <Line
          yAxisId="ctr"
          type="monotone"
          dataKey="ctr"
          name="CTR"
          stroke={CTR_COLOR}
          strokeWidth={2.3}
          dot={false}
          activeDot={{ r: 3.5 }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function LeadsSpendChart({ data }: { data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={206}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
        <defs>
          <linearGradient id="mm-performance-spend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SPEND_COLOR} stopOpacity={0.16} />
            <stop offset="100%" stopColor={SPEND_COLOR} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--line-soft)" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDayTick}
          tick={{ fontSize: 10, fill: "var(--faint)" }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={36}
        />
        <YAxis
          yAxisId="leads"
          width={32}
          tick={{ fontSize: 10, fill: "var(--faint)" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="spend"
          orientation="right"
          width={42}
          tick={{ fontSize: 10, fill: "var(--faint)" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => formatCurrency(value)}
        />
        <Tooltip
          cursor={{ stroke: "var(--line)", strokeWidth: 1 }}
          contentStyle={tooltipStyle}
          labelFormatter={(label) => formatDayTick(String(label))}
          formatter={leadsTooltipFormatter}
        />
        <Area
          yAxisId="spend"
          type="monotone"
          dataKey="spend"
          name="Spend"
          stroke={SPEND_COLOR}
          strokeWidth={2}
          fill="url(#mm-performance-spend)"
          dot={false}
          activeDot={{ r: 3.5 }}
          isAnimationActive={false}
        />
        <Line
          yAxisId="leads"
          type="monotone"
          dataKey="leads"
          name="Leads"
          stroke={LEADS_COLOR}
          strokeWidth={2.4}
          dot={false}
          activeDot={{ r: 3.5 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function volumeTooltipFormatter(value: unknown, name: unknown) {
  return [typeof value === "number" ? value.toLocaleString("en-AU") : "-", String(name)];
}

function clicksTooltipFormatter(value: unknown, name: unknown) {
  if (name === "CTR") {
    return [typeof value === "number" ? formatPercent(value, 2) : "-", "CTR"];
  }

  return [typeof value === "number" ? value.toLocaleString("en-AU") : "-", String(name)];
}

function leadsTooltipFormatter(value: unknown, name: unknown) {
  if (name === "Spend") {
    return [typeof value === "number" ? formatCurrency(value) : "-", "Spend"];
  }

  return [typeof value === "number" ? value.toLocaleString("en-AU") : "-", String(name)];
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return compactNumber.format(value);
}

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";

  return `${sign}${formatPercent(Math.abs(value), 1)}`;
}
