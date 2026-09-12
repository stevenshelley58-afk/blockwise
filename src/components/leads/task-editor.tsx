"use client";

/**
 * Task editor primitives: add a task, snooze a task, and the task list.
 *
 * Snoozing always needs a new due time. Completing a task is an explicit agent
 * action; nothing in this file completes one as a side effect of something
 * else.
 */

import { useEffect, useState } from "react";
import { Check, Clock, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { leadsCopy } from "./copy.ts";
import { describeDue } from "./format.ts";
import { isOpenTask, type LeadTask } from "./types.ts";

const PURPOSES = ["first_contact", "follow_up", "respond", "appointment", "other"] as const;

function purposeLabel(purpose: string): string {
  if (purpose === "first_contact") return "First contact";
  if (purpose === "follow_up") return "Follow up";
  if (purpose === "respond") return "Respond";
  if (purpose === "appointment") return "Appointment";
  return "Other";
}

function toLocalInputValue(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (input: number) => String(input).padStart(2, "0");
  return (
    parsed.getFullYear() +
    "-" +
    pad(parsed.getMonth() + 1) +
    "-" +
    pad(parsed.getDate()) +
    "T" +
    pad(parsed.getHours()) +
    ":" +
    pad(parsed.getMinutes())
  );
}

export function AddTaskForm({
  onCreate,
  disabled = false,
}: {
  onCreate: (input: { title: string; purpose: string; dueAt: string | null }) => Promise<void>;
  disabled?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState<string>("follow_up");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) {
      setError("A task needs a short title.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate({ title: title.trim(), purpose, dueAt: dueAt ? new Date(dueAt).toISOString() : null });
      setTitle("");
      setDueAt("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : leadsCopy.states.saveFailedBody);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2.5 rounded-(--r-card) border border-(--line) bg-(--surface-subtle)/60 p-3">
      <div className="grid gap-1.5">
        <Label htmlFor="lead-task-title" className="text-[12.5px]">
          {leadsCopy.tasks.taskTitle}
        </Label>
        <Input
          id="lead-task-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={leadsCopy.tasks.taskTitlePlaceholder}
          disabled={disabled || busy}
          className="h-10"
        />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="lead-task-purpose" className="text-[12.5px]">
            {leadsCopy.tasks.purpose}
          </Label>
          <Select value={purpose} onValueChange={setPurpose} disabled={disabled || busy}>
            <SelectTrigger id="lead-task-purpose" className="h-10 w-full text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PURPOSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {purposeLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lead-task-due" className="text-[12.5px]">
            {leadsCopy.tasks.dueAt}
          </Label>
          <Input
            id="lead-task-due"
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            disabled={disabled || busy}
            className="h-10"
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-[12.5px] text-error">
          {error}
        </p>
      ) : null}
      <Button type="button" variant="ghost-pill" size="pill" onClick={submit} disabled={disabled || busy} className="justify-self-start">
        <Plus aria-hidden className="size-3.5" />
        {leadsCopy.actions.addTask}
      </Button>
    </div>
  );
}

export function SnoozeForm({
  currentDueAt,
  onSnooze,
  onCancel,
  disabled = false,
}: {
  currentDueAt: string | null;
  onSnooze: (dueAt: string) => Promise<void>;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const [dueAt, setDueAt] = useState(() => toLocalInputValue(currentDueAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDueAt(toLocalInputValue(currentDueAt));
  }, [currentDueAt]);

  async function submit() {
    if (!dueAt) {
      setError(leadsCopy.tasks.snoozeHint);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSnooze(new Date(dueAt).toISOString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : leadsCopy.states.saveFailedBody);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2.5 rounded-(--r-card) border border-(--line) bg-(--surface-subtle)/60 p-3">
      <p className="text-[12.5px] font-bold">{leadsCopy.tasks.snoozeTitle}</p>
      <div className="grid gap-1.5">
        <Label htmlFor="lead-task-snooze" className="text-[12.5px]">
          {leadsCopy.tasks.snoozeHint}
        </Label>
        <Input
          id="lead-task-snooze"
          type="datetime-local"
          value={dueAt}
          onChange={(event) => setDueAt(event.target.value)}
          disabled={disabled || busy}
          className="h-10"
        />
      </div>
      {error ? (
        <p role="alert" className="text-[12.5px] text-error">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="default" size="pill" onClick={submit} disabled={disabled || busy}>
          {leadsCopy.actions.snooze}
        </Button>
        <Button type="button" variant="ghost-pill" size="pill" onClick={onCancel} disabled={busy}>
          {leadsCopy.actions.cancel}
        </Button>
      </div>
    </div>
  );
}

export function TaskList({
  tasks,
  onComplete,
  onSnooze,
  busyTaskId,
  readOnly = false,
}: {
  tasks: LeadTask[];
  onComplete: (task: LeadTask) => Promise<void>;
  onSnooze: (task: LeadTask, dueAt: string) => Promise<void>;
  busyTaskId?: string | null;
  readOnly?: boolean;
}) {
  const [snoozing, setSnoozing] = useState<string | null>(null);

  if (tasks.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground">{leadsCopy.tasks.none}</p>;
  }

  return (
    <ul className="grid gap-2" aria-label={leadsCopy.a11y.taskList}>
      {tasks.map((task) => {
        const open = isOpenTask(task);
        const due = describeDue(task.dueAt);
        const busy = busyTaskId === task.name;
        return (
          <li key={task.name} className="rounded-(--r-card) border border-(--line) bg-(--surface) p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={"text-[13px] font-bold " + (open ? "" : "text-muted-foreground line-through")}>{task.title}</p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {purposeLabel(task.purpose ?? "other")}
                  {" · "}
                  {task.status}
                </p>
                {due ? (
                  <p className={"mt-0.5 inline-flex items-center gap-1 text-[11.5px] " + (due.overdue ? "font-bold text-error" : "text-muted-foreground")}>
                    <Clock aria-hidden className="size-3" />
                    {due.label}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11.5px] text-(--faint)">{leadsCopy.tasks.noDue}</p>
                )}
              </div>
              {open && !readOnly ? (
                <Button
                  type="button"
                  variant="ghost-pill"
                  size="pill"
                  onClick={() => onComplete(task)}
                  disabled={busy}
                  aria-label={leadsCopy.actions.complete + ": " + task.title}
                >
                  <Check aria-hidden className="size-3.5" />
                  {leadsCopy.actions.complete}
                </Button>
              ) : null}
            </div>

            {open && !readOnly ? (
              snoozing === task.name ? (
                <div className="mt-2.5">
                  <SnoozeForm
                    currentDueAt={task.dueAt}
                    disabled={busy}
                    onCancel={() => setSnoozing(null)}
                    onSnooze={async (dueAt) => {
                      await onSnooze(task, dueAt);
                      setSnoozing(null);
                    }}
                  />
                </div>
              ) : (
                <Button type="button" variant="ghost-pill" size="xs" className="mt-2" onClick={() => setSnoozing(task.name)}>
                  <Clock aria-hidden className="size-3" />
                  {leadsCopy.actions.snooze}
                </Button>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
