"use client";

/**
 * Lead detail: contact, stage and owner, next action, tasks, reported activity
 * and the explicit agent actions.
 *
 * "Log contact" and "Log reply" stay separate because only the agent knows
 * which happened. "Email lead" and "Call" are launchers for the agent's own
 * tools; neither logs anything about the outcome.
 */

import { useState } from "react";
import { Mail, Phone, Plus, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { LeadApi } from "./api.ts";
import { ActivityTimeline } from "./activity-timeline.tsx";
import { leadsCopy } from "./copy.ts";
import { EmailDraftDialog } from "./email-draft-dialog.tsx";
import {
  deliveryHint,
  describeDue,
  formatDateTime,
  nextActionLabel,
  qualityLabel,
} from "./format.ts";
import { buildTelUrl } from "./mailto.ts";
import { AddTaskForm, TaskList } from "./task-editor.tsx";
import { StageControl } from "./stage-control.tsx";
import { DeliveryChip, DuplicateChip, ErrorCard, QualityChip, ReadOnlyBanner } from "./states.tsx";
import type { LeadActivity, LeadRow, LeadTask } from "./types.ts";

export type LeadDetailPanelProps = {
  lead: LeadRow;
  tasks: LeadTask[];
  activities: LeadActivity[];
  loading: boolean;
  error: { title: string; body: string; onRetry?: () => void } | null;
  api: LeadApi;
  readOnly: boolean;
  timeZone?: string;
  onStageChange: (stage: string) => void;
  onChanged: () => void;
  canReassign: boolean;
};

export function LeadDetailPanel({
  lead,
  tasks,
  activities,
  loading,
  error,
  api,
  readOnly,
  timeZone,
  onStageChange,
  onChanged,
  canReassign,
}: LeadDetailPanelProps) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState<"contact" | "reply" | null>(null);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ title: string; body: string } | null>(null);

  const telUrl = buildTelUrl(lead.phone);
  const due = lead.nextTask ? describeDue(lead.nextTask.dueAt) : null;
  const hint = deliveryHint(lead.crmDeliveryState);

  function fail(cause: unknown) {
    setActionError({ title: leadsCopy.states.saveFailedTitle, body: cause instanceof Error ? cause.message : leadsCopy.states.saveFailedBody });
  }

  async function completeTask(task: LeadTask) {
    setBusyTaskId(task.name);
    try {
      await api.updateTask(task.name, { status: "Done" });
      onChanged();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusyTaskId(null);
    }
  }

  async function snoozeTask(task: LeadTask, dueAt: string) {
    setBusyTaskId(task.name);
    try {
      await api.updateTask(task.name, { dueAt });
      onChanged();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusyTaskId(null);
    }
  }

  async function startCall() {
    try {
      await api.recordEvent(lead.id, "call_requested", "Agent started a call from Blockwise.");
    } catch {
      // The audit note is best effort. It must never block the call itself.
    }
  }

  return (
    <div className="grid gap-4">
      {readOnly ? (
        <ReadOnlyBanner title={leadsCopy.states.readOnlyBadge} body={leadsCopy.states.crmUnavailableBody} />
      ) : null}

      {error ? <ErrorCard title={error.title} body={error.body} onRetry={error.onRetry} /> : null}
      {actionError ? <ErrorCard title={actionError.title} body={actionError.body} onRetry={() => setActionError(null)} /> : null}

      <section aria-label={leadsCopy.detail.stage} className="grid gap-3 rounded-(--r-card) border border-(--line) bg-(--surface-subtle)/50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <StageControl stage={lead.stage} onChange={onStageChange} disabled={readOnly} />
          <span className="text-[12.5px] text-muted-foreground">
            {leadsCopy.columns.owner}: <span className="font-semibold text-foreground">{lead.owner ?? leadsCopy.detail.noOwner}</span>
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <QualityChip quality={lead.quality} />
            <DeliveryChip state={lead.crmDeliveryState} />
            {lead.duplicateWarning ? <DuplicateChip /> : null}
          </span>
        </div>
        <div className="text-[12.5px]">
          <p className="font-semibold">{leadsCopy.detail.nextAction}</p>
          <p className={"mt-0.5 " + (due?.overdue ? "font-bold text-error" : "text-muted-foreground")}>{nextActionLabel(lead)}</p>
        </div>
        {hint ? <p className="text-[12px] leading-relaxed text-muted-foreground">{hint}</p> : null}
      </section>

      <section aria-label={leadsCopy.detail.contact} className="grid gap-2">
        <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">{leadsCopy.detail.contact}</p>
        <div className="flex flex-wrap gap-2">
          {lead.email ? (
            <a
              href={"mailto:" + encodeURIComponent(lead.email)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-(--line-heavy) px-3 text-[12.5px] font-bold transition-colors duration-150 hover:bg-(--surface-subtle) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Mail aria-hidden className="size-3.5" />
              <span className="max-w-[220px] truncate">{lead.email}</span>
            </a>
          ) : null}
          {telUrl ? (
            <a
              href={telUrl}
              onClick={startCall}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-(--line-heavy) px-3 text-[12.5px] font-bold transition-colors duration-150 hover:bg-(--surface-subtle) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Phone aria-hidden className="size-3.5" />
              {lead.phone}
            </a>
          ) : lead.phone ? (
            <span className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-(--line) px-3 text-[12.5px] text-muted-foreground">
              <Phone aria-hidden className="size-3.5" />
              {lead.phone}
            </span>
          ) : null}
        </div>
        {telUrl ? <p className="text-[12px] leading-relaxed text-muted-foreground">{leadsCopy.call.note}</p> : null}
        <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
          <dt className="text-muted-foreground">{leadsCopy.detail.property}</dt>
          <dd className="truncate">{lead.propertyContext ?? leadsCopy.detail.unknown}</dd>
          <dt className="text-muted-foreground">{leadsCopy.detail.source}</dt>
          <dd className="truncate">{lead.source}</dd>
          <dt className="text-muted-foreground">Quality</dt>
          <dd className="truncate">{qualityLabel(lead.quality)}</dd>
          <dt className="text-muted-foreground">Received</dt>
          <dd className="truncate">{formatDateTime(lead.receivedAt, { timeZone }) ?? leadsCopy.detail.unknown}</dd>
        </dl>
      </section>

      <section aria-label={leadsCopy.actions.email} className="grid gap-2">
        <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">Actions</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="default" size="pill" onClick={() => setEmailOpen(true)} disabled={!lead.email}>
            <Mail aria-hidden className="size-3.5" />
            {leadsCopy.actions.email}
          </Button>
          <Button type="button" variant="ghost-pill" size="pill" onClick={() => setContactOpen("contact")} disabled={readOnly}>
            <Phone aria-hidden className="size-3.5" />
            {leadsCopy.actions.logContact}
          </Button>
          <Button type="button" variant="ghost-pill" size="pill" onClick={() => setContactOpen("reply")} disabled={readOnly}>
            <Mail aria-hidden className="size-3.5" />
            {leadsCopy.actions.logReply}
          </Button>
          <Button type="button" variant="ghost-pill" size="pill" onClick={() => setAddTaskOpen((open) => !open)} disabled={readOnly}>
            <Plus aria-hidden className="size-3.5" />
            {leadsCopy.actions.addTask}
          </Button>
          <Button type="button" variant="ghost-pill" size="pill" onClick={() => setOutcomeOpen(true)} disabled={readOnly}>
            <Trophy aria-hidden className="size-3.5" />
            {leadsCopy.actions.outcome}
          </Button>
        </div>

        {addTaskOpen && !readOnly ? (
          <AddTaskForm
            disabled={readOnly}
            onCreate={async (input) => {
              try {
                await api.createTask(lead.id, input);
                setAddTaskOpen(false);
                onChanged();
              } catch (cause) {
                fail(cause);
              }
            }}
          />
        ) : null}
      </section>

      <section aria-label={leadsCopy.tasks.title} className="grid gap-2">
        <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">{leadsCopy.tasks.title}</p>
        {loading && tasks.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">{leadsCopy.states.loadingDetail}</p>
        ) : (
          <TaskList
            tasks={tasks}
            busyTaskId={busyTaskId}
            readOnly={readOnly}
            onComplete={completeTask}
            onSnooze={snoozeTask}
          />
        )}
      </section>

      <section aria-label={leadsCopy.activity.title} className="grid gap-2">
        <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">{leadsCopy.activity.title}</p>
        {loading && activities.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">{leadsCopy.states.loadingDetail}</p>
        ) : (
          <ActivityTimeline activities={activities} timeZone={timeZone} />
        )}
      </section>

      {lead.email ? (
        <EmailDraftDialog
          open={emailOpen}
          onClose={() => setEmailOpen(false)}
          lead={lead}
          api={api}
          defaultSubject={"Your enquiry"}
          defaultBody={"Hi " + lead.name.split(" ")[0] + ",\n\nThanks for getting in touch.\n\n"}
        />
      ) : null}

      <LogActivityDialog
        open={contactOpen !== null}
        kind={contactOpen ?? "contact"}
        onClose={() => setContactOpen(null)}
        api={api}
        leadId={lead.id}
        onLogged={onChanged}
        onError={fail}
        withFollowUp={contactOpen === "contact"}
      />

      <OutcomeDialog
        open={outcomeOpen}
        onClose={() => setOutcomeOpen(false)}
        api={api}
        leadId={lead.id}
        onRecorded={onChanged}
        onError={fail}
      />
    </div>
  );
}

function LogActivityDialog({
  open,
  kind,
  onClose,
  api,
  leadId,
  onLogged,
  onError,
  withFollowUp,
}: {
  open: boolean;
  kind: "contact" | "reply";
  onClose: () => void;
  api: LeadApi;
  leadId: string;
  onLogged: () => void;
  onError: (cause: unknown) => void;
  withFollowUp: boolean;
}) {
  const [note, setNote] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.logActivity(leadId, kind, {
        note: note.trim() || null,
        nextFollowUpAt: withFollowUp && followUpAt ? new Date(followUpAt).toISOString() : null,
      });
      setNote("");
      setFollowUpAt("");
      onLogged();
      onClose();
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{kind === "contact" ? leadsCopy.contact.logContactTitle : leadsCopy.contact.logReplyTitle}</DialogTitle>
          <DialogDescription>{kind === "contact" ? leadsCopy.contact.logContactHint : leadsCopy.contact.logReplyHint}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="lead-log-note" className="text-[12.5px]">
              {leadsCopy.contact.notePlaceholder}
            </Label>
            <Input id="lead-log-note" value={note} onChange={(event) => setNote(event.target.value)} className="h-10" />
          </div>
          {withFollowUp ? (
            <div className="grid gap-1.5">
              <Label htmlFor="lead-log-followup" className="text-[12.5px]">
                {leadsCopy.contact.followUpAt}
              </Label>
              <Input
                id="lead-log-followup"
                type="datetime-local"
                value={followUpAt}
                onChange={(event) => setFollowUpAt(event.target.value)}
                className="h-10"
              />
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost-pill" size="pill" onClick={onClose} disabled={busy}>
            {leadsCopy.actions.cancel}
          </Button>
          <Button type="button" variant="default" size="pill" onClick={submit} disabled={busy}>
            {leadsCopy.actions.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OutcomeDialog({
  open,
  onClose,
  api,
  leadId,
  onRecorded,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  api: LeadApi;
  leadId: string;
  onRecorded: () => void;
  onError: (cause: unknown) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function record(outcome: "Won" | "Lost") {
    if (outcome === "Lost" && !reason.trim()) {
      setLocalError(leadsCopy.outcome.lostReasonRequired);
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      await api.recordOutcome(leadId, outcome, outcome === "Lost" ? reason.trim() : null);
      setReason("");
      onRecorded();
      onClose();
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{leadsCopy.outcome.title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="lead-outcome-reason" className="text-[12.5px]">
              {leadsCopy.outcome.lostReason}
            </Label>
            <Input
              id="lead-outcome-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={leadsCopy.outcome.lostReasonPlaceholder}
              className="h-10"
            />
          </div>
          {localError ? (
            <p role="alert" className="text-[12.5px] text-error">
              {localError}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost-pill" size="pill" onClick={onClose} disabled={busy}>
            {leadsCopy.actions.cancel}
          </Button>
          <Button type="button" variant="ghost-pill" size="pill" onClick={() => record("Lost")} disabled={busy}>
            {leadsCopy.outcome.lost}
          </Button>
          <Button type="button" variant="default" size="pill" onClick={() => record("Won")} disabled={busy}>
            {leadsCopy.outcome.won}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
