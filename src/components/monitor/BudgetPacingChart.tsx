import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { calculateBudgetPacing, formatCurrency, formatPercent } from "@/lib/meta-monitor/calculations";
import type { MetaDailyPoint, MonitorDateRange } from "@/lib/meta-monitor/types";

import { formatDayTick, MonitorTooltip } from "./SmoothAreaChart";

const DATA_HUE = "var(--ui-data)";

export function BudgetPacingChart(props: {
  daily: MetaDailyPoint[];
  budget: number | null;
  spend: number;
  range: MonitorDateRange;
  now?: Date;
}) {
  const today = auDate(props.now ?? new Date());
  const daysElapsed = props.daily.filter((point) => point.date <= today).length;
  const pacing =
    props.budget != null
      ? calculateBudgetPacing({
          budget: props.budget,
          spend: props.spend,
          daysElapsed,
          totalDays: props.range.days,
        })
      : null;

  let cumulative = 0;
  const data = props.daily.map((point, index) => {
    const isPast = point.date <= today;

    cumulative += point.spend;

    return {
      date: point.date,
      actual: isPast ? round2(cumulative) : null,
      expected: props.budget != null ? round2((props.budget * (index + 1)) / props.range.days) : null,
    };
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_168px]">
      <div>
        <ResponsiveContainer width="100%" height={196}>
          <ComposedChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
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
              width={46}
              tick={{ fontSize: 10, fill: "var(--faint)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => formatCurrency(value)}
              domain={props.budget != null ? [0, Math.ceil((props.budget * 1.25) / 1000) * 1000] : undefined}
            />
            <Tooltip
              cursor={{ stroke: "var(--faint)", strokeWidth: 1, strokeDasharray: "3 3" }}
              content={
                <MonitorTooltip
                  formatValue={formatCurrency}
                  seriesLabel={(name) => (name === "actual" ? "Actual spend" : "Expected spend")}
                />
              }
            />
            {props.budget != null ? (
              <ReferenceLine
                y={props.budget}
                stroke="var(--faint)"
                strokeDasharray="2 5"
                label={{ value: "Budget", position: "insideTopRight", fontSize: 10, fill: "var(--faint)" }}
              />
            ) : null}
            {props.budget != null ? (
              <Line
                type="monotone"
                dataKey="expected"
                stroke={DATA_HUE}
                strokeWidth={1.6}
                strokeDasharray="5 5"
                strokeOpacity={0.5}
                dot={false}
                isAnimationActive={false}
              />
            ) : null}
            <Line
              type="monotone"
              dataKey="actual"
              stroke={DATA_HUE}
              strokeWidth={2.4}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {pacing ? (
        <aside className="grid content-start gap-2.5 rounded-(--r-card) border border-(--line) bg-(--surface-subtle) p-4">
          <PacingStat label="Budget" value={formatCurrency(pacing.budget)} />
          <PacingStat
            label="Spent"
            value={
              <>
                {formatCurrency(pacing.spend)}{" "}
                <small className="font-medium text-(--faint)">({formatPercent(pacing.spendPercent)})</small>
              </>
            }
          />
          <PacingStat label="Forecast" value={formatCurrency(pacing.forecastSpend)} />
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
              Pacing status
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${badgeTone(pacing.status)}`}>
              {pacing.status}
            </span>
          </div>
        </aside>
      ) : (
        <aside className="grid content-start gap-2.5 rounded-(--r-card) border border-(--line) bg-(--surface-subtle) p-4">
          <PacingStat label="Budget" value="Not set" />
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            No monthly budget set. Pacing appears once a monthly budget is configured.
          </p>
        </aside>
      )}
    </div>
  );
}

function PacingStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">{label}</span>
      <b className="text-[13px] font-bold tabular-nums">{value}</b>
    </div>
  );
}

function badgeTone(status: "Overspending" | "On pace" | "Under pacing"): string {
  if (status === "On pace") return "bg-success-soft text-success";
  if (status === "Overspending") return "bg-error-soft text-error";

  return "bg-warning-soft text-warning";
}

function auDate(now: Date): string {
  return new Date(now.getTime() + 10 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
