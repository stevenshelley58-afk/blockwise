import { createHash } from "node:crypto";

import { enqueueQueuedJob } from "../providers/job-queue-enqueue.ts";
import type { createSupabaseServiceClient } from "../supabase/service.ts";
import { decideTrialReminderSend } from "../billing/trial-reminder-state.ts";
import { upsertContact, type MauticContactFields } from "./contacts.ts";

const DEFAULT_TIME_ZONE = "Australia/Perth";

export type MauticStage =
  | "signed_up"
  | "trial_ending"
  | "trial_ended"
  | "paid"
  | "payment_failed"
  | "cancelled";

export type MauticEvent = "campaign_live" | "budget_alert" | "new_leads";

export type SetStageInput = {
  email: string;
  firstName?: string;
  workspaceId: string;
  stage: MauticStage;
  periodEnd?: Date;
  plan?: string;
  amount?: string;
  timeZone?: string;
  subjectId?: string;
  guard?: MauticSyncGuard;
};

export type FireEventInput = {
  email: string;
  firstName?: string;
  workspaceId: string;
  event: MauticEvent;
  campaignName?: string;
  campaignUrl?: string;
  budget?: string;
  spend?: string;
  threshold?: string;
  leadsCount?: number;
  leadsSummary?: string;
  subjectId?: string;
};

export type MauticSyncPayload = {
  workspaceId: string;
  flow: MauticStage | MauticEvent;
  email: string;
  firstName?: string;
  fields: MauticContactFields;
  guard?: MauticSyncGuard;
};

export type MauticSyncGuard =
  | {
      kind: "trial_ending";
      subscriptionId: string;
      trialEndIso: string;
    }
  | {
      kind: "billing_transition";
      eventId: string;
      eventCreated: number;
      expectedSubscriptionId?: string;
      expectedSubscriptionStatus?: string;
      expectedCancelAtPeriodEnd?: boolean;
      expectedAccessState?: string;
    };

type MauticFlowOptions = {
  enqueueImpl?: typeof enqueueQueuedJob;
};

export async function setStage(input: SetStageInput, options: MauticFlowOptions = {}): Promise<{ id: string | null }> {
  const changedAt = new Date().toISOString();
  const fields: MauticContactFields = {
    blockwise_stage: input.stage,
    blockwise_stage_at: changedAt,
    ...(input.periodEnd ? { blockwise_period_end: formatPeriodEnd(input.periodEnd, input.timeZone) } : {}),
    ...(input.plan ? { blockwise_plan: input.plan } : {}),
    ...(input.amount ? { blockwise_amount: formatAmountField(input.amount) } : {}),
  };

  return enqueueMauticSync({
    workspaceId: input.workspaceId,
    flow: input.stage,
    subjectId: input.subjectId ?? input.email,
    email: input.email,
    firstName: input.firstName,
    fields,
    guard: input.guard,
  }, options.enqueueImpl);
}

export async function fireEvent(input: FireEventInput, options: MauticFlowOptions = {}): Promise<{ id: string | null }> {
  const firedAt = new Date().toISOString();
  const fields: MauticContactFields = {
    blockwise_event: input.event,
    blockwise_event_at: firedAt,
    ...(input.campaignName ? { blockwise_campaign_name: input.campaignName } : {}),
    ...(input.campaignUrl ? { blockwise_campaign_url: input.campaignUrl } : {}),
    ...(input.budget ? { blockwise_budget: input.budget } : {}),
    ...(input.spend ? { blockwise_spend: input.spend } : {}),
    ...(input.threshold ? { blockwise_threshold: input.threshold } : {}),
    ...(input.leadsCount != null ? { blockwise_leads_count: input.leadsCount } : {}),
    ...(input.leadsSummary ? { blockwise_leads_summary: input.leadsSummary } : {}),
  };

  return enqueueMauticSync({
    workspaceId: input.workspaceId,
    flow: input.event,
    subjectId: input.subjectId ?? input.email,
    email: input.email,
    firstName: input.firstName,
    fields,
  }, options.enqueueImpl);
}

export async function executeMauticSync(
  payload: MauticSyncPayload,
  options: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    serviceSupabase?: ReturnType<typeof createSupabaseServiceClient>;
    now?: Date;
    env?: Record<string, string | undefined>;
  } = {},
) {
  if (!payload.workspaceId || !payload.flow || !payload.email || !payload.fields) {
    throw new Error("Mautic sync payload is incomplete.");
  }
  if (payload.guard) {
    if (!options.serviceSupabase) throw new Error("Guarded Mautic sync requires the service database.");
    const guardDecision = await evaluateMauticGuard({
      serviceSupabase: options.serviceSupabase,
      workspaceId: payload.workspaceId,
      guard: payload.guard,
      flow: payload.flow,
      now: options.now ?? new Date(),
    });
    if (guardDecision !== "send") {
      console.info(`[mautic] skipped flow=${payload.flow}`);
      return { skipped: true as const };
    }
  }

  return upsertContact({
    email: payload.email,
    firstName: payload.firstName,
    workspaceId: payload.workspaceId,
    fields: payload.fields,
  }, {
    fetchImpl: options.fetchImpl,
    flow: payload.flow,
    signal: options.signal,
    env: options.env,
  });
}

export function formatPeriodEnd(periodEnd: Date, timeZone?: string): string {
  if (!Number.isFinite(periodEnd.getTime())) throw new Error("Mautic period end must be a valid date.");
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: resolveTimeZone(timeZone),
  }).format(periodEnd);
}

export function formatRecurringAmount(input: {
  minorUnits: number;
  currency: string;
  interval: string;
}): string {
  return `${formatMoney(input.minorUnits, input.currency)} per ${input.interval}`;
}

export function formatAmountField(amount: string): string {
  const encoded = /^(\d+):([a-z]{3}):([a-z]+)$/iu.exec(amount.trim());
  if (!encoded) return amount;
  const minorUnits = Number(encoded[1]);
  if (!Number.isSafeInteger(minorUnits)) return amount;
  return formatRecurringAmount({
    minorUnits,
    currency: encoded[2] ?? "",
    interval: encoded[3] ?? "",
  });
}

export function formatBudget(input: {
  minorUnits: number;
  currency: string;
  interval?: string;
}): string {
  return `${formatMoney(input.minorUnits, input.currency)} per ${input.interval ?? "week"}`;
}

export function formatMoney(minorUnits: number, currency: string): string {
  if (!Number.isSafeInteger(minorUnits)) throw new Error("Mautic money must use integer minor units.");
  const normalizedCurrency = currency.trim().toUpperCase();
  const amount = minorUnits / 100;
  if (normalizedCurrency === "AUD") {
    return `A$${new Intl.NumberFormat("en-AU", {
      minimumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount)}`;
  }
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: normalizedCurrency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatLeadsSummary(
  leads: ReadonlyArray<{ name?: string | null; suburb?: string | null; phone?: string | null }>,
): string {
  const shown = leads.slice(0, 10).map((lead) =>
    [lead.name, lead.suburb, lead.phone]
      .map((value) => value?.trim() || "Not provided")
      .join(" · ")
      .slice(0, 160)
  );
  if (leads.length > shown.length) shown.push(`+${leads.length - shown.length} more`);
  return shown.join("\n");
}

function enqueueMauticSync(
  input: MauticSyncPayload & { subjectId: string },
  enqueueImpl: typeof enqueueQueuedJob = enqueueQueuedJob,
) {
  return enqueueImpl({
    workspaceId: input.workspaceId,
    kind: "mautic_sync",
    payload: {
      workspaceId: input.workspaceId,
      flow: input.flow,
      email: input.email,
      ...(input.firstName ? { firstName: input.firstName } : {}),
      fields: input.fields,
      ...(input.guard ? { guard: input.guard } : {}),
    },
    maxAttempts: 25,
    dedupeKey: `mautic_sync:${input.flow}:${createHash("sha256").update(input.subjectId).digest("hex").slice(0, 32)}`,
  });
}

async function evaluateMauticGuard(input: {
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>;
  workspaceId: string;
  guard: MauticSyncGuard;
  flow: MauticStage | MauticEvent;
  now: Date;
}): Promise<"send" | "suppress"> {
  if (input.guard.kind === "trial_ending") {
    const { data, error } = await input.serviceSupabase
      .from("workspaces")
      .select("stripe_subscription_id,stripe_subscription_status,stripe_current_period_end")
      .eq("id", input.workspaceId)
      .maybeSingle();
    if (error) throw new Error(`Mautic trial guard lookup failed: ${error.message}`);
    const row = data as {
      stripe_subscription_id?: string | null;
      stripe_subscription_status?: string | null;
      stripe_current_period_end?: string | null;
    } | null;
    return decideTrialReminderSend({
      facts: {
        subscriptionId: input.guard.subscriptionId,
        trialEndIso: input.guard.trialEndIso,
        current: row
          ? {
              subscriptionId: row.stripe_subscription_id?.trim() ?? null,
              subscriptionStatus: row.stripe_subscription_status?.trim() ?? null,
              periodEndIso: row.stripe_current_period_end?.trim() ?? null,
            }
          : null,
      },
      now: input.now,
    }).action;
  }

  const { data, error } = await input.serviceSupabase
    .from("workspaces")
    .select("billing_event_created,billing_event_id,stripe_subscription_id,stripe_subscription_status,stripe_cancel_at_period_end,billing_access_state")
    .eq("id", input.workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Mautic billing guard lookup failed: ${error.message}`);
  if (!data) return "suppress";
  const row = data as Record<string, unknown>;
  const currentCreated = typeof row.billing_event_created === "number" ? row.billing_event_created : 0;
  if (currentCreated < input.guard.eventCreated) {
    throw new Error("Mautic billing transition is not committed yet.");
  }
  if (
    input.guard.expectedSubscriptionId !== undefined
    && row.stripe_subscription_id !== input.guard.expectedSubscriptionId
  ) return "suppress";
  if (currentCreated > input.guard.eventCreated) {
    return billingStageStillRelevant(input.flow, row) ? "send" : "suppress";
  }
  if (row.billing_event_id !== input.guard.eventId) {
    return billingStageStillRelevant(input.flow, row) ? "send" : "suppress";
  }
  if (
    input.guard.expectedSubscriptionStatus !== undefined
    && row.stripe_subscription_status !== input.guard.expectedSubscriptionStatus
  ) return "suppress";
  if (
    input.guard.expectedCancelAtPeriodEnd !== undefined
    && row.stripe_cancel_at_period_end !== input.guard.expectedCancelAtPeriodEnd
  ) return "suppress";
  if (
    input.guard.expectedAccessState !== undefined
    && row.billing_access_state !== input.guard.expectedAccessState
  ) return "suppress";
  return "send";
}

function billingStageStillRelevant(
  flow: MauticStage | MauticEvent,
  row: Record<string, unknown>,
): boolean {
  if (flow === "paid") return row.stripe_subscription_status === "active";
  if (flow === "cancelled") {
    return row.stripe_cancel_at_period_end === true || row.stripe_subscription_status === "canceled";
  }
  if (flow === "trial_ended") {
    return typeof row.stripe_subscription_status === "string"
      && row.stripe_subscription_status !== "trialing";
  }
  if (flow === "payment_failed") return row.billing_access_state === "payment_recovery";
  return false;
}

function resolveTimeZone(timeZone?: string): string {
  const candidate = timeZone?.trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
