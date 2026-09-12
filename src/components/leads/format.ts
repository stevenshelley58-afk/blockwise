/**
 * Presentation helpers for the lead work application.
 *
 * Nothing here invents a fact. Unknown values render as an explicit "not
 * recorded" string, never as zero, never as a stage, and never as a metric.
 */

import { leadsCopy } from "./copy.ts";
import { isTerminalStage, type LeadRow, type LeadTask } from "./types.ts";

export const UNKNOWN = leadsCopy.detail.unknown;

export function stageLabel(stage: string): string {
  const known = leadsCopy.stages as Record<string, string>;
  return known[stage] ?? stage;
}

export function qualityLabel(quality: string): string {
  const known = leadsCopy.quality as Record<string, string>;
  return known[quality] ?? quality;
}

export function deliveryLabel(state: string): string {
  const known = leadsCopy.delivery as Record<string, string>;
  return known[state] ?? state;
}

export function deliveryHint(state: string): string | null {
  const known = leadsCopy.deliveryHint as Record<string, string>;
  return known[state] ?? null;
}

export type FormatOptions = { timeZone?: string };

function dateFormatter(options: FormatOptions, style: "datetime" | "date" | "time"): Intl.DateTimeFormat {
  const timeZone = options.timeZone ?? undefined;
  if (style === "datetime") {
    return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone });
  }
  if (style === "date") {
    return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeZone });
  }
  return new Intl.DateTimeFormat("en-AU", { timeStyle: "short", timeZone });
}

/** Returns null for a missing or unparseable timestamp so callers stay honest. */
export function formatDateTime(value: string | null | undefined, options: FormatOptions = {}): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return dateFormatter(options, "datetime").format(new Date(parsed));
}

export function formatDate(value: string | null | undefined, options: FormatOptions = {}): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return dateFormatter(options, "date").format(new Date(parsed));
}

export function formatTime(value: string | null | undefined, options: FormatOptions = {}): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return dateFormatter(options, "time").format(new Date(parsed));
}

export type DueState = { label: string; overdue: boolean; soon: boolean };

/** Due states are derived from the due time only. No open or read claims. */
export function describeDue(dueAt: string | null | undefined, now: Date = new Date()): DueState | null {
  if (!dueAt) return null;
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return null;
  const nowMs = now.getTime();
  const label = formatDateTime(dueAt) ?? UNKNOWN;
  if (due <= nowMs) return { label: leadsCopy.tasks.overdue + ". " + label, overdue: true, soon: true };
  const sameDay = new Date(due).toDateString() === now.toDateString();
  if (sameDay) return { label: leadsCopy.tasks.dueToday + ". " + label, overdue: false, soon: true };
  return { label: leadsCopy.tasks.dueOn(label), overdue: false, soon: false };
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export type NeedsActionReason = "overdue" | "uncontacted" | "unassigned" | "stale";

/**
 * Why an enquiry is in "Needs action". The reason is always shown, so the
 * list never asks an agent to guess what is wrong.
 */
export function needsActionReasons(row: LeadRow, options: { canSeeUnassigned: boolean }): NeedsActionReason[] {
  const reasons: NeedsActionReason[] = [];
  if (row.followUpDue && !isTerminalStage(row.stage)) reasons.push("overdue");
  if (row.stage === "New") reasons.push("uncontacted");
  if (options.canSeeUnassigned && !row.owner) reasons.push("unassigned");
  if (row.crmDeliveryState === "pending" || row.crmDeliveryState === "error") reasons.push("stale");
  return reasons;
}

export function reasonLabel(reason: NeedsActionReason): string {
  if (reason === "overdue") return leadsCopy.reasons.overdue;
  if (reason === "uncontacted") return leadsCopy.reasons.uncontacted;
  if (reason === "unassigned") return leadsCopy.reasons.unassigned;
  return leadsCopy.reasons.stale;
}

export function ownerLabel(row: LeadRow): string {
  return row.owner ? row.owner : leadsCopy.detail.noOwner;
}

/** Shortest useful description of the next task on an enquiry. */
export function nextActionLabel(row: LeadRow): string {
  if (!row.nextTask) return leadsCopy.tasks.none;
  const due = describeDue(row.nextTask.dueAt);
  if (!due) return row.nextTask.title;
  return row.nextTask.title + " (" + due.label + ")";
}

/**
 * CSV for the currently filtered rows. Lead names and addresses come from
 * lead forms, so a value opening with a formula character is neutralised with
 * a leading apostrophe before quoting.
 */
export function leadsToCsv(rows: LeadRow[], options: FormatOptions = {}): string {
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : String(value);
    const guarded = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
    return '"' + guarded.replaceAll('"', '""') + '"';
  };

  const header = [
    leadsCopy.columns.enquiry,
    "Email",
    "Phone",
    leadsCopy.detail.property,
    leadsCopy.columns.stage,
    leadsCopy.columns.owner,
    leadsCopy.detail.source,
    "Quality",
    "Duplicate warning",
    "CRM delivery",
    "Next task",
    "Next task due",
  ];

  const lines = rows.map((row) =>
    [
      row.name,
      row.email ?? "",
      row.phone ?? "",
      row.propertyContext ?? "",
      stageLabel(row.stage),
      row.owner ?? "",
      row.source,
      qualityLabel(row.quality),
      row.duplicateWarning ? "yes" : "no",
      deliveryLabel(row.crmDeliveryState),
      row.nextTask?.title ?? "",
      formatDateTime(row.nextTask?.dueAt ?? null, options) ?? "",
    ]
      .map(escape)
      .join(","),
  );

  return [header.map(escape).join(","), ...lines].join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function sortTasksByDue(tasks: LeadTask[]): LeadTask[] {
  return [...tasks].sort((a, b) => {
    const left = Date.parse(a.dueAt ?? "");
    const right = Date.parse(b.dueAt ?? "");
    const leftMs = Number.isFinite(left) ? left : Number.MAX_SAFE_INTEGER;
    const rightMs = Number.isFinite(right) ? right : Number.MAX_SAFE_INTEGER;
    return leftMs - rightMs;
  });
}
