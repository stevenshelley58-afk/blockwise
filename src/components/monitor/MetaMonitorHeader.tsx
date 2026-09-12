import { RefreshCw } from "lucide-react";

import { niche } from "@/config/niche";

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

/**
 * The page heading. The date range belongs to the chart above the data it
 * slices, so this header keeps only the title, the sync state and Refresh.
 */
export function MetaMonitorHeader(props: {
  lastSyncedAt: string | null;
  isRefreshing: boolean;
  isSample: boolean;
  isConnected: boolean;
  onRefresh: () => void;
}) {
  const copy = niche.copy.performance;
  const hasLiveControls = props.isConnected && !props.isSample;

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <MetaMark />
            <h1 className="font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">
              {copy.title}
            </h1>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">{copy.subtitle}</p>
          {hasLiveControls ? (
            <span className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-(--faint)">
              <span
                className={`size-[7px] rounded-full ${props.lastSyncedAt ? "bg-success" : "bg-(--faint)"}`}
                aria-hidden
              />
              {props.lastSyncedAt ? "Last known " + timeAgo(props.lastSyncedAt) : copy.states.notSynced}
            </span>
          ) : props.isSample ? null : (
            <span className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-(--faint)">
              <span className="size-[7px] rounded-full bg-(--faint)" aria-hidden />
              Not connected
            </span>
          )}
        </div>

        {hasLiveControls ? <button
          className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-(--line-heavy) bg-card px-3.5 text-[12.5px] font-bold text-foreground transition-[background,box-shadow] duration-150 hover:bg-(--surface-subtle) hover:shadow-card disabled:cursor-default disabled:opacity-60"
          type="button"
          onClick={props.onRefresh}
          disabled={props.isRefreshing}
          aria-label={props.isRefreshing ? `${copy.refreshing} results` : `${copy.refresh} results`}
        >
          <RefreshCw size={13} className={props.isRefreshing ? "animate-spin" : undefined} aria-hidden />
          <span>{props.isRefreshing ? copy.refreshing : copy.refresh}</span>
        </button> : null}
      </div>
    </header>
  );
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
