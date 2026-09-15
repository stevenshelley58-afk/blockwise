/**
 * Send-time state check for the day-six trial reminder.
 *
 * Kept separate from trial-reminder.ts so the outbox can ask "should this still
 * go out?" without importing the module that enqueues into it. That would be a
 * cycle, and this is the half of the reminder logic that has no dependency on
 * the outbox at all.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const TRIAL_REMINDER_MESSAGE_TYPE = "trial_ending_reminder";

/** Stripe's own status for a subscription inside its trial window. */
export const TRIALING_STATUS = "trialing";

export type TrialReminderFacts = {
  /** Identity the reminder was built for, from the outbox payload. */
  subscriptionId: string | null;
  trialEndIso: string | null;
  /** Current subscription truth, or null when the workspace no longer exists. */
  current: {
    subscriptionId: string | null;
    subscriptionStatus: string | null;
    periodEndIso: string | null;
  } | null;
};

export type TrialReminderDecision =
  | { action: "send" }
  | { action: "suppress"; reason: string };

/**
 * Whether a due reminder should still be sent.
 *
 * Pure, so every rule is testable without a database or a provider. A stale
 * reminder is suppressed rather than delivered: telling a customer their trial
 * ends tomorrow when it has already ended, renewed, changed length or been
 * cancelled is worse than staying quiet.
 */
export function decideTrialReminderSend(input: {
  facts: TrialReminderFacts;
  now: Date;
}): TrialReminderDecision {
  const { facts, now } = input;

  if (!facts.subscriptionId || !facts.trialEndIso) {
    return { action: "suppress", reason: "reminder_missing_identity" };
  }
  const trialEnd = new Date(facts.trialEndIso);
  if (Number.isNaN(trialEnd.getTime())) {
    return { action: "suppress", reason: "reminder_invalid_trial_end" };
  }

  const current = facts.current;
  if (!current) {
    return { action: "suppress", reason: "workspace_not_found" };
  }
  if (current.subscriptionId !== facts.subscriptionId) {
    return { action: "suppress", reason: "superseded_subscription" };
  }
  if (current.subscriptionStatus !== TRIALING_STATUS) {
    return { action: "suppress", reason: "subscription_not_trialing" };
  }
  // The trial end moved: a newer reminder keyed to the new end supersedes this
  // one, so it must not describe a deadline that no longer applies. Compare
  // instants, not strings: the payload carries `Date#toISOString()`, while the
  // column is read back as a timestamptz rendering ("2026-09-16 05:26:34+00").
  if (current.periodEndIso) {
    const periodEnd = new Date(current.periodEndIso);
    // An unreadable period end is not evidence that the trial moved, so fall
    // through rather than suppress a reminder that may still be accurate.
    if (!Number.isNaN(periodEnd.getTime()) && periodEnd.getTime() !== trialEnd.getTime()) {
      return { action: "suppress", reason: "trial_end_changed" };
    }
  }
  if (now.getTime() >= trialEnd.getTime()) {
    return { action: "suppress", reason: "trial_already_ended" };
  }

  return { action: "send" };
}

type ReminderOutboxRow = {
  payload: Record<string, unknown> | null;
};

/**
 * Read current subscription truth for a due reminder and decide.
 *
 * A read failure throws so the caller defers the message: an unknown
 * subscription state must never be treated as permission to send.
 */
export async function evaluateTrialReminderSend(
  service: SupabaseClient,
  row: ReminderOutboxRow,
  now: Date = new Date(),
): Promise<TrialReminderDecision> {
  const payload = row.payload ?? {};
  const workspaceId = typeof payload.workspaceId === "string" ? payload.workspaceId.trim() : "";
  const subscriptionId =
    typeof payload.subscriptionId === "string" ? payload.subscriptionId.trim() : null;
  const trialEndIso = typeof payload.trialEnd === "string" ? payload.trialEnd.trim() : null;

  if (!workspaceId) {
    return { action: "suppress", reason: "reminder_missing_workspace" };
  }

  const { data, error } = await service
    .from("workspaces")
    .select("stripe_subscription_id,stripe_subscription_status,stripe_current_period_end")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`trial reminder state check failed: ${error.message}`);

  return decideTrialReminderSend({ facts: { subscriptionId, trialEndIso, current: readCurrent(data) }, now });
}

function readCurrent(data: unknown): TrialReminderFacts["current"] {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  return {
    subscriptionId: trimmedString(row.stripe_subscription_id),
    subscriptionStatus: trimmedString(row.stripe_subscription_status),
    periodEndIso: trimmedString(row.stripe_current_period_end),
  };
}

function trimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
