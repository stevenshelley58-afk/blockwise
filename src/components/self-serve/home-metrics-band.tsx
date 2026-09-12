"use client";

/*
 * The band that answers "how is my advertising doing this week" before anything
 * else on Home. Three figures, all trailing seven days, all from the same
 * reporting snapshot the Results page reads.
 *
 * The band always renders, in one of three honest tones:
 *   live        this workspace's own delivery
 *   demo        an example account's numbers, labelled as such
 *   unavailable no reporting exists yet, so every figure reads as not reported
 *
 * It never substitutes a zero for a missing figure, and a demo figure is never
 * dressed as delivery.
 */

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { ButtonArrow } from "@/components/shadcn-dashboard/button/button-01";
import { niche } from "@/config/niche";
import type { HomeData } from "@/components/self-serve/home-dashboard";
import {
  changeBetween,
  MetricCard,
  type MetricChange,
} from "@/components/ui/metric-card";
import { previousWeekTotals } from "@/lib/home/home-safe-read-model";

/** Costs read as money, so cents stay visible: $0.80, never $0.8. */
const money = (value: number) =>
  `$${value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const whole = (value: number) => Math.round(value).toLocaleString("en-AU");

/**
 * What the comparison is against. The screen-reader sentence spells the whole
 * statement out; this is only the tail the card appends to the percentage, and
 * the niche copy has no field for half a sentence.
 */
const COMPARE_LABEL = "prior week";

type Metric = {
  key: "spend" | "clicks" | "cpc" | "leads";
  label: string;
  /** The trailing-week figure, or null when it cannot be reported honestly. */
  value: number | null;
  format: (value: number) => string;
  /** One point per day of the trailing week; fewer than two draws no line. */
  series: number[];
  change: MetricChange | null;
};

type Performance = NonNullable<HomeData["performance"]>;

/**
 * The four figures. Only ever called with a performance model: a workspace
 * with no reporting at all gets the band's notice instead of four empty cards.
 */
function buildMetrics(performance: Performance): Metric[] {
  const copy = niche.copy.home.kpis;
  const daily = [...performance.daily].sort((a, b) => a.date.localeCompare(b.date));
  const week = daily.slice(-7);
  const prior = previousWeekTotals(daily);
  const { weekly } = performance;
  const clicksPerDay = week.map((point) => point.clicks);
  // A day with no clicks has no cost per click to plot, so those days are left
  // out of the line. The printed figure is the week's own spend over its own
  // clicks, so the line only ever shapes days it could measure.
  const cpcPerDay = week
    .filter((point) => point.clicks > 0)
    .map((point) => point.spend / point.clicks);
  const priorCpc = prior && prior.clicks > 0 ? prior.spend / prior.clicks : null;

  return [
    {
      key: "spend",
      label: copy.weeklySpend,
      value: weekly.spend,
      format: money,
      series: week.map((point) => point.spend),
      change: prior ? changeBetween(weekly.spend, prior.spend) : null,
    },
    {
      key: "clicks",
      label: copy.weeklyClicks,
      value: weekly.clicks,
      format: whole,
      series: clicksPerDay,
      change: prior ? changeBetween(weekly.clicks, prior.clicks) : null,
    },
    {
      key: "cpc",
      label: copy.weeklyCpc,
      value: weekly.cpc,
      format: money,
      series: cpcPerDay,
      change:
        weekly.cpc != null && priorCpc != null
          ? changeBetween(weekly.cpc, priorCpc)
          : null,
    },
    {
      key: "leads",
      label: copy.weeklyLeads,
      value: weekly.leads,
      format: whole,
      series: week.map((point) => point.leads),
      change: prior ? changeBetween(weekly.leads, prior.leads) : null,
    },
  ];
}

/**
 * The comparison as a screen reader hears it: the week's real direction in
 * words, because "12%" beside an arrow says nothing out loud. The band shows
 * only the percentage; the sentence comes from the niche's own copy, so the
 * card itself carries none.
 */
function spokenChange(change: MetricChange): string {
  const copy = niche.copy.home.kpis;
  return change.direction === "level"
    ? copy.vsPriorWeek.level
    : change.direction === "up"
      ? copy.vsPriorWeek.higher(change.percent)
      : copy.vsPriorWeek.lower(change.percent);
}

export function HomeMetricsBand({
  performance,
  hasProvider,
}: {
  performance: HomeData["performance"];
  hasProvider: boolean;
}) {
  const copy = niche.copy.home.kpis;
  const tone = performance === null ? "unavailable" : performance.isSample ? "demo" : "live";
  const metrics = performance ? buildMetrics(performance) : [];
  const synced = performance?.lastSyncedAt
    ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(performance.lastSyncedAt),
      )
    : null;

  const notice =
    tone === "demo"
      ? { text: copy.demoNote, action: copy.demoAction, href: "/connect-meta" }
      : tone === "unavailable"
        ? {
            text: copy.unavailableNote,
            action: hasProvider ? copy.viewPerformance : copy.unavailableAction,
            href: hasProvider ? "/results" : "/connect-meta",
          }
        : null;

  return (
    <section aria-labelledby="home-week-heading">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2
          id="home-week-heading"
          className="font-display text-[15.5px] font-extrabold tracking-[-0.015em] text-foreground"
        >
          {copy.weeklyTitle}
        </h2>
        {/* The heading already says the window, so this line carries only what
            the heading cannot: when the figures were last synced. */}
        {tone === "live" && synced ? (
          <p className="text-[11.5px] text-muted-foreground">{copy.syncedAt(synced)}</p>
        ) : null}
        {/* Only a workspace reading its own delivery gets a second way in; the
            demo and unavailable tones carry a single recovery action instead. */}
        {tone === "live" ? (
          <Link
            href="/results"
            className="ml-auto inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copy.viewPerformance}
            <ArrowRight size={14} aria-hidden />
          </Link>
        ) : null}
      </div>

      {metrics.length > 0 ? (
        // The four figures wear the shared KPI card: same surface, hairline,
        // radius and shadow as every other card in the product, with each
        // figure's sparkline and prior-week comparison inside its own card.
        // Two up on a phone, one row from `lg`; between those the sidebar has
        // taken its width, and four columns there would leave a card too narrow
        // for a five-figure spend.
        <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-3.5">
          {metrics.map((metric) => (
            // One wrapper per figure: it carries the React key and
            // `data-metric`, which is how Home's own tests and the band's tone
            // checks single a figure out. The shared card takes no data
            // attributes of its own.
            <div key={metric.key} data-metric={metric.key} className="min-w-0">
              <MetricCard
                label={metric.label}
                value={metric.value}
                format={metric.format}
                series={metric.series}
                change={metric.change}
                compareLabel={COMPARE_LABEL}
                spokenChange={metric.change ? spokenChange(metric.change) : undefined}
                unavailable={copy.unavailableValue}
                unavailableSpoken={copy.unavailableValueSpoken}
              />
            </div>
          ))}
        </dl>
      ) : null}

      {notice ? (
        // One notice, one label for the whole band: the demo tone says it once
        // here rather than twice, and the amber dot is the same marker Results
        // puts on the same statement.
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-(--r-card) border border-(--line) bg-(--surface-subtle) px-4 py-2.5">
          <p className="flex min-w-0 items-start gap-2.5 text-[12.5px] leading-snug text-muted-foreground">
            {tone === "demo" ? (
              // Anchored to the sentence's first line rather than to the row, so
              // a note that wraps never leaves the dot floating on its own.
              <span className="mt-[6px] size-[8px] shrink-0 rounded-full bg-warning" aria-hidden />
            ) : null}
            <span>{notice.text}</span>
          </p>
          {/* The band's one action in these tones, wearing the product's own
              call to action rather than a line of small text. */}
          <ButtonArrow href={notice.href} className="shrink-0">
            {notice.action}
          </ButtonArrow>
        </div>
      ) : null}
    </section>
  );
}
