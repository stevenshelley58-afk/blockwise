import { formatCurrency, formatPercent, safeRate } from "./calculations.ts";
import type { MetaDailyPoint } from "./types.ts";

/**
 * Every metric Results can draw a line for, most important first.
 *
 * Order is the product's own: how many leads came in, what they cost, what was
 * spent, then how the ads delivered and how people responded. A figure with no
 * daily series (reach and impressions per day are aggregated from the same
 * insight rows as spend) cannot be charted and does not belong here; neither
 * does "running ads", which is a count today rather than something that moves
 * over a period, nor the count of valid leads, which the tables that audit lead
 * quality carry rather than becoming a line of its own. The valid lead *rate*
 * stays: it is the share of the leads on the chart that were worth having.
 */
export type ChartMetricKey =
  | "leads"
  | "cpl"
  | "spend"
  | "reach"
  | "impressions"
  | "clicks"
  | "cpc"
  | "ctr"
  | "validRate";

/** Ratio metrics that a day can legitimately have nothing to plot for. */
export type ChartGapKey = "cpl" | "cpc" | "ctr" | "validRate";

export type ChartMetricDefinition = {
  key: ChartMetricKey;
  /** The day's value, or null when that day cannot report it. */
  read: (point: MetaDailyPoint) => number | null;
  format: (value: number) => string;
  /** The same figure narrowed for an axis tick; see `axisTick`. */
  axisFormat: (value: number) => string;
  /** Set when a day with no denominator leaves a gap rather than a zero. */
  gap?: ChartGapKey;
};

const whole = (value: number) => Math.round(value).toLocaleString("en-AU");

const shortNumber = new Intl.NumberFormat("en-AU", { notation: "compact", maximumFractionDigits: 1 });
const shortMoney = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Axis ticks have one narrow gutter. A figure that fits is printed in full;
 * a six-figure count or a five-figure spend is shortened so the label is not
 * clipped to its last digits. The tooltip and the hidden table keep the real
 * figure either way.
 */
function axisTick(format: (value: number) => string, short: Intl.NumberFormat) {
  return (value: number) => (Math.abs(value) >= 10_000 ? short.format(value) : format(value));
}

export const CHART_METRICS: readonly ChartMetricDefinition[] = [
  { key: "leads", read: (point) => point.leads, format: whole, axisFormat: axisTick(whole, shortNumber) },
  {
    key: "cpl",
    read: (point) => point.validCpl,
    format: formatCurrency,
    axisFormat: axisTick(formatCurrency, shortMoney),
    gap: "cpl",
  },
  {
    key: "spend",
    read: (point) => point.spend,
    format: formatCurrency,
    axisFormat: axisTick(formatCurrency, shortMoney),
  },
  { key: "reach", read: (point) => point.reach, format: whole, axisFormat: axisTick(whole, shortNumber) },
  {
    key: "impressions",
    read: (point) => point.impressions,
    format: whole,
    axisFormat: axisTick(whole, shortNumber),
  },
  { key: "clicks", read: (point) => point.clicks, format: whole, axisFormat: axisTick(whole, shortNumber) },
  {
    key: "cpc",
    read: (point) => (point.clicks > 0 ? point.spend / point.clicks : null),
    format: formatCurrency,
    axisFormat: axisTick(formatCurrency, shortMoney),
    gap: "cpc",
  },
  {
    key: "ctr",
    read: (point) => safeRate(point.clicks, point.impressions),
    format: (value) => formatPercent(value, 2),
    axisFormat: (value) => formatPercent(value, 2),
    gap: "ctr",
  },
  {
    key: "validRate",
    read: (point) => safeRate(point.validLeads, point.leads),
    format: (value) => formatPercent(value, 1),
    axisFormat: (value) => formatPercent(value, 1),
    gap: "validRate",
  },
];

export const DEFAULT_CHART_METRIC: ChartMetricKey = CHART_METRICS[0].key;

/** The chart's own series: one point per day, gaps left as gaps. */
export function chartSeries(
  points: MetaDailyPoint[],
  metric: ChartMetricDefinition,
): Array<{ date: string; value: number | null }> {
  return points.map((point) => ({ date: point.date, value: metric.read(point) }));
}
