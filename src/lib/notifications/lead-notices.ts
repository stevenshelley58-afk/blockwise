/**
 * Agent notification producer (LM-08).
 *
 * Exactly two kinds of notice exist: a new-lead notice and a follow-up-due
 * digest. Both are sent only to a verified member of the workspace that owns
 * the enquiry. A recipient always comes from the workspace member record; a
 * lead address, a browser payload or a CRM lead field can never become one.
 *
 * Every notice is registered durably in lead_notice_records before it is
 * handed to the durable email outbox, and it can be cancelled before send.
 * The email body carries a short notice and an authenticated link only - no
 * contact records.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CrmCommands } from "../crm/commands.ts";
import { isCrmError } from "../crm/errors.ts";
import { isCrmOpenTaskStatus, isCrmTerminalStage, type CrmTask } from "../crm/types.ts";
import { escapeHtml } from "../email/provider.ts";
import { enqueueEmail } from "../email/outbox.ts";

export const LEAD_NOTICE_KINDS = ["new_lead", "follow_up_due_digest"] as const;
export type LeadNoticeKind = (typeof LEAD_NOTICE_KINDS)[number];

export const LEAD_NOTICE_MESSAGE_TYPE: Record<LeadNoticeKind, string> = {
  new_lead: "lead_notice_new_lead",
  follow_up_due_digest: "lead_notice_follow_up_digest",
};

export type LeadNoticeStatus = "pending" | "hold" | "queued" | "cancelled" | "suppressed";

export type LeadNoticeResult =
  | { status: "queued"; noticeId: string; outboxId: string | null }
  | { status: "duplicate"; noticeId: string | null }
  | { status: "hold"; noticeId: string; reason: string }
  | { status: "suppressed"; noticeId: string; reason: string }
  | { status: "cancelled"; noticeId: string | null; reason: string };

export class LeadNoticeRecipientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadNoticeRecipientError";
  }
}

export type WorkspaceMemberRecipient = {
  profileId: string;
  email: string;
  fullName: string | null;
};

type NoticeRow = {
  id: string;
  idempotency_key: string;
  status: LeadNoticeStatus;
  outbox_idempotency_key: string | null;
};

type MemberProfile = {
  id?: string | null;
  email?: string | null;
  full_name?: string | null;
  notification_preferences?: Record<string, boolean> | null;
};

type MemberRow = {
  profile_id?: string | null;
  role?: string | null;
  profiles?: MemberProfile | MemberProfile[] | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalised comparison so a recipient check cannot be defeated by casing. */
export function normalizeNoticeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Resolve a notice recipient from the current authorized workspace member
 * record. forbiddenEmails holds lead contact addresses; a member whose email
 * matches one is rejected rather than mailed.
 */
export async function resolveWorkspaceMemberRecipient(
  supabase: SupabaseClient,
  input: { workspaceId: string; profileId: string; forbiddenEmails?: readonly string[] },
): Promise<WorkspaceMemberRecipient> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("profile_id, role, profiles(id, email, full_name, notification_preferences)")
    .eq("workspace_id", input.workspaceId)
    .eq("profile_id", input.profileId)
    .maybeSingle();

  if (error) {
    throw new LeadNoticeRecipientError("workspace member lookup failed: " + error.message);
  }

  const row = (data ?? null) as MemberRow | null;
  const profile = Array.isArray(row?.profiles) ? row?.profiles[0] : row?.profiles;

  if (!row?.profile_id || !profile?.id) {
    throw new LeadNoticeRecipientError("Notice recipient is not a member of this workspace.");
  }

  const email = profile.email?.trim() ?? "";
  if (!EMAIL_PATTERN.test(email)) {
    throw new LeadNoticeRecipientError("Notice recipient has no valid member email address.");
  }

  const forbidden = new Set((input.forbiddenEmails ?? []).map(normalizeNoticeEmail).filter(Boolean));
  if (forbidden.has(normalizeNoticeEmail(email))) {
    throw new LeadNoticeRecipientError("A lead contact address must never be a notice recipient.");
  }

  const preferences = profile.notification_preferences ?? {};
  if (preferences.leadAlerts === false) {
    throw new LeadNoticeRecipientError("This member has turned lead alerts off.");
  }

  return { profileId: profile.id, email, fullName: profile.full_name?.trim() || null };
}

/**
 * Members eligible for a new-lead notice: the assigned agent when the CRM
 * owner maps to a member, plus workspace owners and admins. Every candidate is
 * resolved from the member record and validated against the lead's contacts.
 */
export async function resolveNewLeadRecipients(
  supabase: SupabaseClient,
  input: { workspaceId: string; crmOwner: string | null; leadEmails: readonly string[] },
): Promise<WorkspaceMemberRecipient[]> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("profile_id, role, profiles(id, email, full_name, notification_preferences)")
    .eq("workspace_id", input.workspaceId);

  if (error) {
    throw new LeadNoticeRecipientError("workspace member lookup failed: " + error.message);
  }

  const rows = (data ?? []) as MemberRow[];
  const ownerEmail = normalizeNoticeEmail(input.crmOwner);
  const recipients: WorkspaceMemberRecipient[] = [];

  for (const row of rows) {
    const isOwnerOrAdmin = row.role === "owner" || row.role === "admin";
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const memberEmail = normalizeNoticeEmail(profile?.email);
    const isAssigned = ownerEmail !== "" && memberEmail === ownerEmail;

    if (!isOwnerOrAdmin && !isAssigned) continue;
    if (!row.profile_id) continue;

    try {
      recipients.push(
        await resolveWorkspaceMemberRecipient(supabase, {
          workspaceId: input.workspaceId,
          profileId: row.profile_id,
          forbiddenEmails: input.leadEmails,
        }),
      );
    } catch (cause) {
      if (cause instanceof LeadNoticeRecipientError) continue;
      throw cause;
    }
  }

  return dedupeRecipients(recipients);
}

function dedupeRecipients(recipients: WorkspaceMemberRecipient[]): WorkspaceMemberRecipient[] {
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const key = normalizeNoticeEmail(recipient.email);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type ProduceNewLeadNoticeInput = {
  supabase: SupabaseClient;
  commands: CrmCommands;
  workspaceId: string;
  enquiry: string;
  /** Profile ids resolved by resolveNewLeadRecipients. */
  recipientProfileIds: readonly string[];
  backfill?: boolean;
};

/**
 * Produce new-lead notices for one captured enquiry. Backfill runs produce
 * nothing: a historical import must not generate first-contact reminders.
 */
export async function produceNewLeadNotices(input: ProduceNewLeadNoticeInput): Promise<LeadNoticeResult[]> {
  if (input.backfill === true) return [];

  const lead = await input.commands.getLead(input.enquiry);
  if (isCrmTerminalStage(lead.stage) || lead.archived) return [];

  const leadEmails = [lead.email].filter((value): value is string => Boolean(value));
  const results: LeadNoticeResult[] = [];

  for (const profileId of input.recipientProfileIds) {
    results.push(await produceOneNewLeadNotice(input, profileId, leadEmails));
  }
  return results;
}

async function produceOneNewLeadNotice(
  input: ProduceNewLeadNoticeInput,
  profileId: string,
  leadEmails: readonly string[],
): Promise<LeadNoticeResult> {
  let recipient: WorkspaceMemberRecipient;
  try {
    recipient = await resolveWorkspaceMemberRecipient(input.supabase, {
      workspaceId: input.workspaceId,
      profileId,
      forbiddenEmails: leadEmails,
    });
  } catch (error) {
    if (error instanceof LeadNoticeRecipientError) {
      return { status: "cancelled", noticeId: null, reason: error.message };
    }
    throw error;
  }

  const idempotencyKey =
    "lead-notice:" + input.workspaceId + ":" + input.enquiry + ":" + recipient.profileId + ":new_lead";
  const notice = await registerNotice(input.supabase, {
    workspaceId: input.workspaceId,
    idempotencyKey,
    kind: "new_lead",
    recipientProfileId: recipient.profileId,
    recipientEmail: recipient.email,
    enquiry: input.enquiry,
  });

  if (notice.duplicate) return { status: "duplicate", noticeId: notice.row?.id ?? null };
  if (!notice.row) return { status: "cancelled", noticeId: null, reason: "notice registration failed" };

  try {
    // Re-check eligibility through the CRM immediately before dispatch.
    const lead = await input.commands.getLead(input.enquiry);
    if (isCrmTerminalStage(lead.stage) || lead.archived) {
      await settleNotice(input.supabase, notice.row.id, "cancelled", "enquiry_reached_terminal_state");
      return { status: "cancelled", noticeId: notice.row.id, reason: "enquiry_reached_terminal_state" };
    }
  } catch (error) {
    if (!isCrmError(error)) throw error;
    // The CRM is unavailable: hold the notice rather than send a stale alert.
    await settleNotice(input.supabase, notice.row.id, "hold", error.code);
    return { status: "hold", noticeId: notice.row.id, reason: error.code };
  }

  return dispatchNotice(input.supabase, {
    notice: notice.row,
    kind: "new_lead",
    recipient,
    subject: "New enquiry waiting in Blockwise",
    intro: "A new enquiry was captured and assigned in your workspace.",
    link: enquiryLink(input.workspaceId, input.enquiry),
    actionLabel: "Open the enquiry",
  });
}

export type ProduceFollowUpDueDigestInput = {
  supabase: SupabaseClient;
  commands: CrmCommands;
  workspaceId: string;
  recipientProfileId: string;
  /** Local calendar date, YYYY-MM-DD, in the agency timezone. */
  localDate: string;
  now?: Date;
};

/**
 * Produce the single follow-up-due digest for one member for one local day.
 * An empty digest is suppressed. This is the only task-reminder producer in
 * Blockwise; no native Frappe reminder is active for this scope.
 */
export async function produceFollowUpDueDigest(input: ProduceFollowUpDueDigestInput): Promise<LeadNoticeResult> {
  const idempotencyKey =
    "lead-notice:" +
    input.workspaceId +
    ":" +
    input.recipientProfileId +
    ":" +
    input.localDate +
    ":follow_up_due_digest";

  let dueTasks: CrmTask[];
  try {
    dueTasks = await loadDueTasks(input.commands, input.now ?? new Date());
  } catch (error) {
    if (!isCrmError(error)) throw error;
    return { status: "hold", noticeId: "", reason: error.code };
  }

  const assigned = dueTasks.filter((task) => task.assignedTo && task.referenceDocname);
  const enquiryNames = [...new Set(assigned.map((task) => task.referenceDocname as string))];

  let leadEmails: string[];
  try {
    leadEmails = await loadEnquiryEmails(input.commands, enquiryNames);
  } catch (error) {
    if (!isCrmError(error)) throw error;
    return { status: "hold", noticeId: "", reason: error.code };
  }

  let recipient: WorkspaceMemberRecipient;
  try {
    recipient = await resolveWorkspaceMemberRecipient(input.supabase, {
      workspaceId: input.workspaceId,
      profileId: input.recipientProfileId,
      forbiddenEmails: leadEmails,
    });
  } catch (error) {
    if (error instanceof LeadNoticeRecipientError) {
      return { status: "cancelled", noticeId: null, reason: error.message };
    }
    throw error;
  }

  let eligible: CrmTask[];
  try {
    eligible = await filterEligibleTasks(input.commands, assigned, recipient.email);
  } catch (error) {
    if (!isCrmError(error)) throw error;
    return { status: "hold", noticeId: "", reason: error.code };
  }

  if (eligible.length === 0) {
    return { status: "suppressed", noticeId: "", reason: "no_due_follow_ups" };
  }

  const notice = await registerNotice(input.supabase, {
    workspaceId: input.workspaceId,
    idempotencyKey,
    kind: "follow_up_due_digest",
    recipientProfileId: recipient.profileId,
    recipientEmail: recipient.email,
    localDate: input.localDate,
    taskKeys: eligible.map((task) => task.name),
  });

  if (notice.duplicate) return { status: "duplicate", noticeId: notice.row?.id ?? null };
  if (!notice.row) return { status: "cancelled", noticeId: null, reason: "notice registration failed" };

  const count = eligible.length;
  return dispatchNotice(input.supabase, {
    notice: notice.row,
    kind: "follow_up_due_digest",
    recipient,
    subject: count + (count === 1 ? " follow-up due today" : " follow-ups due today"),
    intro: "You have follow-ups due in your workspace.",
    link: followUpLink(input.workspaceId),
    actionLabel: "Open follow-ups",
    detailCount: count,
  });
}

/**
 * Cancel notices a later state change made obsolete: a completed or snoozed
 * task, a reassigned enquiry, or a terminal stage. A notice already handed to
 * the outbox is suppressed there so it is never delivered.
 */
export async function cancelObsoleteLeadNotices(
  supabase: SupabaseClient,
  input: { workspaceId: string; enquiry?: string | null; task?: string | null; reason: string },
): Promise<{ cancelled: number }> {
  if (!input.enquiry && !input.task) return { cancelled: 0 };

  const rows: NoticeRow[] = [];

  if (input.enquiry) {
    const { data } = await supabase
      .from("lead_notice_records")
      .select("id, outbox_idempotency_key")
      .eq("workspace_id", input.workspaceId)
      .eq("enquiry", input.enquiry)
      .in("status", ["pending", "hold", "queued"]);
    rows.push(...((data ?? []) as NoticeRow[]));
  }

  if (input.task) {
    const { data } = await supabase
      .from("lead_notice_records")
      .select("id, outbox_idempotency_key")
      .eq("workspace_id", input.workspaceId)
      .or("task.eq." + input.task + ",task_keys.cs.{" + input.task + "}")
      .in("status", ["pending", "hold", "queued"]);
    rows.push(...((data ?? []) as NoticeRow[]));
  }

  const unique = new Map(rows.map((row) => [row.id, row]));

  for (const row of unique.values()) {
    if (row.outbox_idempotency_key) {
      await supabase
        .from("email_outbox")
        .update({ status: "suppressed", last_error: "lead_notice_cancelled: " + input.reason })
        .eq("idempotency_key", row.outbox_idempotency_key)
        .eq("status", "pending");
    }
    await settleNotice(supabase, row.id, "cancelled", input.reason);
  }

  return { cancelled: unique.size };
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

async function loadDueTasks(commands: CrmCommands, now: Date): Promise<CrmTask[]> {
  const tasks = await commands.listTasks({ limit: 200 });
  const nowMs = now.getTime();
  return tasks.filter((task) => {
    if (!isCrmOpenTaskStatus(task.status)) return false;
    if (!task.dueAt) return false;
    const due = Date.parse(task.dueAt);
    return Number.isFinite(due) && due <= nowMs;
  });
}

async function loadEnquiryEmails(commands: CrmCommands, enquiries: string[]): Promise<string[]> {
  const emails: string[] = [];
  for (const enquiry of enquiries.slice(0, 25)) {
    try {
      const lead = await commands.getLead(enquiry);
      if (lead.email) emails.push(lead.email);
    } catch (error) {
      if (!isCrmError(error)) throw error;
      // The CRM is unreadable for this enquiry: the digest must hold.
      throw error;
    }
  }
  return emails;
}

/**
 * Keep only tasks that are still open, still assigned to the member, and still
 * belong to an enquiry that is not archived and not in a terminal stage.
 */
async function filterEligibleTasks(
  commands: CrmCommands,
  tasks: CrmTask[],
  memberEmail: string,
): Promise<CrmTask[]> {
  const owner = normalizeNoticeEmail(memberEmail);
  const eligible: CrmTask[] = [];

  for (const task of tasks) {
    if (normalizeNoticeEmail(task.assignedTo) !== owner) continue;
    const enquiry = task.referenceDocname;
    if (!enquiry) continue;
    const lead = await commands.getLead(enquiry);
    if (lead.archived || isCrmTerminalStage(lead.stage)) continue;
    eligible.push(task);
  }

  return eligible;
}

async function registerNotice(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    idempotencyKey: string;
    kind: LeadNoticeKind;
    recipientProfileId: string;
    recipientEmail: string;
    enquiry?: string;
    localDate?: string;
    taskKeys?: string[];
  },
): Promise<{ row: NoticeRow | null; duplicate: boolean }> {
  const { data, error } = await supabase
    .from("lead_notice_records")
    .upsert(
      {
        workspace_id: input.workspaceId,
        idempotency_key: input.idempotencyKey,
        kind: input.kind,
        status: "pending",
        recipient_profile_id: input.recipientProfileId,
        recipient_email: input.recipientEmail,
        enquiry: input.enquiry ?? null,
        local_date: input.localDate ?? null,
        task_keys: input.taskKeys ?? [],
        outbox_idempotency_key: input.idempotencyKey,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    )
    .select("id, idempotency_key, status, outbox_idempotency_key");

  if (error) {
    throw new Error("lead_notice_records enqueue failed: " + error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (row?.id) {
    return { row: row as NoticeRow, duplicate: false };
  }

  const { data: existing } = await supabase
    .from("lead_notice_records")
    .select("id, idempotency_key, status, outbox_idempotency_key")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  return { row: (existing ?? null) as NoticeRow | null, duplicate: true };
}

async function settleNotice(
  supabase: SupabaseClient,
  noticeId: string,
  status: LeadNoticeStatus,
  reason: string | null,
) {
  const { error } = await supabase
    .from("lead_notice_records")
    .update({ status, cancel_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", noticeId);

  if (error) {
    throw new Error("lead_notice_records update failed: " + error.message);
  }
}

async function dispatchNotice(
  supabase: SupabaseClient,
  input: {
    notice: NoticeRow;
    kind: LeadNoticeKind;
    recipient: WorkspaceMemberRecipient;
    subject: string;
    intro: string;
    link: string;
    actionLabel: string;
    detailCount?: number;
  },
): Promise<LeadNoticeResult> {
  const firstName = input.recipient.fullName?.split(/\s+/)[0] || "there";
  const safeName = escapeHtml(firstName);
  const safeIntro = escapeHtml(input.intro);
  const safeLink = escapeHtml(input.link);
  const safeLabel = escapeHtml(input.actionLabel);
  const countSuffix = input.detailCount ? " (" + input.detailCount + " due)" : "";

  const html =
    '<div style="font-family:system-ui,sans-serif;font-size:14px">' +
    "<p>Hi " +
    safeName +
    ",</p>" +
    "<p>" +
    safeIntro +
    countSuffix +
    "</p>" +
    '<p><a href="' +
    safeLink +
    '">' +
    safeLabel +
    "</a></p>" +
    '<p style="color:#64748b">You are receiving this because you are a member of this Blockwise workspace.</p>' +
    "</div>";
  const text =
    "Hi " +
    firstName +
    ",\n\n" +
    input.intro +
    countSuffix +
    "\n\n" +
    input.actionLabel +
    ": " +
    input.link +
    "\n";

  const enqueued = await enqueueEmail(supabase, {
    messageType: LEAD_NOTICE_MESSAGE_TYPE[input.kind],
    templateId: "lead-notice-" + input.kind,
    templateVersion: 1,
    to: input.recipient.email,
    from: process.env.DEMO_NOTIFY_FROM?.trim() || "hello@blockwise.sale",
    subject: input.subject,
    html,
    text,
    payload: { noticeId: input.notice.id, kind: input.kind },
    idempotencyKey: input.notice.idempotency_key,
  });

  const outboxId = enqueued.queued ? enqueued.id : enqueued.duplicateOf;
  await supabase
    .from("lead_notice_records")
    .update({
      status: "queued",
      outbox_id: outboxId,
      outbox_idempotency_key: input.notice.idempotency_key,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.notice.id);

  return { status: "queued", noticeId: input.notice.id, outboxId };
}

function appBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return (raw || "https://blockwise.sale").replace(/\/+$/, "");
}

function enquiryLink(workspaceId: string, enquiry: string): string {
  return appBaseUrl() + "/leads/" + encodeURIComponent(enquiry) + "?workspaceId=" + encodeURIComponent(workspaceId);
}

function followUpLink(workspaceId: string): string {
  return appBaseUrl() + "/leads?workspaceId=" + encodeURIComponent(workspaceId) + "&view=follow-up-due";
}
