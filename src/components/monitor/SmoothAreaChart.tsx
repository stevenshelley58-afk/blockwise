import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type SmoothAreaPoint = { date: string; value: number | null };

/**
 * Ink-background tooltip shared by the monitor charts (matches the home
 * performance chart). Text never wears the data hue.
 */
export function MonitorTooltip({
  active,
  payload,
  label,
  formatValue,
  seriesLabel,
}: {
  active?: boolean;
  payload?: Array<{ value?: number | string | null; name?: string | number }>;
  label?: string | number;
  formatValue: (value: number) => string;
  seriesLabel?: (name: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-[9px] bg-(--ink) px-2.5 py-1.5 text-white shadow-float">
      <p className="text-[10.5px] leading-[1.35] text-white/65">{formatDayTick(String(label ?? ""))}</p>
      {payload.map((entry, index) => (
        <p key={index} className="text-[12.5px] leading-[1.35] font-bold tabular-nums">
          {typeof entry.value === "number" ? formatValue(entry.value) : "—"}
          {seriesLabel && entry.name != null ? (
            <span className="font-medium text-white/65"> · {seriesLabel(String(entry.name))}</span>
          ) : null}
        </p>
      ))}
    </div>
  );
}

/** Shopify-style smooth area chart: monotone curve, gradient fill, horizontal grid only. */
export function SmoothAreaChart(props: {
  id: string;
  data: SmoothAreaPoint[];
  color: string;
  valueFormatter: (value: number) => string;
}) {
  const gradientId = `mm-area-${props.id}`;

  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={props.data} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={props.color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={props.color} stopOpacity={0} />
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
            width={42}
            tick={{ fontSize: 10, fill: "var(--faint)" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => props.valueFormatter(value)}
          />
          <Tooltip
            cursor={{ stroke: "var(--faint)", strokeWidth: 1, strokeDasharray: "3 3" }}
            content={<MonitorTooltip formatValue={props.valueFormatter} />}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={props.color}
            strokeWidth={2.2}
            fill={`url(#${gradientId})`}
            connectNulls={false}
            dot={false}
            activeDot={{ r: 3.5 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function formatDayTick(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);

  return Number.isNaN(date.getTime())
    ? isoDate
    : date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
