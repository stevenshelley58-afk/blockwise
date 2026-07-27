import { ChevronDown, RefreshCw } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { niche } from "@/config/niche";
import type { MonitorDateRange, MonitorRange } from "@/lib/meta-monitor/types";

/** Primary chip presets; everything else lives in the overflow menu. */
const PRIMARY_RANGES: Array<{ value: MonitorRange; key: "d7" | "d30" | "d90" }> = [
  { value: "last_7", key: "d7" },
  { value: "last_30", key: "d30" },
  { value: "last_90", key: "d90" },
];

const MORE_RANGES: Array<{ value: MonitorRange; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "maximum", label: "Maximum" },
];

// 34px visual height with a pseudo-element expanding the hit area to the 44px
// minimum touch target.
const chipBase =
  "relative inline-flex h-[34px] cursor-pointer items-center rounded-full border px-[13px] text-xs font-bold transition-[background,color,border-color,transform] duration-150 before:absolute before:inset-x-0 before:-inset-y-[5px] before:content-[''] active:scale-[0.96] motion-reduce:active:scale-100";
const chipOn = `${chipBase} border-(--ink) bg-(--ink) text-white`;
const chipOff = `${chipBase} border-(--line) bg-(--surface) text-foreground hover:border-(--line-heavy)`;

export function MetaMark({ size = 26 }: { size?: number }) {
  return (
    // One-voice rule: the mark inherits ink rather than carrying a second
    // accent family or a gradient.
    <svg width={size * 1.6} height={size} viewBox="0 0 48 30" aria-hidden role="presentation">
      <path
        d="M24 15 C19 5, 7 5, 7 15 C7 25, 19 25, 24 15 C29 5, 41 5, 41 15 C41 25, 29 25, 24 15 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MetaMonitorHeader(props: {
  range: MonitorDateRange;
  rangeKey: MonitorRange;
  customRange: { since: string; until: string };
  lastSyncedAt: string | null;
  isRefreshing: boolean;
  isSample: boolean;
  onRangeChange: (range: MonitorRange) => void;
  onCustomRangeChange: (range: { since: string; until: string }) => void;
  onRefresh: () => void;
}) {
  const copy = niche.copy.performance;
  const activeMore = MORE_RANGES.find((option) => option.value === props.rangeKey);
  const isCustom = props.rangeKey === "custom";

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <MetaMark />
            <h1 className="font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">
              {copy.title}
            </h1>
            {props.isSample ? (
              <span className="rounded-full bg-warning-soft px-2.5 py-1 text-[10.5px] font-bold tracking-wide text-warning uppercase">
                {copy.demoChip}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">{copy.subtitle}</p>
        </div>

        <button
          className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-(--line-heavy) bg-card px-3.5 text-[12.5px] font-bold text-foreground transition-[background,box-shadow] duration-150 hover:bg-(--surface-subtle) hover:shadow-card disabled:cursor-default disabled:opacity-60"
          type="button"
          onClick={props.onRefresh}
          disabled={props.isRefreshing}
          aria-label={props.isRefreshing ? `${copy.refreshing} results` : `${copy.refresh} results`}
        >
          <RefreshCw size={13} className={props.isRefreshing ? "animate-spin" : undefined} aria-hidden />
          <span>{props.isRefreshing ? copy.refreshing : copy.refresh}</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label={`Date range, ${formatRangeSpan(props.range)}`}
        >
          {PRIMARY_RANGES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === props.rangeKey ? chipOn : chipOff}
              aria-pressed={option.value === props.rangeKey}
              onClick={() => props.onRangeChange(option.value)}
            >
              {copy.ranges[option.key]}
            </button>
          ))}

          <DropdownMenu>
            <DropdownMenuTrigger
              className={`${activeMore || isCustom ? chipOn : chipOff} gap-1 outline-none focus-visible:border-(--ink) focus-visible:ring-2 focus-visible:ring-(--ink)/20`}
              aria-label={copy.moreRanges}
            >
              {isCustom ? "Custom" : (activeMore?.label ?? copy.moreRanges)}
              <ChevronDown size={12} aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[160px]">
              {MORE_RANGES.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => props.onRangeChange(option.value)}
                  className="text-xs font-semibold"
                >
                  {option.label}
                  {option.value === props.rangeKey ? (
                    <span className="ml-auto size-1.5 rounded-full bg-(--ink)" aria-hidden />
                  ) : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                onClick={() => props.onCustomRangeChange(props.customRange)}
                className="text-xs font-semibold"
              >
                Custom range
                {isCustom ? <span className="ml-auto size-1.5 rounded-full bg-(--ink)" aria-hidden /> : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {isCustom ? (
          <div
            className="inline-flex items-center gap-1.5 rounded-full border border-(--line) bg-(--surface-subtle) px-2.5 py-1 text-muted-foreground"
            role="group"
            aria-label="Custom date range"
          >
            <input
              type="date"
              aria-label="From date"
              className="h-[30px] border-0 bg-transparent text-[12.5px] font-semibold text-(--ink) outline-none"
              value={props.customRange.since}
              max={props.customRange.until || undefined}
              onChange={(event) => props.onCustomRangeChange({ ...props.customRange, since: event.target.value })}
            />
            <span aria-hidden>–</span>
            <input
              type="date"
              aria-label="To date"
              className="h-[30px] border-0 bg-transparent text-[12.5px] font-semibold text-(--ink) outline-none"
              value={props.customRange.until}
              min={props.customRange.since || undefined}
              onChange={(event) => props.onCustomRangeChange({ ...props.customRange, until: event.target.value })}
            />
          </div>
        ) : null}

        <span className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] font-medium text-(--faint)">
          <span
            className={`size-[7px] rounded-full ${props.lastSyncedAt ? "bg-success" : "bg-(--faint)"}`}
            aria-hidden
          />
          {props.lastSyncedAt ? copy.states.staleNotice(timeAgo(props.lastSyncedAt)) : copy.states.notSynced}
        </span>
      </div>
    </header>
  );
}

function formatRangeSpan(range: MonitorDateRange): string {
  return `${formatDay(range.since)} – ${formatDay(range.until)}`;
}

function formatDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);

  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.round(minutes / 60);

  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}
