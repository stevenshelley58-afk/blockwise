/**
 * Day-six trial-ending reminder.
 *
 * Scheduled from the trial's actual end (`trial_end - 24 hours`), never from
 * signup, a calendar-day counter, Checkout opening or a first delivery. Six
 * elapsed days after activation, with renewal one day later.
 *
 * Stripe's `customer.subscription.trial_will_end` fires three days before
 * expiry, so it is not the day-six timer. It may still be used for
 * reconciliation or an earlier notice, and any notice a payment provider or
 * card network requires stays enabled independently of this reminder.
 *
 * Delivery reuses the durable email outbox: the reminder is enqueued with a
 * not-before timestamp and the per-minute drain delivers it. Retries, lease
 * recovery and catch-up after downtime are therefore the outbox's job, not a
 * second scheduling system's.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { enqueueEmail } from "../email/outbox.ts";
import { escapeHtml } from "../email/provider.ts";
import { getBillingOffer, type BillingOffer } from "./offers.ts";
import { TRIALING_STATUS, TRIAL_REMINDER_MESSAGE_TYPE } from "./trial-reminder-state.ts";

/** The reminder goes out 24 hours before the trial ends. */
export const TRIAL_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

export const TRIAL_REMINDER_TEMPLATE_ID = "trial-ending-reminder";
export const TRIAL_REMINDER_TEMPLATE_VERSION = 1;

export const DEFAULT_BILLING_TIMEZONE = "Australia/Perth";

/**
 * Unique per subscription, trial end and reminder type.
 *
 * A changed trial end produces a new key, so the customer is always reminded
 * against the real deadline. A repeated scan, duplicate webhook or retry
 * produces the same key and is a no-op.
 */
export function trialReminderIdempotencyKey(input: {
  subscriptionId: string;
  trialEndIso: string;
}): string {
  return `trial-reminder:${input.subscriptionId}:${input.trialEndIso}:day6`;
}

/** When the reminder becomes deliverable: the trial end less the lead time. */
export function trialReminderAt(trialEnd: Date): Date {
  return new Date(trialEnd.getTime() - TRIAL_REMINDER_LEAD_MS);
}

/**
 * The trial-end date and time in the customer's timezone. Stored and compared
 * in UTC; displayed in the workspace timezone, falling back to the default when
 * the stored zone is unusable rather than throwing during a drain.
 */
export function formatTrialEnd(trialEnd: Date, timeZone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: resolveTimeZone(timeZone),
      dateStyle: "full",
      timeStyle: "short",
    }).format(trialEnd);
  } catch {
    return trialEnd.toISOString();
  }
}

export function resolveTimeZone(value: string | null | undefined): string {
  const candidate = value?.trim();
  if (!candidate) return DEFAULT_BILLING_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_BILLING_TIMEZONE;
  }
}

/** The renewal amount as the customer sees it, e.g. A$249. */
export function formatOfferAmount(offer: BillingOffer): string {
  const symbol = offer.currency === "AUD" ? "A$" : `${offer.currency} `;
  return `${symbol}${Math.round(offer.recurringAmount / 100).toLocaleString("en-AU")}`;
}

export function offerRenewalInterval(offer: BillingOffer): string {
  return "month";
}

export type TrialReminderContent = {
  subject: string;
  html: string;
  text: string;
};

/**
 * The reminder content, built from the real recipient and the offer the
 * customer actually accepted. No marketing placeholders.
 */
export function buildTrialReminderContent(input: {
  recipientName: string | null;
  offer: BillingOffer;
  trialEnd: Date;
  timeZone: string | null | undefined;
  manageUrl: string;
}): TrialReminderContent {
  const when = formatTrialEnd(input.trialEnd, input.timeZone);
  const amount = formatOfferAmount(input.offer);
  const interval = offerRenewalInterval(input.offer);
  const name = input.recipientName?.trim() || null;
  const greeting = name ? `Hi ${name},` : "Hi,";

  const subject = `Your Blockwise free trial ends ${when}`;

  const text = [
    greeting,
    "",
    `Your Blockwise free trial ends ${when}.`,
    "",
    `After that, your Blockwise Ad studio subscription renews automatically at ${amount} per ${interval} until you cancel.`,
    "",
    `Cancel any time before then from Settings, billing: ${input.manageUrl}`,
    "",
    "Meta ad spend is separate. Meta charges your ad budget directly, including during your trial, and it is not part of your Blockwise subscription.",
    "",
    "If you cancel, you keep access until the trial ends. Any ad files you downloaded stay yours and can be run in your own Meta ad account.",
    "",
    "Blockwise",
  ].join("\n");

  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">
<p>${escapeHtml(greeting)}</p>
<p>Your Blockwise free trial ends <strong>${escapeHtml(when)}</strong>.</p>
<p>After that, your Blockwise Ad studio subscription renews automatically at <strong>${escapeHtml(amount)} per ${escapeHtml(interval)}</strong> until you cancel.</p>
<p>Cancel any time before then from <a href="${escapeHtml(input.manageUrl)}">Settings, billing</a>.</p>
<p style="color:#475569">Meta ad spend is separate. Meta charges your ad budget directly, including during your trial, and it is not part of your Blockwise subscription.</p>
<p style="color:#475569">If you cancel, you keep access until the trial ends. Any ad files you downloaded stay yours and can be run in your own Meta ad account.</p>
<p>Blockwise</p>
</div>`;

  return { subject, html, text };
}

export type TrialReminderScheduleInput = {
  service: SupabaseClient;
  workspaceId: string;
  subscriptionId: string;
  trialEnd: Date;
  recipient: string;
  recipientName?: string | null;
  timeZone?: string | null;
  offer?: BillingOffer;
  manageUrl?: string;
  from?: string;
  now?: Date;
};

export type TrialReminderScheduleResult =
  | { queued: true; id: string }
  | { queued: false; duplicateOf: string | null; reason: "already_scheduled" };

/**
 * Enqueue the reminder for one trial.
 *
 * Deliverable at `trial_end - 24h`, or immediately when the trial is already
 * inside that window (a shorter trial, or a scan catching up late). The email
 * always states the exact trial-end date, so it stays accurate however late it
 * arrives. The drain suppresses it outright once the trial has actually ended.
 */
export async function scheduleTrialEndingReminder(
  input: TrialReminderScheduleInput,
): Promise<TrialReminderScheduleResult> {
  const now = input.now ?? new Date();
  const trialEndIso = input.trialEnd.toISOString();
  const idempotencyKey = trialReminderIdempotencyKey({
    subscriptionId: input.subscriptionId,
    trialEndIso,
  });

  const dueAt = new Date(Math.max(now.getTime(), trialReminderAt(input.trialEnd).getTime()));

  const offer = input.offer ?? getBillingOffer("AU", "ad_studio");
  const manageUrl = input.manageUrl ?? defaultManageUrl();
  const content = buildTrialReminderContent({
    recipientName: input.recipientName ?? null,
    offer,
    trialEnd: input.trialEnd,
    timeZone: input.timeZone,
    manageUrl,
  });

  const result = await enqueueEmail(input.service, {
    messageType: TRIAL_REMINDER_MESSAGE_TYPE,
    templateId: TRIAL_REMINDER_TEMPLATE_ID,
    templateVersion: TRIAL_REMINDER_TEMPLATE_VERSION,
    to: input.recipient,
    from: input.from ?? billingFromAddress(),
    replyTo: "support@blockwise.sale",
    subject: content.subject,
    html: content.html,
    text: content.text,
    timezone: resolveTimeZone(input.timeZone),
    // The drain re-reads subscription truth before sending; these are the
    // terms the reminder was built for and the key it was scheduled under.
    payload: {
      workspaceId: input.workspaceId,
      subscriptionId: input.subscriptionId,
      trialEnd: trialEndIso,
      reminderType: "day6",
      renewalAmount: offer.recurringAmount,
      renewalCurrency: offer.currency,
      offerKey: offer.key,
      offerVersion: offer.version,
    },
    idempotencyKey,
    nextAttemptAt: dueAt.toISOString(),
  });

  return result.queued
    ? { queued: true, id: result.id }
    : { queued: false, duplicateOf: result.duplicateOf, reason: "already_scheduled" };
}

export function billingFromAddress(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.BILLING_EMAIL_FROM?.trim() ||
    env.DEMO_NOTIFY_FROM?.trim() ||
    "billing@blockwise.sale"
  );
}

function defaultManageUrl(env: NodeJS.ProcessEnv = process.env): string {
  const origin = env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  return `${origin || "https://blockwise.sale"}/settings#billing`;
}

export type TrialReminderRecovery = { scanned: number; queued: number; failed: number };

type TrialWorkspaceRow = {
  id: string;
  billing_email: string | null;
  publishing_timezone: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  stripe_current_period_end: string | null;
};

/**
 * Ensure a reminder exists for every workspace currently inside a Stripe trial.
 *
 * The single producer. Running it every drain cycle makes it the catch-up scan
 * after downtime and the repair for a missed webhook, while the outbox's unique
 * idempotency key keeps repeated runs free of duplicate sends.
 *
 * Trial end comes from Stripe's own period end on a trialing subscription, not
 * from the legacy application `trial_ends_at`, so the delivery-anchored legacy
 * trial can never drive this reminder.
 */
export async function recoverMissingTrialReminders(
  service: SupabaseClient,
  limit = 50,
): Promise<TrialReminderRecovery> {
  const { data, error } = await service
    .from("workspaces")
    .select(
      "id,billing_email,publishing_timezone,stripe_subscription_id,stripe_subscription_status,stripe_current_period_end",
    )
    .eq("stripe_subscription_status", TRIALING_STATUS)
    .not("stripe_subscription_id", "is", null)
    .not("stripe_current_period_end", "is", null)
    .gt("stripe_current_period_end", new Date().toISOString())
    .order("id", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 200)));

  if (error) throw new Error(`trial reminder recovery scan failed: ${error.message}`);

  const rows = (data ?? []) as TrialWorkspaceRow[];
  let queued = 0;
  let failed = 0;

  for (const row of rows) {
    const subscriptionId = row.stripe_subscription_id?.trim();
    const trialEndIso = row.stripe_current_period_end?.trim();
    const recipient = row.billing_email?.trim();
    if (!subscriptionId || !trialEndIso || !recipient) {
      // A trial with no billing contact cannot be reminded. Surface it rather
      // than fail silently; the operator alert path watches this count.
      failed += 1;
      console.error("[trial-reminder] trial workspace is missing a reminder identity", {
        workspaceId: row.id,
        hasSubscription: Boolean(subscriptionId),
        hasTrialEnd: Boolean(trialEndIso),
        hasRecipient: Boolean(recipient),
      });
      continue;
    }

    try {
      const result = await scheduleTrialEndingReminder({
        service,
        workspaceId: row.id,
        subscriptionId,
        trialEnd: new Date(trialEndIso),
        recipient,
        timeZone: row.publishing_timezone,
      });
      if (result.queued) queued += 1;
    } catch (scheduleError) {
      failed += 1;
      console.error("[trial-reminder] failed to schedule the trial reminder", {
        workspaceId: row.id,
        error: scheduleError,
      });
    }
  }

  return { scanned: rows.length, queued, failed };
}
