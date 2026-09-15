/** Stripe's authoritative status for a subscription inside its trial window. */
export const TRIALING_STATUS = "trialing";

export type TrialReminderFacts = {
  subscriptionId: string | null;
  trialEndIso: string | null;
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
 * Recheck the authoritative trial facts immediately before writing the stage.
 * A stale or invalid deadline is suppressed rather than sent to Mautic.
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

  if (!facts.current) return { action: "suppress", reason: "workspace_not_found" };
  if (facts.current.subscriptionId !== facts.subscriptionId) {
    return { action: "suppress", reason: "superseded_subscription" };
  }
  if (facts.current.subscriptionStatus !== TRIALING_STATUS) {
    return { action: "suppress", reason: "subscription_not_trialing" };
  }

  const currentEnd = facts.current.periodEndIso
    ? new Date(facts.current.periodEndIso)
    : null;
  if (
    currentEnd &&
    !Number.isNaN(currentEnd.getTime()) &&
    currentEnd.getTime() !== trialEnd.getTime()
  ) {
    return { action: "suppress", reason: "trial_end_changed" };
  }
  if (now.getTime() >= trialEnd.getTime()) {
    return { action: "suppress", reason: "trial_already_ended" };
  }

  return { action: "send" };
}
