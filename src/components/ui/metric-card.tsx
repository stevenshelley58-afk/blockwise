/*
 * The shared KPI card: one figure, its own week drawn as a line, and its
 * comparison with the prior period. Lifted from Home's weekly metrics row so
 * every figure card in the product wears the same surface, hairline, radius
 * and shadow.
 *
 * It holds no copy of its own. An unformattable figure is a prop, not a zero,
 * and the comparison's visible percentage is named by the caller's own copy, so
 * the band still speaks in the niche's words and a card never invents a number
 * the workspace does not have.
 */

import { ArrowDown, ArrowUp } from "lucide-react";

import { AnimatedNumber } from "@/components/ui/animated-number";
import { Sparkline } from "@/components/ui/sparkline";
import { countUpDuration, springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

const COUNT_SPRING = { ...springs.slow, duration: countUpDuration };

/*
 * The label and the figure are spelled out as whole class strings rather than
 * merged with `cn` token by token: `cn` reads a `text-[12px]` size as a colour
 * and drops the `leading-[1.35]` (or `leading-none`) sitting in an earlier
 * argument. Merging them silently changed the card's line boxes.
 */
const LABEL: Record<"default" | "compact", string> = {
  default: "text-[12px] leading-[1.35] font-semibold text-muted-foreground",
  compact: "text-[10.5px] leading-[1.35] font-semibold text-muted-foreground sm:text-[12px]",
};

const VALUE_BASE: Record<"default" | "compact", string> = {
  default:
    "mt-1 font-display text-[22px] leading-none font-extrabold tracking-[-0.025em] tabular-nums lg:text-[24px]",
  compact:
    "mt-1 font-display text-[18px] leading-none font-extrabold tracking-[-0.025em] tabular-nums sm:text-[24px]",
};

/** Unavailable is not zero: a null figure reads muted, a real one reads in full ink. */
const VALUE_TONE: Record<"quiet" | "loud", string> = {
  quiet: "text-muted-foreground",
  loud: "text-foreground",
};

/** Period on period, as a percentage. Home's band builds it; the card paints it. */
export type MetricChange = { direction: "up" | "down" | "level"; percent: number };

/** Costs read as money, so cents stay visible: $0.80, never $0.8. */
export const formatMoney = (value: number): string =>
  `$${value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A counted figure: link clicks, leads, impressions, running ads. */
export const formatCount = (value: number): string => Math.round(value).toLocaleString("en-AU");

/**
 * The comparison as one sentence for assistive technology. The visible note
 * prints the percentage beside the arrow, so the spoken version has to carry
 * the direction in words.
 */
export function spokenPeriodChange(
  change: MetricChange | null,
  days: number,
): string | undefined {
  if (!change) return undefined;
  const period = `the previous ${days} day${days === 1 ? "" : "s"}`;
  return change.direction === "level"
    ? `No change from ${period}`
    : `${change.percent}% ${change.direction === "up" ? "higher" : "lower"} than ${period}`;
}

/**
 * Period on period, as a percentage. A prior period with nothing in it has no
 * percentage to report, so the comparison is dropped rather than shown as
 * infinite or as a flat zero.
 */
export function changeBetween(current: number, prior: number | null | undefined): MetricChange | null {
  if (prior == null || !Number.isFinite(prior) || prior <= 0) return null;
  const ratio = (current - prior) / prior;
  const percent = Math.round(Math.abs(ratio) * 100);
  if (percent === 0) return { direction: "level", percent: 0 };
  return { direction: ratio > 0 ? "up" : "down", percent };
}

type Props = {
  label: string;
  /** The figure, or null when it cannot be reported honestly. Never a zero. */
  value: number | null;
  format: (value: number) => string;
  /** One point per day of the trailing period; fewer than two draws no line. */
  series?: number[];
  change?: MetricChange | null;
  /** What the change is against, e.g. "prior week" → "12% vs prior week". */
  compareLabel?: string;
  /** The sentence a screen reader hears. When given, the visible text is hidden twice over. */
  spokenChange?: string;
  /** The mark a null figure renders, e.g. "—". */
  unavailable?: string;
  /** The word a screen reader hears for that mark, e.g. "Not reported". */
  unavailableSpoken?: string;
  /** Phone-first sizing, so three cards fit a 320px row. */
  compact?: boolean;
  /**
   * Drop the " vs {compareLabel}" tail below `sm`, so a phone reads just the
   * figure and its arrow. The spoken sentence and every wider width are
   * unchanged.
   */
  hideCompareOnPhone?: boolean;
};

/**
 * The comparison under a figure. A "0%" beside a minus reads as a negative, so
 * a level period says so in words, and the caller's spoken sentence carries the
 * direction the arrow alone would otherwise mumble.
 */
export function ChangeNote({
  change,
  compareLabel,
  spokenChange,
  hideCompareOnPhone = false,
}: {
  change: MetricChange;
  compareLabel?: string;
  spokenChange?: string;
  hideCompareOnPhone?: boolean;
}) {
  const Icon = change.direction === "up" ? ArrowUp : change.direction === "down" ? ArrowDown : null;
  const compare = compareLabel ? ` vs ${compareLabel}` : null;

  return (
    <span className="flex items-start gap-1 text-[11.5px] leading-[1.35] text-muted-foreground">
      {Icon ? <Icon aria-hidden size={12} strokeWidth={2.4} className="mt-[3px] shrink-0" /> : null}
      {spokenChange ? <span className="sr-only">{spokenChange}</span> : null}
      <span aria-hidden={spokenChange ? true : undefined} className="tabular-nums">
        {change.direction === "level" ? "No change" : `${change.percent}%`}
        {compare && hideCompareOnPhone ? (
          <span className="hidden sm:inline">{compare}</span>
        ) : (
          compare
        )}
      </span>
    </span>
  );
}

export function MetricCard({
  label,
  value,
  format,
  series,
  change,
  compareLabel,
  spokenChange,
  unavailable = "—",
  unavailableSpoken,
  compact = false,
  hideCompareOnPhone = false,
}: Props): React.ReactElement {
  // The line and the comparison stack: side by side they would squeeze the note
  // into a column of two-word lines at two up. Fewer than two points draws
  // nothing, so a card can hold a comparison and no line.
  const line =
    series && series.length > 1 ? (
      <Sparkline points={series} width={104} className="h-auto w-full max-w-[104px]" />
    ) : null;

  return (
    <div
      className={cn(
        "min-w-0 rounded-(--r-card) border border-(--line) bg-card shadow-card",
        compact
          ? "px-2.5 py-3 sm:px-[18px] sm:pt-[17px] sm:pb-[15px]"
          : "px-4 py-3.5 lg:px-[18px] lg:pt-[17px] lg:pb-[15px]",
      )}
    >
      <dt className={LABEL[compact ? "compact" : "default"]}>{label}</dt>
      <dd
        className={cn(
          VALUE_BASE[compact ? "compact" : "default"],
          VALUE_TONE[value === null ? "quiet" : "loud"],
        )}
      >
        {value === null ? (
          <>
            <span aria-hidden>{unavailable}</span>
            {unavailableSpoken ? <span className="sr-only">{unavailableSpoken}</span> : null}
          </>
        ) : (
          <AnimatedNumber value={value} format={format} springOptions={COUNT_SPRING} />
        )}
      </dd>
      {line || change ? (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {line}
          {change ? (
            <ChangeNote
              change={change}
              compareLabel={compareLabel}
              spokenChange={spokenChange}
              hideCompareOnPhone={hideCompareOnPhone}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
