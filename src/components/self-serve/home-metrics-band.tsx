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

import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import Link from "next/link";

import { Sparkline } from "@/components/self-serve/sparkline";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { niche } from "@/config/niche";
import type { HomeData } from "@/components/self-serve/home-dashboard";
import { previousWeekTotals } from "@/lib/home/home-safe-read-model";
import { countUpDuration, springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

const COUNT_SPRING = { ...springs.slow, duration: countUpDuration };

/** Costs read as money, so cents stay visible: $0.80, never $0.8. */
const money = (value: number) =>
  `$${value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const whole = (value: number) => Math.round(value).toLocaleString("en-AU");

type Change = { direction: "up" | "down" | "level"; percent: number };

/**
 * Week on week, as a percentage. A prior week with nothing in it has no
 * percentage to report, so the comparison is dropped rather than shown as
 * infinite or as a flat zero.
 */
function changeBetween(current: number, prior: number): Change | null {
  if (!Number.isFinite(prior) || prior <= 0) return null;
  const ratio = (current - prior) / prior;
  const percent = Math.round(Math.abs(ratio) * 100);
  if (percent === 0) return { direction: "level", percent: 0 };
  return { direction: ratio > 0 ? "up" : "down", percent };
}

type Metric = {
  key: "spend" | "clicks" | "cpc";
  label: string;
  /** The trailing-week figure, or null when it cannot be reported honestly. */
  value: number | null;
  format: (value: number) => string;
  /** One point per day of the trailing week; fewer than two draws no line. */
  series: number[];
  change: Change | null;
};

type Performance = NonNullable<HomeData["performance"]>;

/**
 * The three figures. Only ever called with a performance model: a workspace
 * with no reporting at all gets the band's notice instead of three empty rows.
 */
function buildMetrics(performance: Performance): Metric[] {
  const copy = niche.copy.home.kpis;
  const daily = [...performance.daily].sort((a, b) => a.date.localeCompare(b.date));
  const week = daily.slice(-7);
  const prior = previousWeekTotals(daily);
  const { weekly } = performance;
  const clicksPerDay = week.map((point) => point.clicks);
  // A day with no clicks has no cost per click, so a week containing one draws
  // no line rather than bridging a gap it cannot measure.
  const cpcPerDay = clicksPerDay.every((clicks) => clicks > 0)
    ? week.map((point) => point.spend / point.clicks)
    : [];
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
  ];
}

function ChangeNote({ change }: { change: Change }) {
  const copy = niche.copy.home.kpis;
  const spoken =
    change.direction === "level"
      ? copy.vsPriorWeek.level
      : change.direction === "up"
        ? copy.vsPriorWeek.higher(change.percent)
        : copy.vsPriorWeek.lower(change.percent);
  // "0%" next to a minus reads as a negative, so a level week says so in words.
  const Icon = change.direction === "up" ? ArrowUp : change.direction === "down" ? ArrowDown : null;

  return (
    <span className="flex items-start gap-1 text-[11.5px] leading-[1.35] text-muted-foreground">
      {Icon ? <Icon aria-hidden size={12} strokeWidth={2.4} className="mt-[3px] shrink-0" /> : null}
      <span className="sr-only">{spoken}</span>
      <span aria-hidden className="tabular-nums">
        {change.direction === "level" ? "No change" : `${change.percent}%`} vs prior week
      </span>
    </span>
  );
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
        {tone === "demo" ? (
          <span className="rounded-full border border-(--line-heavy) px-2.5 py-1 font-mono text-[9.5px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
            {copy.demoBadge}
          </span>
        ) : null}
        <p className="text-[11.5px] text-muted-foreground">
          {tone === "live" && synced
            ? `${copy.weekScope} · ${copy.syncedAt(synced)}`
            : copy.weekScope}
        </p>
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
        <dl className="mt-5 grid grid-cols-1 gap-y-5 sm:grid-cols-3 sm:gap-x-8 sm:gap-y-0">
          {metrics.map((metric) => (
            // Below `sm` the figures sit on one line each, label left and value
            // right: three columns cannot hold a five-figure spend at a legible
            // size on a phone, and the figures must never collide.
            <div
              key={metric.key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-2 sm:block"
            >
              <dt className="text-[12px] leading-[1.35] font-semibold text-muted-foreground">
                {metric.label}
              </dt>
              <dd
                className={cn(
                  "justify-self-end font-display text-[22px] leading-none font-extrabold tracking-[-0.025em] tabular-nums sm:mt-1.5 sm:block sm:justify-self-auto sm:text-[28px]",
                  metric.value === null ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {metric.value === null ? (
                  <>
                    <span aria-hidden>{copy.unavailableValue}</span>
                    <span className="sr-only">{copy.unavailableValueSpoken}</span>
                  </>
                ) : (
                  <AnimatedNumber
                    value={metric.value}
                    format={metric.format}
                    springOptions={COUNT_SPRING}
                  />
                )}
              </dd>
              {metric.series.length > 1 || metric.change ? (
                <dd className="col-span-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 sm:col-span-1 sm:mt-2.5 sm:min-h-[26px]">
                  {metric.series.length > 1 ? (
                    <Sparkline
                      points={metric.series}
                      width={104}
                      className="h-auto w-full max-w-[104px]"
                    />
                  ) : null}
                  {metric.change ? <ChangeNote change={metric.change} /> : null}
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
      ) : null}

      {notice ? (
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-(--r-card) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/60 px-4 py-3">
          <p className="text-[12.5px] text-muted-foreground">{notice.text}</p>
          {/* The only action the band offers in these tones, so it keeps a
              full touch target on the phone rather than a line of small text. */}
          <Link
            href={notice.href}
            className="inline-flex min-h-11 items-center gap-1 text-[12.5px] font-semibold text-foreground underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            {notice.action}
            <ArrowRight size={13} aria-hidden />
          </Link>
        </div>
      ) : null}
    </section>
  );
}
