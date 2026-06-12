import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { calculateBudgetPacing, formatCurrency, formatPercent } from "@/lib/meta-monitor/calculations";
import type { MetaDailyPoint, MonitorDateRange } from "@/lib/meta-monitor/types";

import { formatDayTick, tooltipStyle } from "./SmoothAreaChart";

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
    <div className="mm-pacing">
      <div className="mm-chart">
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
              contentStyle={tooltipStyle}
              labelFormatter={(label) => formatDayTick(String(label))}
              formatter={(value, name) => [
                typeof value === "number" ? formatCurrency(value) : "—",
                name === "actual" ? "Actual spend" : "Expected spend",
              ]}
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
                stroke="var(--blue)"
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
              stroke="var(--blue)"
              strokeWidth={2.4}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {pacing ? (
        <aside className="mm-pacing-panel">
          <div className="mm-pacing-stat">
            <span>Budget</span>
            <b>{formatCurrency(pacing.budget)}</b>
          </div>
          <div className="mm-pacing-stat">
            <span>Spent</span>
            <b>
              {formatCurrency(pacing.spend)}{" "}
              <small>({formatPercent(pacing.spendPercent)})</small>
            </b>
          </div>
          <div className="mm-pacing-stat">
            <span>Forecast</span>
            <b>{formatCurrency(pacing.forecastSpend)}</b>
          </div>
          <div className="mm-pacing-stat">
            <span>Pacing status</span>
            <span className={`mm-badge ${badgeTone(pacing.status)}`}>{pacing.status}</span>
          </div>
        </aside>
      ) : (
        <aside className="mm-pacing-panel">
          <div className="mm-pacing-stat">
            <span>Budget</span>
            <b>Not set</b>
          </div>
          <p className="mm-pacing-note">
            No monthly budget set. Pacing appears once a monthly budget is configured.
          </p>
        </aside>
      )}
    </div>
  );
}

function badgeTone(status: "Overspending" | "On pace" | "Under pacing"): string {
  return status === "On pace" ? "green" : status === "Overspending" ? "rose" : "amber";
}

function auDate(now: Date): string {
  return new Date(now.getTime() + 10 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
