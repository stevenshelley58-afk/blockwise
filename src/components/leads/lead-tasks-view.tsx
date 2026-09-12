"use client";

/**
 * Tasks view.
 *
 * Tasks are grouped by how urgent their due time is. A task with no due time
 * is grouped separately rather than being quietly treated as due now.
 */

import { Clock } from "lucide-react";

import { leadsCopy } from "./copy.ts";
import { describeDue } from "./format.ts";
import { ListSkeleton } from "./states.tsx";
import { TaskList } from "./task-editor.tsx";
import { isOpenTask, type LeadRow, type LeadTask } from "./types.ts";

export type LeadTaskEntry = { task: LeadTask; lead: LeadRow | null };

export type LeadTasksViewProps = {
  entries: LeadTaskEntry[];
  loading: boolean;
  partial: boolean;
  onOpen: (leadId: string) => void;
  onComplete: (task: LeadTask) => void;
  onSnooze: (task: LeadTask, dueAt: string) => void;
  readOnly: boolean;
  busyId?: string | null;
  timeZone?: string;
};

export function LeadTasksView({
  entries,
  loading,
  partial,
  onOpen,
  onComplete,
  onSnooze,
  readOnly,
  busyId,
  timeZone,
}: LeadTasksViewProps) {
  if (loading && entries.length === 0) {
    return (
      <div className="grid gap-3">
        <p role="status" className="text-[12.5px] text-muted-foreground">
          {leadsCopy.tasks.loading}
        </p>
        <ListSkeleton rows={4} />
      </div>
    );
  }

  const open = entries.filter((entry) => isOpenTask(entry.task));
  const overdue: LeadTaskEntry[] = [];
  const today: LeadTaskEntry[] = [];
  const later: LeadTaskEntry[] = [];
  const undated: LeadTaskEntry[] = [];

  for (const entry of open) {
    const due = describeDue(entry.task.dueAt);
    if (!due) undated.push(entry);
    else if (due.overdue) overdue.push(entry);
    else if (due.soon) today.push(entry);
    else later.push(entry);
  }

  return (
    <div className="grid gap-4">
      {partial ? (
        <p role="status" className="text-[12.5px] text-muted-foreground">
          {leadsCopy.tasks.partial}
        </p>
      ) : null}

      <TaskGroup title={leadsCopy.tasks.overdue} entries={overdue} empty={null} {...{ onOpen, onComplete, onSnooze, readOnly, busyId, timeZone }} />
      <TaskGroup title={leadsCopy.tasks.dueToday} entries={today} empty={null} {...{ onOpen, onComplete, onSnooze, readOnly, busyId, timeZone }} />
      <TaskGroup title="Later" entries={later} empty={null} {...{ onOpen, onComplete, onSnooze, readOnly, busyId, timeZone }} />
      <TaskGroup title={leadsCopy.tasks.noDue} entries={undated} empty={leadsCopy.tasks.none} {...{ onOpen, onComplete, onSnooze, readOnly, busyId, timeZone }} />
    </div>
  );
}

type GroupProps = {
  title: string;
  entries: LeadTaskEntry[];
  empty: string | null;
  onOpen: (leadId: string) => void;
  onComplete: (task: LeadTask) => void;
  onSnooze: (task: LeadTask, dueAt: string) => void;
  readOnly: boolean;
  busyId?: string | null;
  timeZone?: string;
};

function TaskGroup({ title, entries, empty, onOpen, onComplete, onSnooze, readOnly, busyId, timeZone }: GroupProps) {
  if (entries.length === 0 && !empty) return null;

  const byLead = new Map<string, LeadTaskEntry[]>();
  for (const entry of entries) {
    const key = entry.lead?.id ?? entry.task.name;
    const list = byLead.get(key) ?? [];
    list.push(entry);
    byLead.set(key, list);
  }

  return (
    <section aria-label={title} className="grid gap-2">
      <h3 className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">{title}</h3>
      {entries.length === 0 && empty ? <p className="text-[12.5px] text-muted-foreground">{empty}</p> : null}

      {[...byLead.entries()].map(([key, group]) => {
        const lead = group[0].lead;
        return (
          <div key={key} className="rounded-(--r-card) border border-(--line) bg-(--surface) p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {lead ? (
                <button
                  type="button"
                  onClick={() => onOpen(lead.id)}
                  className="text-[13px] font-bold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {lead.name}
                </button>
              ) : (
                <span className="text-[13px] font-bold">{leadsCopy.detail.unknown}</span>
              )}
              {lead?.propertyContext ? (
                <span className="truncate text-[11.5px] text-muted-foreground">{lead.propertyContext}</span>
              ) : null}
            </div>
            <TaskList
              tasks={group.map((entry) => entry.task)}
              readOnly={readOnly}
              busyTaskId={busyId ?? null}
              onComplete={async (task) => onComplete(task)}
              onSnooze={async (task, dueAt) => onSnooze(task, dueAt)}
            />
          </div>
        );
      })}
    </section>
  );
}
