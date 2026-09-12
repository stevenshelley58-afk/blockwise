"use client";

/*
 * The four figures Results leads with, in the same shared card row Home shows:
 * spend, link clicks, cost per link click and leads, each with its own line and
 * its own comparison against the period before. Everything else the page
 * reports lives inside "More reporting details".
 *
 * The heading names the window the payload actually covers rather than the
 * range the customer just picked: while a new range is being fetched the
 * figures on screen are still the old window's, and a heading that moved first
 * would mislabel every one of them.
 */

import {
  changeBetween,
  formatCount,
  formatMoney,
  MetricCard,
  spokenPeriodChange,
  type MetricChange,
} from "@/components/ui/metric-card";
import { niche } from "@/config/niche";
import type { MetaDailyPoint, MetaMonitorSummary, MonitorDateRange } from "@/lib/meta-monitor/types";

type Figure = {
  key: "spend" | "clicks" | "cpc" | "leads";
  label: string;
  /** The period's figure, or null when it cannot be reported honestly. */
  value: number | null;
  format: (value: number) => string;
  /** One point per day of the period; fewer than two draws no line. */
  series: number[];
  change: MetricChange | null;
};

export function PerformanceFigureRow({
  summary,
  range,
  daily,
}: {
  summary: MetaMonitorSummary;
  range: MonitorDateRange;
  daily: MetaDailyPoint[];
}) {
  const copy = niche.copy.performance;
  const previous = summary.previousPeriod;
  const days = range.days;
  const compareLabel = compareTail(range);
  // The figures are the days the payload covers, summed exactly as their lines
  // are drawn: a card whose number came from somewhere else than its own line
  // could tell two stories about one period. Home's figure row sums the same
  // way, so both surfaces print the same week for the same workspace.
  const totalSpend = round2(daily.reduce((total, point) => total + point.spend, 0));
  const totalClicks = daily.reduce((total, point) => total + point.clicks, 0);
  const totalLeads = daily.reduce((total, point) => total + point.leads, 0);
  // A day with no link clicks has no cost per click to plot, so those days are
  // left out of that line; the printed figure is the period's own spend over
  // its own clicks, so the line only ever shapes days it could measure.
  const cpcSeries = daily.filter((point) => point.clicks > 0).map((point) => point.spend / point.clicks);
  const cpc = totalClicks > 0 ? totalSpend / totalClicks : null;
  const previousCpc = previous && previous.clicks > 0 ? previous.spend / previous.clicks : null;
  const figures: Figure[] = [
    {
      key: "spend",
      label: copy.figureLabels.spend,
      value: totalSpend,
      format: formatMoney,
      series: daily.map((point) => point.spend),
      change: changeBetween(totalSpend, previous?.spend ?? null),
    },
    {
      key: "clicks",
      label: copy.figureLabels.clicks,
      value: totalClicks,
      format: formatCount,
      series: daily.map((point) => point.clicks),
      change: changeBetween(totalClicks, previous?.clicks ?? null),
    },
    {
      key: "cpc",
      label: copy.figureLabels.cpc,
      value: cpc,
      format: formatMoney,
      series: cpcSeries,
      change: cpc == null ? null : changeBetween(cpc, previousCpc),
    },
    {
      key: "leads",
      label: copy.figureLabels.leads,
      value: totalLeads,
      format: formatCount,
      series: daily.map((point) => point.leads),
      change: changeBetween(totalLeads, previous?.leads ?? null),
    },
  ];

  return (
    <section aria-labelledby="results-figures-heading">
      <h2
        id="results-figures-heading"
        className="font-display text-[15.5px] font-extrabold tracking-[-0.015em] text-foreground"
      >
        {figureHeading(range)}
      </h2>
      {/* Two cards across on a phone, one row of four from `lg`, exactly as
          Home's figure row reflows. */}
      <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-3.5">
        {figures.map((figure) => (
          // One wrapper per figure: it carries the React key and `data-metric`,
          // which is how the row's tests single a figure out. The shared card
          // takes no data attributes of its own.
          <div key={figure.key} data-metric={figure.key} className="min-w-0">
            <MetricCard
              label={figure.label}
              value={figure.value}
              format={figure.format}
              series={figure.series}
              change={figure.change}
              compareLabel={compareLabel}
              spokenChange={spokenPeriodChange(figure.change, days)}
              unavailable={copy.unavailableValue}
              unavailableSpoken={copy.unavailableValueSpoken}
            />
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * The window the figures cover. The three ranges the page offers have their own
 * words; the customer's own span says its dates instead of a label that would
 * leave them guessing which dates it meant.
 */
function figureHeading(range: MonitorDateRange): string {
  if (range.key === "custom") return customSpan(range);
  const headings: Partial<Record<MonitorDateRange["key"], string>> =
    niche.copy.performance.figureHeading;
  return headings[range.key] ?? range.label;
}

/**
 * What a figure is compared against, for the tail of its note. A range the page
 * offers has its own short words — the same ones Home's figure row uses for the
 * same week, so the two surfaces read identically — and anything else names its
 * own length rather than borrowing a word that would be wrong about it.
 */
export function compareTail(range: MonitorDateRange): string {
  const tails: Partial<Record<MonitorDateRange["key"], string>> =
    niche.copy.performance.figureCompare;
  return tails[range.key] ?? `previous ${range.days} day${range.days === 1 ? "" : "s"}`;
}

const dayMonth = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
const dayMonthYear = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function customSpan(range: MonitorDateRange): string {
  const since = parseDay(range.since);
  const until = parseDay(range.until);
  if (!since || !until) return range.label;
  if (since.getTime() === until.getTime()) return dayMonth.format(since);
  // The year earns its place only once the span leaves the current one; inside
  // it the two dates are longer than the heading needs.
  const thisYear = new Date().getUTCFullYear();
  const format =
    since.getUTCFullYear() === thisYear && until.getUTCFullYear() === thisYear ? dayMonth : dayMonthYear;
  return `${format.format(since)} – ${format.format(until)}`;
}

function parseDay(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Money sums land on float noise; the card prints cents, so round to cents. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
