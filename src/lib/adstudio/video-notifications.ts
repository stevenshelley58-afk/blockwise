import type { SupabaseClient } from "@supabase/supabase-js";

import { VIDEO_OFFER, formatDeadline } from "./video-offer.ts";
import { enqueueEmail } from "../email/outbox.ts";

/**
 * Customer notifications for a video order.
 *
 * Rules these messages follow:
 *   * they link to the authenticated surface, never to a raw private file or a
 *     signed URL, because a signed link in an inbox is a bearer credential that
 *     outlives the authorisation that produced it;
 *   * each one is enqueued with an idempotency key derived from the event and
 *     the version, so a retried webhook or a replayed job cannot send the same
 *     message twice;
 *   * a failed notification never loses the order. Enqueue is queued work with
 *     its own retries, and the order record is already durable.
 */

const FROM_ADDRESS = process.env.BLOCKWISE_VIDEO_EMAIL_FROM?.trim() || "hello@blockwise.sale";
const REPLY_TO = VIDEO_OFFER.supportEmail;

/** Every message points at the customer's own authenticated video page. */
const VIDEO_PAGE_PATH = "/ad-studio/video";

export type VideoNotificationKind =
  | "order_confirmed"
  | "draft_ready"
  | "revision_received"
  | "final_ready";

export class VideoNotificationError extends Error {}

type OrderContext = {
  workspaceId: string;
  orderId: string;
  projectTitle: string;
  firstDraftDueAt: string | null;
  dueTimezone: string;
  revisionEntitlement: number;
  revisionsUsed: number;
};

function shell(heading: string, bodyLines: string[], cta: string): { html: string; text: string } {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ?? "https://blockwise.sale";
  const url = `${base}${VIDEO_PAGE_PATH}`;

  const text = [
    heading,
    "",
    ...bodyLines,
    "",
    `${cta}: ${url}`,
    "",
    `Questions? Reply to this email or write to ${REPLY_TO}.`,
    "",
    "Blockwise",
  ].join("\n");

  // Quiet card: the established surface, border and typography tokens, with the
  // message and one clear action. Restrained rather than decorative.
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f5f4;font-family:Manrope,Inter,Helvetica,Arial,sans-serif;color:#1c1c1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">
    <tr><td style="background:#ffffff;border:1px solid #e5e5e2;border-radius:16px;padding:24px;">
      <h1 style="margin:0 0 12px;font-size:19px;line-height:1.3;">${escapeHtml(heading)}</h1>
      ${bodyLines.map((line) => `<p style="margin:0 0 10px;font-size:14px;line-height:1.55;">${escapeHtml(line)}</p>`).join("\n      ")}
      <p style="margin:20px 0 0;">
        <a href="${url}" style="display:inline-block;background:#1c1c1a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 18px;border-radius:999px;">${escapeHtml(cta)}</a>
      </p>
    </td></tr>
    <tr><td style="padding:14px 4px;color:#6b6b66;font-size:12px;">
      Questions? Reply to this email or write to <a href="mailto:${REPLY_TO}" style="color:#6b6b66;">${REPLY_TO}</a>.
    </td></tr>
  </table>
</body></html>`;

  return { html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dueSentence(order: OrderContext): string {
  if (!order.firstDraftDueAt) return "We will confirm your draft date shortly.";
  try {
    return `Your first draft is due ${formatDeadline(new Date(order.firstDraftDueAt), order.dueTimezone)}.`;
  } catch {
    return "Your first draft date is on your order page.";
  }
}

/**
 * Enqueue one notification. Returns whether a new message was queued; a
 * duplicate means the same event already notified, which is the intended
 * outcome of a retry.
 */
export async function enqueueVideoNotification(input: {
  supabase: SupabaseClient;
  kind: VideoNotificationKind;
  to: string;
  order: OrderContext;
  /** Stable per-version identifier so a new draft notifies again. */
  versionNumber?: number;
}): Promise<{ queued: boolean }> {
  const { kind, order } = input;
  if (!input.to || !input.to.includes("@")) {
    throw new VideoNotificationError("A valid recipient address is required.");
  }

  const variant = input.versionNumber === undefined ? "" : `:v${input.versionNumber}`;
  const idempotencyKey = `video:${kind}:${order.orderId}${variant}`;

  let subject: string;
  let heading: string;
  let bodyLines: string[];
  let cta: string;

  switch (kind) {
    case "order_confirmed":
      subject = `We have your video brief — ${order.projectTitle}`;
      heading = "Your video is booked in";
      bodyLines = [
        `Thanks. We have your brief for "${order.projectTitle}" and your payment is confirmed.`,
        dueSentence(order),
        order.revisionEntitlement === 1
          ? "One round of revisions is included. You will see the draft before anything is final."
          : `${order.revisionEntitlement} rounds of revisions are included.`,
      ];
      cta = "View your order";
      break;

    case "draft_ready":
      heading = "Your draft is ready to watch";
      subject = `Your video draft is ready — ${order.projectTitle}`;
      bodyLines = [
        `The first draft of "${order.projectTitle}" is ready for you to watch.`,
        "Tell us anything you would like changed in one message, or approve it as it is.",
        "You have one revision round, so please send everything you would like adjusted together.",
      ];
      cta = "Watch your draft";
      break;

    case "revision_received":
      heading = "We have your feedback";
      subject = `We have your feedback — ${order.projectTitle}`;
      bodyLines = [
        `Thanks for the notes on "${order.projectTitle}".`,
        "We have started on your revision. We will email you when the updated version is ready.",
        "This is the revision included with your order.",
      ];
      cta = "View your order";
      break;

    case "final_ready":
      heading = "Your video is ready";
      subject = `Your video is ready — ${order.projectTitle}`;
      bodyLines = [
        `"${order.projectTitle}" is finished and ready to download.`,
        "It is saved to your video library, so you can come back for it whenever you need it.",
      ];
      cta = "Download your video";
      break;

    default: {
      const exhaustive: never = kind;
      throw new VideoNotificationError(`Unknown notification kind: ${String(exhaustive)}`);
    }
  }

  const { html, text } = shell(heading, bodyLines, cta);

  const result = await enqueueEmail(input.supabase, {
    messageType: `video_${kind}`,
    templateId: `video-${kind.replace(/_/g, "-")}`,
    templateVersion: 1,
    to: input.to,
    from: FROM_ADDRESS,
    replyTo: REPLY_TO,
    subject,
    html,
    text,
    timezone: order.dueTimezone,
    idempotencyKey,
    // Payload carries no media, no signed link and no brief content: the
    // message names the order and links to the authenticated page.
    payload: {
      orderId: order.orderId,
      projectTitle: order.projectTitle,
      kind,
      versionNumber: input.versionNumber ?? null,
    },
  });

  return { queued: result.queued };
}

/**
 * The address to notify for an order.
 *
 * Resolved from the workspace's own members rather than from anything the
 * customer typed into a brief, so a brief cannot be used to redirect a message
 * to an address of the submitter's choosing. Operators are skipped: they run
 * the workspace, they are not its customer.
 */
export async function resolveOrderContact(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, created_at, profiles(email, is_operator)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) return null;

  type MemberRow = { role: string; profiles: { email: string | null; is_operator: boolean | null } | null };
  const members = (data ?? []) as unknown as MemberRow[];

  // Prefer an owner or admin, then any other non-operator member.
  const preferred = members.find((m) => m.role === "owner" || m.role === "admin");
  const candidate = preferred ?? members.find((m) => m.role !== "operator");
  const email = candidate?.profiles?.email?.trim();
  if (!email || candidate?.profiles?.is_operator === true) return null;
  return email.includes("@") ? email : null;
}

/** Where each notification is raised from, for the record. */
export const VIDEO_NOTIFICATION_TRIGGERS: Record<VideoNotificationKind, string> = {
  order_confirmed: "verified payment (webhook), not the success redirect",
  draft_ready: "operator publishes a draft",
  revision_received: "customer submits review feedback",
  final_ready: "operator delivers the final",
};
