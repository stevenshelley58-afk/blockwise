"use client";

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PRIMARY = "#006bff";
const ACCENT = "#31c46f";
const NAVY = "#0b1b33";
const FAINT = "#e2e8f0";
const MUTED = "#64748b";

const ADVERTISER_COLORS = ["#006bff", "#1f7bff", "#3d8bff", "#5b9bff", "#79abff", "#97bbff"];

type AuditChartsProps = {
  active: number;
  inactive: number;
  activeRate: number;
  advertisers: Array<{ name: string; ads: number }>;
  launches: Array<{ label: string; count: number }>;
};

export function AuditCharts({ active, inactive, activeRate, advertisers, launches }: AuditChartsProps) {
  const statusData = [
    { name: "Active now", value: active },
    { name: "Inactive", value: Math.max(inactive, 0) },
  ];
  const hasStatus = active + inactive > 0;
  const advertiserData = advertisers.map((item) => ({ name: shortName(item.name), fullName: item.name, ads: item.ads }));
  const hasLaunches = launches.some((bucket) => bucket.count > 0);

  return (
    <div className="audit-charts">
      <figure className="audit-chart-card">
        <figcaption>
          <h3>Share of ads still live</h3>
          <p>How many detected ads are still delivering — a read on sustained spend.</p>
        </figcaption>
        <div className="audit-chart-donut">
          {hasStatus ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={statusData} dataKey="value" innerRadius={62} outerRadius={88} startAngle={90} endAngle={-270} stroke="none" paddingAngle={2}>
                    <Cell fill={ACCENT} />
                    <Cell fill={FAINT} />
                  </Pie>
                  <Tooltip {...tooltipProps} />
                </PieChart>
              </ResponsiveContainer>
              <div className="audit-chart-donut-center">
                <strong>{Math.round(activeRate * 100)}%</strong>
                <span>active</span>
              </div>
            </>
          ) : (
            <p className="audit-chart-empty">No status data.</p>
          )}
        </div>
        <div className="audit-chart-legend">
          <span><i style={{ background: ACCENT }} aria-hidden /> Active ({active})</span>
          <span><i style={{ background: FAINT }} aria-hidden /> Inactive ({Math.max(inactive, 0)})</span>
        </div>
      </figure>

      <figure className="audit-chart-card">
        <figcaption>
          <h3>Most active advertisers</h3>
          <p>Agencies running the most ads detected in this area.</p>
        </figcaption>
        {advertiserData.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(180, advertiserData.length * 38)}>
            <BarChart data={advertiserData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={132} tick={{ fontSize: 12, fill: NAVY }} tickLine={false} axisLine={false} />
              <Tooltip {...tooltipProps} cursor={{ fill: "rgba(0,107,255,0.06)" }} />
              <Bar dataKey="ads" radius={[0, 6, 6, 0]} barSize={18}>
                {advertiserData.map((entry, index) => (
                  <Cell key={entry.fullName} fill={ADVERTISER_COLORS[index % ADVERTISER_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="audit-chart-empty">No advertiser data.</p>
        )}
      </figure>

      <figure className="audit-chart-card audit-chart-card-wide">
        <figcaption>
          <h3>New ads launched by month</h3>
          <p>Launch tempo over the last 12 months — when competitors push hardest.</p>
        </figcaption>
        {hasLaunches ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={launches} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={{ stroke: FAINT }} interval={0} />
              <YAxis tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...tooltipProps} cursor={{ fill: "rgba(0,107,255,0.06)" }} />
              <Bar dataKey="count" fill={PRIMARY} radius={[5, 5, 0, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="audit-chart-empty">No launch-date data.</p>
        )}
      </figure>
    </div>
  );
}

const tooltipProps = {
  contentStyle: { borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12, boxShadow: "0 8px 24px -12px rgba(15,23,42,0.35)" },
  labelStyle: { color: NAVY, fontWeight: 600 },
} as const;

function shortName(name: string): string {
  if (name.length <= 22) return name;
  return `${name.slice(0, 21).trim()}…`;
}
