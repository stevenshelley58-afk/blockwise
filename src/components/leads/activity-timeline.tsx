"use client";

/**
 * Activity timeline.
 *
 * Every entry is presented as something an agent reported. Blockwise cannot
 * observe email delivery, opens or automatic responses, so no entry ever
 * claims one. A missing actor or timestamp reads as unknown, never as a fact.
 */

import { leadsCopy } from "./copy.ts";
import { formatDateTime } from "./format.ts";
import type { LeadActivity } from "./types.ts";

const TYPE_LABELS: Record<string, string> = {
  contact: "Contact reported",
  reply: "Reply reported",
  note: "Note",
  email_app_launch_requested: "Mail app opened from Blockwise",
  call_requested: "Call started from Blockwise",
  creation: "Enquiry created",
  stage: "Stage changed",
  assignment: "Owner changed",
  outcome: "Outcome recorded",
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? humanize(type);
}

function humanize(value: string): string {
  const spaced = value.replace(/[._-]+/g, " ").trim();
  if (!spaced) return "Activity";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function ActivityTimeline({ activities, timeZone }: { activities: LeadActivity[]; timeZone?: string }) {
  if (activities.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground">{leadsCopy.activity.empty}</p>;
  }

  const ordered = [...activities].sort((a, b) => {
    const left = Date.parse(b.occurredAt ?? b.recordedAt ?? "");
    const right = Date.parse(a.occurredAt ?? a.recordedAt ?? "");
    const leftMs = Number.isFinite(left) ? left : 0;
    const rightMs = Number.isFinite(right) ? right : 0;
    return leftMs - rightMs;
  });

  return (
    <ol className="grid gap-3">
      {ordered.map((activity) => {
        const when = formatDateTime(activity.occurredAt ?? activity.recordedAt, { timeZone });
        const actor = activity.actor?.trim() ? activity.actor : leadsCopy.activity.unknownActor;
        return (
          <li key={activity.name} className="relative border-l border-(--line) pl-4">
            <span aria-hidden className="absolute top-1.5 left-[-4.5px] size-2 rounded-full bg-(--line-heavy)" />
            <p className="text-[13px] font-bold">{typeLabel(activity.type)}</p>
            <p className="text-[12px] text-muted-foreground">
              {leadsCopy.activity.reportedBy(actor, when ?? leadsCopy.activity.unknownTime)}
            </p>
            {activity.note ? (
              <p className="mt-1 text-[12.5px] leading-relaxed whitespace-pre-line text-foreground">
                <span className="sr-only">{leadsCopy.activity.noteLabel}: </span>
                {activity.note}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** One-line summary of the latest reported activity, for list rows. */
export function latestActivityLabel(activities: LeadActivity[], timeZone?: string): string | null {
  if (activities.length === 0) return null;
  const ordered = [...activities].sort((a, b) => {
    const left = Date.parse(b.occurredAt ?? b.recordedAt ?? "");
    const right = Date.parse(a.occurredAt ?? a.recordedAt ?? "");
    return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
  });
  const latest = ordered[0];
  const when = formatDateTime(latest.occurredAt ?? latest.recordedAt, { timeZone });
  return typeLabel(latest.type) + (when ? ", " + when : "");
}
