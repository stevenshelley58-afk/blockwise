"use client";

/**
 * Selectable work-list rows.
 *
 * The whole row is one button, so keyboard and pointer activation do the same
 * thing and the hit area covers the row. Source, quality and duplicate facts
 * stay in a quiet metadata line so they never compete with the work columns.
 */

import { ChevronRight, Mail, MapPin, Phone } from "lucide-react";

import { leadsCopy } from "./copy.ts";
import {
  describeDue,
  formatDateTime,
  nextActionLabel,
  reasonLabel,
  type NeedsActionReason,
} from "./format.ts";
import type { LeadRow } from "./types.ts";
import { DeliveryChip, DuplicateChip, QualityChip, StageChip } from "./states.tsx";

export type LeadActivitySummary =
  | { state: "loaded"; label: string }
  | { state: "empty"; label: string }
  | { state: "pending" };

export type SelectableLeadRowProps = {
  row: LeadRow;
  selected: boolean;
  onSelect: () => void;
  reasons: NeedsActionReason[];
  activity: LeadActivitySummary;
  timeZone?: string;
};

const ROW_BASE =
  "w-full rounded-(--r-card) border bg-(--surface) text-left transition-[border-color,box-shadow,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function selectedClasses(selected: boolean): string {
  return selected
    ? "border-(--ink) shadow-card ring-1 ring-(--ink)"
    : "border-(--line) hover:border-(--line-heavy) hover:bg-(--surface-subtle)";
}

export function LeadListRow({ row, selected, onSelect, reasons, activity, timeZone }: SelectableLeadRowProps) {
  const due = row.nextTask ? describeDue(row.nextTask.dueAt) : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      aria-label={leadsCopy.a11y.openEnquiry(row.name)}
      className={ROW_BASE + " group grid gap-2 px-4 py-3 " + selectedClasses(selected)}
    >
      <div className="grid grid-cols-[104px_minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,1.1fr)_minmax(0,1fr)] items-start gap-3">
        <div className="flex flex-wrap gap-1 pt-0.5">
          <StageChip stage={row.stage} />
        </div>

        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-bold">{row.name}</p>
          <p className="truncate text-[12.5px] text-muted-foreground">{row.email ?? row.phone ?? leadsCopy.detail.unknown}</p>
          {row.propertyContext ? (
            <p className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[12.5px] text-muted-foreground">
              <MapPin aria-hidden className="size-3 shrink-0 text-(--faint)" />
              <span className="truncate">{row.propertyContext}</span>
            </p>
          ) : null}
        </div>

        <div className="min-w-0">
          <p className="truncate text-[12.5px] text-muted-foreground">{row.owner ?? leadsCopy.detail.noOwner}</p>
        </div>

        <div className="min-w-0">
          {row.nextTask ? (
            <>
              <p className="truncate text-[12.5px]">{row.nextTask.title}</p>
              <p className={"truncate text-[11.5px] " + (due?.overdue ? "font-bold text-error" : "text-muted-foreground")}>
                {due ? due.label : leadsCopy.tasks.noDue}
              </p>
            </>
          ) : (
            <p className="truncate text-[12.5px] text-(--faint)">{leadsCopy.tasks.none}</p>
          )}
        </div>

        <div className="min-w-0">
          <ActivitySummary activity={activity} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {reasons.map((reason) => (
          <span key={reason} className="rounded-full bg-(--surface-subtle) px-2 py-0.5 text-[10.5px] font-bold text-(--muted)">
            {reasonLabel(reason)}
          </span>
        ))}
        {row.duplicateWarning ? <DuplicateChip /> : null}
        <QualityChip quality={row.quality} />
        <DeliveryChip state={row.crmDeliveryState} />
        <span className="truncate text-[11.5px] text-(--faint)">{row.source}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-(--faint)">
          <span className="hidden sm:inline">{formatDateTime(row.receivedAt, { timeZone }) ?? leadsCopy.detail.unknown}</span>
          <ChevronRight aria-hidden className="size-3.5" />
        </span>
      </div>
    </button>
  );
}

export function LeadCard({ row, selected, onSelect, reasons, activity, timeZone }: SelectableLeadRowProps) {
  const due = row.nextTask ? describeDue(row.nextTask.dueAt) : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      aria-label={leadsCopy.a11y.openEnquiry(row.name)}
      className={ROW_BASE + " grid gap-2 px-4 py-3.5 " + selectedClasses(selected)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold">{row.name}</p>
          <p className="truncate text-[12.5px] text-muted-foreground">{row.email ?? row.phone ?? leadsCopy.detail.unknown}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StageChip stage={row.stage} />
          {row.duplicateWarning ? <DuplicateChip /> : null}
        </div>
      </div>

      {row.propertyContext ? (
        <p className="flex min-w-0 items-center gap-1 text-[12.5px] text-muted-foreground">
          <MapPin aria-hidden className="size-3 shrink-0 text-(--faint)" />
          <span className="truncate">{row.propertyContext}</span>
        </p>
      ) : null}

      <div className="grid gap-1 text-[12.5px]">
        <p className="truncate text-muted-foreground">
          {leadsCopy.columns.owner}: <span className="text-foreground">{row.owner ?? leadsCopy.detail.noOwner}</span>
        </p>
        <p className="truncate text-muted-foreground">
          {leadsCopy.columns.next}: <span className={due?.overdue ? "font-bold text-error" : "text-foreground"}>{nextActionLabel(row)}</span>
        </p>
        <p className="truncate text-muted-foreground">
          {leadsCopy.columns.lastActivity}: <span className="text-foreground"><ActivitySummary activity={activity} /></span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {reasons.map((reason) => (
          <span key={reason} className="rounded-full bg-(--surface-subtle) px-2 py-0.5 text-[10.5px] font-bold text-(--muted)">
            {reasonLabel(reason)}
          </span>
        ))}
        <QualityChip quality={row.quality} />
        <DeliveryChip state={row.crmDeliveryState} />
        <span className="truncate text-[11.5px] text-(--faint)">{row.source}</span>
      </div>
    </button>
  );
}

function ActivitySummary({ activity }: { activity: LeadActivitySummary }) {
  if (activity.state === "loaded" || activity.state === "empty") {
    return <span className="block truncate text-[12.5px] text-muted-foreground">{activity.label}</span>;
  }
  return <span className="block truncate text-[12.5px] text-(--faint)">{leadsCopy.detail.notLoaded}</span>;
}

/** Contact affordances for the detail panel. Both stay visible when present. */
export function LeadContactLinks({ row }: { row: LeadRow }) {
  return (
    <div className="flex flex-wrap gap-2">
      {row.email ? (
        <a
          href={"mailto:" + encodeURIComponent(row.email)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-(--line-heavy) px-3 text-[12.5px] font-bold transition-colors duration-150 hover:bg-(--surface-subtle) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Mail aria-hidden className="size-3.5" />
          {row.email}
        </a>
      ) : null}
      {row.phone ? (
        <a
          href={"tel:" + encodeURIComponent(row.phone.replace(/[()\s.-]/g, ""))}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-(--line-heavy) px-3 text-[12.5px] font-bold transition-colors duration-150 hover:bg-(--surface-subtle) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Phone aria-hidden className="size-3.5" />
          {row.phone}
        </a>
      ) : null}
    </div>
  );
}
