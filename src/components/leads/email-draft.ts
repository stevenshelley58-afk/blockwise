/**
 * The "Email lead" behaviour, kept out of React on purpose.
 *
 * Opening a mail draft is audit-only. It must never mark an enquiry contacted
 * and must never complete a task, because a server cannot observe whether an
 * agent actually sent anything from their own mail app. Keeping the behaviour
 * in a plain module means a test can run it against a recording transport and
 * assert the exact set of requests it produced.
 */

import type { LeadApi } from "./api.ts";
import { buildMailtoUrl, isMailtoTooLong, type EmailDraft } from "./mailto.ts";

export const EMAIL_DRAFT_EVENT = "email_app_launch_requested" as const;

export type EmailDraftAuditMode = "opened" | "copied" | "cancelled";

export type EmailDraftOutcome =
  | { status: "opened"; url: string; audited: boolean }
  | { status: "too_long"; url: string; audited: boolean }
  | { status: "rejected"; reason: "recipient"; audited: boolean };

export function emailDraftNote(mode: EmailDraftAuditMode): string {
  if (mode === "opened") return "Agent opened their own mail app from Blockwise.";
  if (mode === "copied") return "Agent copied the address or message into their own mail app.";
  return "Agent opened the email draft and closed it without opening a mail app.";
}

/**
 * Opens the agent's own mail app. The only request this ever makes is the
 * audit-only event below; there is deliberately no stage or task call here.
 */
export async function openEmailDraft(input: {
  leadId: string;
  draft: EmailDraft;
  api: LeadApi;
  open: (url: string) => void;
}): Promise<EmailDraftOutcome> {
  const url = buildMailtoUrl(input.draft);
  if (!url) return { status: "rejected", reason: "recipient", audited: false };
  if (isMailtoTooLong(url)) return { status: "too_long", url, audited: false };

  input.open(url);

  const audited = await auditEmailDraft({ leadId: input.leadId, mode: "opened", api: input.api });
  return { status: "opened", url, audited };
}

/** Records the audit note. A failure here never blocks the draft itself. */
export async function auditEmailDraft(input: {
  leadId: string;
  mode: EmailDraftAuditMode;
  api: LeadApi;
}): Promise<boolean> {
  try {
    await input.api.recordEvent(input.leadId, EMAIL_DRAFT_EVENT, emailDraftNote(input.mode));
    return true;
  } catch {
    return false;
  }
}
