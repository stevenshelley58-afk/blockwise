import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";

import { formatPercent } from "@/lib/meta-monitor/calculations";

export function MetaKpiCard(props: {
  /** Optional — kept for call-site compatibility; the card no longer renders an icon. */
  icon?: LucideIcon;
  iconTone?: "blue" | "green" | "slate" | "orange" | "rose" | "indigo";
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
  const trend = props.trend ?? null;
  const isUp = trend != null && trend >= 0;
  const isGood = trend != null && (props.goodWhenDown ? trend <= 0 : trend >= 0);

  return (
    <article className="rounded-(--r-card) border border-(--line) bg-(--surface) px-[18px] pt-[17px] pb-[15px] shadow-card">
      <div className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
        {props.label}
      </div>
      <div className="mt-[7px] font-display text-[24px] font-extrabold tracking-[-0.02em] tabular-nums">
        {props.value}
      </div>
      <div className="mt-[7px] flex flex-wrap items-center gap-1.5">
        {trend != null ? (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums ${
              isGood ? "bg-success-soft text-success" : "bg-error-soft text-error"
            }`}
          >
            {isUp ? <ArrowUpRight size={11} aria-hidden /> : <ArrowDownRight size={11} aria-hidden />}
            {formatPercent(Math.abs(trend), 1)}
          </span>
        ) : null}
        {props.compareText ? (
          <span className="text-[10.5px] font-medium text-(--faint)">{props.compareText}</span>
        ) : null}
      </div>
      {props.progress != null ? (
        <>
          <div className="mt-2 h-[5px] w-full overflow-hidden rounded-full bg-data-track" role="presentation">
            <i
              className="block h-full rounded-full bg-data"
              style={{ width: `${Math.min(Math.max(props.progress, 0), 1) * 100}%` }}
            />
          </div>
          <div className="mt-1 text-[10.5px] font-medium text-(--faint)">
            {formatPercent(1 - Math.min(Math.max(props.progress, 0), 1))} remaining
          </div>
        </>
      ) : null}
    </article>
  );
}
