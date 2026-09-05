"use client";

/*
 * Home performance snapshot — single-series area chart in the data hue
 * (mockup pattern): crosshair tooltip, endpoint label, "view as table"
 * fallback for accessibility, honest empty state. Dataviz rules: one hue,
 * no legend for a single series, text never wears the data color.
 */

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { niche } from "@/config/niche";

export type HomeDailyPoint = { date: string; leads: number };

const DATA_HUE = "var(--ui-data)";
const DATA_SOFT = "var(--ui-data-soft)";

function formatDay(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(parsed);
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: HomeDailyPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-[9px] bg-(--ink) px-2.5 py-1.5 text-white shadow-float">
      <p className="text-[10.5px] leading-[1.35] text-white/65">{formatDay(point.date)}</p>
      <p className="text-[12.5px] leading-[1.35] font-bold tabular-nums">
        {point.leads} {point.leads === 1 ? "lead" : "leads"}
      </p>
    </div>
  );
}

export function HomePerformanceChart({ daily }: { daily: HomeDailyPoint[] | null }) {
  const copy = niche.copy.home.chart;
  const gradientId = useId();
  const hasSeries = Boolean(daily && daily.length > 0 && daily.some((point) => point.leads > 0));
  const last = hasSeries && daily ? daily[daily.length - 1] : null;

  return (
    <section
      aria-label={copy.title}
      className="rounded-(--r-panel) bg-card shadow-card"
    >
      <div className="flex items-start justify-between gap-2.5 px-5 pt-5 md:px-[22px]">
        <div>
          <h2 className="font-display text-[15.5px] font-extrabold tracking-[-0.015em]">
            {copy.title}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{copy.subtitle}</p>
        </div>
        <Link
          href="/results"
          className="inline-flex h-9 shrink-0 cursor-pointer items-center rounded-full border border-(--line-heavy) bg-card px-3.5 text-[12.5px] font-bold text-foreground transition-[background,box-shadow] duration-150 hover:bg-(--surface-subtle) hover:shadow-card"
        >
          {copy.viewPerformance}
        </Link>
      </div>

      <div className="px-5 pt-4 pb-5 md:px-[22px]">
        {hasSeries && daily ? (
          <>
            <div className="h-[218px] w-full" role="img" aria-label={`${copy.title}, ${copy.subtitle.toLowerCase()}`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ top: 12, right: 18, bottom: 0, left: -14 }}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={DATA_SOFT} stopOpacity={1} />
                      <stop offset="100%" stopColor={DATA_SOFT} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--ui-border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDay}
                    interval={6}
                    tickLine={false}
                    axisLine={{ stroke: "var(--ui-border)" }}
                    tick={{ fill: "var(--ui-muted)", fontSize: 10.5 }}
                    dy={6}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--ui-muted)", fontSize: 10.5 }}
                    width={40}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    cursor={{ stroke: "var(--ui-muted)", strokeWidth: 1, strokeDasharray: "3 3" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="leads"
                    stroke={DATA_HUE}
                    strokeWidth={2}
                    fill={`url(#${gradientId})`}
                    activeDot={{ r: 3.5, fill: DATA_HUE, strokeWidth: 0 }}
                    isAnimationActive={true}
                    animationDuration={700}
                  />
                  {last ? (
                    <ReferenceDot
                      x={last.date}
                      y={last.leads}
                      r={3.5}
                      fill={DATA_HUE}
                      stroke="var(--ui-card)"
                      strokeWidth={1.5}
                      label={{
                        value: String(last.leads),
                        position: "top",
                        fill: "var(--ui-muted)",
                        fontSize: 10.5,
                        fontWeight: 700,
                      }}
                    />
                  ) : null}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <details className="mt-2.5 text-xs font-semibold text-muted-foreground">
              <summary className="inline-flex cursor-pointer items-center gap-1.5 list-none hover:text-foreground [&::-webkit-details-marker]:hidden">
                {copy.viewAsTable}
                <ChevronDown aria-hidden size={12} />
              </summary>
              <table className="mt-2 w-full border-collapse text-xs tabular-nums">
                <thead>
                  <tr>
                    <th className="border-b border-border px-2 py-1.5 text-left text-[11px] font-semibold text-(--faint)">
                      Day
                    </th>
                    <th className="border-b border-border px-2 py-1.5 text-left text-[11px] font-semibold text-(--faint)">
                      Leads
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((point) => (
                    <tr key={point.date}>
                      <td className="border-b border-border px-2 py-1.5">{formatDay(point.date)}</td>
                      <td className="border-b border-border px-2 py-1.5">{point.leads}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        ) : (
          <div className="grid h-[218px] place-items-center rounded-xl border border-dashed border-border">
            <div className="max-w-[260px] text-center">
              <p className="text-sm font-bold">{daily?.length ? "No enquiries recorded" : "Reporting unavailable"}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{daily?.length ? "No enquiries are recorded for this reporting period." : "There is no verified reporting data for this period."}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
