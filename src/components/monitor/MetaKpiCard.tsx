import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";

import { formatPercent } from "@/lib/meta-monitor/calculations";

export function MetaKpiCard(props: {
  icon: LucideIcon;
  iconTone: "blue" | "green" | "slate" | "orange" | "rose" | "indigo";
  label: string;
  value: string;
  compareText?: string;
  /** Fractional change vs previous period, e.g. 0.124. Null hides the trend. */
  trend?: number | null;
  /** For CPL-style metrics a falling value is good. */
  goodWhenDown?: boolean;
  /** 0–1 budget-consumed progress; renders the progress variant. */
  progress?: number;
}) {
  const Icon = props.icon;
  const trend = props.trend ?? null;
  const isUp = trend != null && trend >= 0;
  const isGood = trend != null && (props.goodWhenDown ? trend <= 0 : trend >= 0);

  return (
    <article className="metric-card mm-kpi">
      <div className={`mm-kpi-icon tone-${props.iconTone}`}>
        <Icon size={16} aria-hidden />
      </div>
      <div className="mm-kpi-label">{props.label}</div>
      <div className="mm-kpi-value">{props.value}</div>
      {props.compareText ? <div className="mm-kpi-compare">{props.compareText}</div> : null}
      {trend != null ? (
        <div className={`mm-kpi-trend ${isGood ? "good" : "bad"}`}>
          {isUp ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownRight size={12} aria-hidden />}
          {formatPercent(Math.abs(trend), 1)}
        </div>
      ) : null}
      {props.progress != null ? (
        <>
          <div className="mm-progress" role="presentation">
            <i style={{ width: `${Math.min(Math.max(props.progress, 0), 1) * 100}%` }} />
          </div>
          <div className="mm-progress-note">{formatPercent(1 - Math.min(Math.max(props.progress, 0), 1))} remaining</div>
        </>
      ) : null}
    </article>
  );
}
