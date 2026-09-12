"use client";

/**
 * The "Email lead" draft helper.
 *
 * It opens the agent's own mail app with an editable draft. It never claims
 * Blockwise sent, delivered or tracked anything, and it never marks the
 * enquiry contacted or completes a task. Opening, copying and closing are
 * audit-only.
 */

import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Mail } from "lucide-react";

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
import { leadsCopy } from "./copy.ts";
import { auditEmailDraft, openEmailDraft } from "./email-draft.ts";
import { buildMailtoUrl, isMailtoTooLong, normalizeRecipient } from "./mailto.ts";
import type { LeadRow } from "./types.ts";

export type EmailDraftDialogProps = {
  open: boolean;
  onClose: () => void;
  lead: LeadRow;
  api: LeadApi;
  defaultSubject: string;
  defaultBody: string;
};

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

export function EmailDraftDialog({ open, onClose, lead, api, defaultSubject, defaultBody }: EmailDraftDialogProps) {
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubject(defaultSubject);
    setBody(defaultBody);
    setStatus(null);
  }, [open, defaultSubject, defaultBody]);

  const recipient = useMemo(() => normalizeRecipient(lead.email), [lead.email]);
  const url = useMemo(
    () => buildMailtoUrl({ to: lead.email, subject, body }),
    [lead.email, subject, body],
  );
  const tooLong = url ? isMailtoTooLong(url) : false;

  function close() {
    void auditEmailDraft({ leadId: lead.id, mode: "cancelled", api });
    onClose();
  }

  async function openMailApp() {
    if (!url) {
      setStatus(leadsCopy.email.rejectedRecipient);
      return;
    }
    if (tooLong) {
      setStatus(leadsCopy.email.tooLong);
      return;
    }
    setBusy(true);
    const outcome = await openEmailDraft({
      leadId: lead.id,
      draft: { to: lead.email, subject, body },
      api,
      open: (href) => {
        window.location.href = href;
      },
    });
    setBusy(false);
    if (outcome.status === "opened") setStatus(leadsCopy.email.opened);
    if (outcome.status === "rejected") setStatus(leadsCopy.email.rejectedRecipient);
    if (outcome.status === "too_long") setStatus(leadsCopy.email.tooLong);
  }

  async function copyAddress() {
    if (!lead.email) return;
    await copyText(lead.email);
    void auditEmailDraft({ leadId: lead.id, mode: "copied", api });
    setStatus(leadsCopy.email.copiedAddress);
  }

  async function copyMessage() {
    await copyText("Subject: " + subject + "\n\n" + body);
    void auditEmailDraft({ leadId: lead.id, mode: "copied", api });
    setStatus(leadsCopy.email.copiedMessage);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{leadsCopy.email.dialogTitle}</DialogTitle>
          <DialogDescription>{leadsCopy.email.dialogIntro}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="lead-email-to" className="text-[12.5px]">
              {leadsCopy.email.to}
            </Label>
            <Input id="lead-email-to" value={lead.email ?? ""} readOnly className="h-10 bg-(--surface-subtle)" />
            {!recipient ? (
              <p role="alert" className="text-[12.5px] text-error">
                {leadsCopy.email.rejectedRecipient}
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="lead-email-subject" className="text-[12.5px]">
              {leadsCopy.email.subject}
            </Label>
            <Input
              id="lead-email-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="h-10"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="lead-email-body" className="text-[12.5px]">
              {leadsCopy.email.message}
            </Label>
            <textarea
              id="lead-email-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={7}
              className="min-h-32 w-full rounded-(--r-card) border border-(--line) bg-(--surface) px-3 py-2 text-[13px] leading-relaxed outline-none focus-visible:border-(--ink) focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {tooLong ? (
            <p role="alert" className="text-[12.5px] text-warning">
              {leadsCopy.email.tooLong}
            </p>
          ) : null}

          <p className="text-[12px] leading-relaxed text-muted-foreground">{leadsCopy.email.auditOnly}</p>

          {status ? (
            <p role="status" className="text-[12.5px] font-semibold text-success">
              {status}
            </p>
          ) : null}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button type="button" variant="ghost-pill" size="pill" onClick={copyAddress} disabled={!lead.email}>
            <Copy aria-hidden className="size-3.5" />
            {leadsCopy.actions.copyEmail}
          </Button>
          <Button type="button" variant="ghost-pill" size="pill" onClick={copyMessage}>
            <Copy aria-hidden className="size-3.5" />
            {leadsCopy.actions.copyMessage}
          </Button>
          <Button type="button" variant="default" size="pill" onClick={openMailApp} disabled={busy || !recipient || tooLong}>
            <Mail aria-hidden className="size-3.5" />
            {leadsCopy.actions.openMailApp}
            <ExternalLink aria-hidden className="size-3" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
