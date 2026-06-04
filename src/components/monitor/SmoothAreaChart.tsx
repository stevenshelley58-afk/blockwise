import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type SmoothAreaPoint = { date: string; value: number | null };

/** Shopify-style smooth area chart: monotone curve, gradient fill, horizontal grid only. */
export function SmoothAreaChart(props: {
  id: string;
  data: SmoothAreaPoint[];
  color: string;
  valueFormatter: (value: number) => string;
}) {
  const gradientId = `mm-area-${props.id}`;

  return (
    <div className="mm-chart">
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
            cursor={{ stroke: "var(--line)", strokeWidth: 1 }}
            contentStyle={tooltipStyle}
            labelFormatter={(label) => formatDayTick(String(label))}
            formatter={(value) => [typeof value === "number" ? props.valueFormatter(value) : "—", ""]}
            separator=""
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

export const tooltipStyle: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid var(--line)",
  boxShadow: "var(--shadow-float)",
  fontSize: 12,
  padding: "6px 10px",
};

export function formatDayTick(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);

  return Number.isNaN(date.getTime())
    ? isoDate
    : date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
