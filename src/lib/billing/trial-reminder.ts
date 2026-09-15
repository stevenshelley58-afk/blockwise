/**
 * Day-six trial-ending stage scan.
 *
 * The scan is anchored to Stripe's actual trial end and runs when that end is
 * no more than 24 hours away. It does not build or send mail: it writes the
 * Mautic stage through the durable bridge, and Mautic owns the campaign.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { formatRecurringAmount, setStage } from "../mautic/flows.ts";
import { BILLING_OFFERS, type BillingOffer } from "./offers.ts";
import { decideTrialReminderSend, TRIALING_STATUS } from "./trial-reminder-state.ts";

/** The reminder stage is written 24 hours before the trial ends. */
export const TRIAL_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

/** When the reminder becomes due: the trial end less the lead time. */
export function trialReminderAt(trialEnd: Date): Date {
  return new Date(trialEnd.getTime() - TRIAL_REMINDER_LEAD_MS);
}

export type TrialReminderRecovery = { scanned: number; queued: number; failed: number };

type TrialWorkspaceRow = {
  id: string;
  billing_email: string | null;
  publishing_timezone: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  stripe_current_period_end: string | null;
  billing_offer_key: string | null;
};

/**
 * Write the Mautic trial-ending stage for every trial inside its final 24h.
 *
 * Repeated scans are safe because the bridge uses the subscription and trial
 * deadline as its durable subject identity. A moved deadline gets a fresh job,
 * while the worker suppresses the superseded one before it reaches Mautic.
 */
export async function recoverMissingTrialReminders(
  service: SupabaseClient,
  limit = 50,
  now = new Date(),
  stageSetter: typeof setStage = setStage,
): Promise<TrialReminderRecovery> {
  const cutoff = new Date(now.getTime() + TRIAL_REMINDER_LEAD_MS);
  const pageSize = Math.max(1, Math.min(limit, 200));
  let queued = 0;
  let failed = 0;
  let scanned = 0;
  let afterId: string | null = null;

  while (true) {
    let query = service
      .from("workspaces")
      .select(
        "id,billing_email,publishing_timezone,stripe_subscription_id,stripe_subscription_status,stripe_current_period_end,billing_offer_key",
      )
      .eq("stripe_subscription_status", TRIALING_STATUS)
      .not("stripe_subscription_id", "is", null)
      .not("stripe_current_period_end", "is", null)
      .gt("stripe_current_period_end", now.toISOString())
      .lte("stripe_current_period_end", cutoff.toISOString())
      .order("id", { ascending: true });
    if (afterId) query = query.gt("id", afterId);
    const { data, error } = await query.limit(pageSize);
    if (error) throw new Error(`trial reminder recovery scan failed: ${error.message}`);

    const rows = (data ?? []) as TrialWorkspaceRow[];
    scanned += rows.length;
    for (const row of rows) {
      const subscriptionId = row.stripe_subscription_id?.trim();
      const trialEndIso = row.stripe_current_period_end?.trim();
      const email = row.billing_email?.trim();
      if (!subscriptionId || !trialEndIso || !email) {
        failed += 1;
        console.error("[trial-reminder] trial workspace is missing a reminder identity", {
          workspaceId: row.id,
          hasSubscription: Boolean(subscriptionId),
          hasTrialEnd: Boolean(trialEndIso),
          hasBillingContact: Boolean(email),
        });
        continue;
      }

      const periodEnd = new Date(trialEndIso);
      const decision = decideTrialReminderSend({
        facts: {
          subscriptionId,
          trialEndIso,
          current: {
            subscriptionId: row.stripe_subscription_id?.trim() ?? null,
            subscriptionStatus: row.stripe_subscription_status?.trim() ?? null,
            periodEndIso: row.stripe_current_period_end?.trim() ?? null,
          },
        },
        now,
      });
      if (decision.action === "suppress" || Number.isNaN(periodEnd.getTime())) {
        failed += 1;
        console.error("[trial-reminder] suppressed an invalid or stale trial stage", {
          workspaceId: row.id,
          reason: decision.action === "suppress" ? decision.reason : "reminder_invalid_trial_end",
        });
        continue;
      }

      try {
        const offer = offerForKey(row.billing_offer_key);
        await stageSetter({
          email,
          workspaceId: row.id,
          subjectId: `${subscriptionId}:${trialEndIso}`,
          stage: "trial_ending",
          periodEnd,
          plan: planName(offer),
          amount: offerAmount(offer),
          timeZone: row.publishing_timezone ?? undefined,
          guard: {
            kind: "trial_ending",
            subscriptionId,
            trialEndIso,
          },
        });
        queued += 1;
      } catch (stageError) {
        failed += 1;
        console.error("[trial-reminder] failed to queue the Mautic stage", {
          workspaceId: row.id,
          error: stageError instanceof Error ? stageError.message : String(stageError),
        });
      }
    }

    if (rows.length < pageSize) break;
    afterId = rows.at(-1)?.id ?? null;
    if (!afterId) break;
  }

  return { scanned, queued, failed };
}

function offerForKey(key: string | null | undefined): BillingOffer | null {
  const normalized = key?.trim();
  return normalized && normalized in BILLING_OFFERS
    ? BILLING_OFFERS[normalized as keyof typeof BILLING_OFFERS]
    : null;
}

function planName(offer: BillingOffer | null): string | undefined {
  if (offer?.product === "ad_studio") return "Ad studio";
  if (offer?.product === "managed") return "Managed";
  return undefined;
}

function offerAmount(offer: BillingOffer | null): string | undefined {
  return offer
    ? formatRecurringAmount({
        minorUnits: offer.recurringAmount,
        currency: offer.currency,
        interval: "month",
      })
    : undefined;
}
