import { randomUUID } from "node:crypto";

import type { createSupabaseServiceClient } from "../supabase/service.ts";
import type { StripeObject, StripeWebhookEvent } from "./stripe-scaffold.ts";

type BillingServiceClient = ReturnType<typeof createSupabaseServiceClient>;
type BillingPatch = Record<string, string | number | boolean | null>;
type BillingEventOrdering = { created: number; id: string };

export type BillingEventApplyResult =
  | { outcome: "applied"; workspaceIds: string[] }
  | { outcome: "duplicate"; workspaceIds: [] }
  | { outcome: "ignored"; workspaceIds: []; reason: string };

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);
const REFUND_EVENTS = new Set(["charge.refunded"]);
const DISPUTE_EVENTS = new Set(["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"]);

export async function applyStripeBillingEvent(
  service: BillingServiceClient,
  event: StripeWebhookEvent,
): Promise<BillingEventApplyResult> {
  const attemptId = await claimEvent(service, event);
  if (!attemptId) {
    return { outcome: "duplicate", workspaceIds: [] };
  }

  try {
    const result = await applyClaimedEvent(service, event);
    await finishEvent(service, event.id, attemptId, result.outcome === "ignored" ? "ignored" : "applied");
    return result;
  } catch (error) {
    await finishEvent(
      service,
      event.id,
      attemptId,
      "failed",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

export function reconciliationEventForSubscription(
  subscription: StripeObject,
  reconciliationKey?: string,
): StripeWebhookEvent {
  const subscriptionId = stringValue(subscription.id);
  if (!subscriptionId) {
    throw new Error("Stripe reconciliation returned a subscription without an ID.");
  }

  const status = stringValue(subscription.status) ?? "unknown";
  const periodEnd = integerValue(subscription.current_period_end) ?? periodFromFirstItem(subscription, "current_period_end") ?? 0;
  const cancellation = booleanValue(subscription.cancel_at_period_end) ? "canceling" : "renewing";

  return {
    id:
      reconciliationKey?.trim() ||
      `reconcile:${subscriptionId}:${status}:${periodEnd}:${cancellation}:${stringValue(objectValue(subscription.latest_invoice)?.status) ?? "no_invoice"}`,
    type: "customer.subscription.updated",
    created: Math.floor(Date.now() / 1000),
    data: { object: subscription },
  };
}

async function applyClaimedEvent(
  service: BillingServiceClient,
  event: StripeWebhookEvent,
): Promise<BillingEventApplyResult> {
  const ordering = eventOrdering(event);
  if (event.type === "checkout.session.completed") {
    return applyCheckoutCompleted(service, event.data.object, ordering);
  }
  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    return applySubscription(service, event.type, event.data.object, ordering);
  }
  if (event.type === "invoice.paid") {
    return applyInvoicePaid(service, event.data.object, ordering);
  }
  if (event.type === "invoice.payment_failed") {
    return applyInvoicePaymentFailed(service, event.data.object, ordering);
  }
  if (REFUND_EVENTS.has(event.type)) {
    return applyRefund(service, event.data.object, ordering);
  }
  if (DISPUTE_EVENTS.has(event.type)) {
    return applyDispute(service, event.type, event.data.object, ordering);
  }

  return { outcome: "ignored", workspaceIds: [], reason: "unsupported_event_type" };
}

async function applyCheckoutCompleted(
  service: BillingServiceClient,
  session: StripeObject,
  ordering: BillingEventOrdering,
): Promise<BillingEventApplyResult> {
  const workspaceId = metadataString(session, "workspace_id") ?? stringValue(session.client_reference_id);
  if (!workspaceId) {
    return { outcome: "ignored", workspaceIds: [], reason: "checkout_missing_workspace" };
  }

  const customerId = stringValue(session.customer);
  const subscriptionId = stringValue(session.subscription);
  const patch: BillingPatch = {
    billing_checkout_completed_at: new Date().toISOString(),
    billing_reconciliation_required: false,
  };
  if (customerId) patch.stripe_customer_id = customerId;
  if (subscriptionId) patch.stripe_subscription_id = subscriptionId;
  if (metadataString(session, "offer_key")) patch.billing_offer_key = metadataString(session, "offer_key");
  if (metadataString(session, "offer_version")) patch.billing_offer_version = metadataString(session, "offer_version");
  if (
    (metadataString(session, "offer_key") ?? "").startsWith("self_serve_") &&
    stringValue(session.payment_status) === "paid"
  ) {
    patch.billing_access_state = "paid";
    patch.stripe_subscription_status = "active";
  }
  const workspaceIds = await updateWorkspace(service, { kind: "id", value: workspaceId }, patch, ordering);
  if (workspaceIds.length === 0) {
    return { outcome: "ignored", workspaceIds: [], reason: "checkout_workspace_not_found" };
  }

  const acceptance = checkoutAcceptance(session, workspaceId, customerId, subscriptionId);
  if (acceptance) {
    const { error } = await service
      .from("billing_offer_acceptances")
      .upsert(acceptance, { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  return { outcome: "applied", workspaceIds };
}

async function applySubscription(
  service: BillingServiceClient,
  eventType: string,
  subscription: StripeObject,
  ordering: BillingEventOrdering,
): Promise<BillingEventApplyResult> {
  const status = eventType === "customer.subscription.deleted" ? "canceled" : stringValue(subscription.status);
  if (!status) {
    return { outcome: "ignored", workspaceIds: [], reason: "subscription_missing_status" };
  }

  const patch: BillingPatch = {
    stripe_subscription_status: status,
    stripe_cancel_at_period_end: booleanValue(subscription.cancel_at_period_end),
    billing_access_state: accessStateForSubscription(status),
    billing_payment_recovery_required: isPaymentRecoveryStatus(status),
    billing_reconciliation_required: false,
  };
  const subscriptionId = stringValue(subscription.id);
  const customerId = stringValue(subscription.customer);
  if (subscriptionId) patch.stripe_subscription_id = subscriptionId;
  if (customerId) patch.stripe_customer_id = customerId;

  const periodStart = integerValue(subscription.current_period_start) ?? periodFromFirstItem(subscription, "current_period_start");
  const periodEnd = integerValue(subscription.current_period_end) ?? periodFromFirstItem(subscription, "current_period_end");
  if (periodStart) patch.stripe_current_period_start = stripeTimestamp(periodStart);
  if (periodEnd) patch.stripe_current_period_end = stripeTimestamp(periodEnd);

  const latestInvoice = objectValue(subscription.latest_invoice);
  if (latestInvoice) {
    const invoiceId = stringValue(latestInvoice.id);
    const invoiceStatus = stringValue(latestInvoice.status);
    if (invoiceId) patch.stripe_latest_invoice_id = invoiceId;
    if (invoiceStatus) patch.stripe_latest_invoice_status = invoiceStatus;
    const chargeId = chargeIdFromInvoice(latestInvoice);
    if (chargeId) patch.stripe_latest_charge_id = chargeId;
  }

  const lookup = await resolveWorkspaceLookup(subscription);
  if (!lookup) {
    return { outcome: "ignored", workspaceIds: [], reason: "subscription_missing_identity" };
  }
  const workspaceIds = await updateWorkspace(service, lookup, patch, ordering);
  return workspaceIds.length
    ? { outcome: "applied", workspaceIds }
    : { outcome: "ignored", workspaceIds: [], reason: "subscription_workspace_not_found" };
}

async function applyInvoicePaid(
  service: BillingServiceClient,
  invoice: StripeObject,
  ordering: BillingEventOrdering,
): Promise<BillingEventApplyResult> {
  const amountPaid = integerValue(invoice.amount_paid) ?? 0;
  const patch: BillingPatch = {
    stripe_latest_invoice_status: "paid",
    stripe_latest_invoice_amount_paid: amountPaid,
    billing_reconciliation_required: false,
  };
  const invoiceId = stringValue(invoice.id);
  if (invoiceId) patch.stripe_latest_invoice_id = invoiceId;
  const chargeId = chargeIdFromInvoice(invoice);
  if (chargeId) patch.stripe_latest_charge_id = chargeId;

  if (amountPaid > 0) {
    patch.billing_access_state = "paid";
    patch.billing_risk_state = null;
    patch.billing_payment_recovery_required = false;
    const billingReason = stringValue(invoice.billing_reason);
    if (billingReason === "subscription_create") {
      patch.stripe_intro_invoice_paid_at = new Date().toISOString();
    } else if (billingReason === "subscription_cycle") {
      patch.stripe_last_renewal_paid_at = new Date().toISOString();
    }
  }

  const lookup = await resolveWorkspaceLookup(invoice);
  if (!lookup) {
    throw new Error(`Paid invoice ${invoiceId ?? "unknown"} could not yet be linked to a workspace.`);
  }
  const workspaceIds = await findWorkspaceIds(service, lookup);
  if (workspaceIds.length === 0) {
    throw new Error(`Paid invoice ${invoiceId ?? "unknown"} could not yet be linked to a workspace.`);
  }
  await updateWorkspace(service, lookup, patch, ordering);
  if (
    amountPaid > 0 &&
    ["subscription_create", "subscription_cycle"].includes(stringValue(invoice.billing_reason) ?? "")
  ) {
    await grantPaidPeriodCredits(service, invoice, workspaceIds);
  }
  return { outcome: "applied", workspaceIds };
}

async function grantPaidPeriodCredits(
  service: BillingServiceClient,
  invoice: StripeObject,
  workspaceIds: string[],
) {
  const invoiceId = stringValue(invoice.id);
  const subscriptionId = stringValue(invoice.subscription);
  const period = invoicePeriod(invoice);
  if (!invoiceId || !subscriptionId || !period) {
    throw new Error("Paid subscription invoice is missing its credit-period identity.");
  }

  for (const workspaceId of workspaceIds) {
    const { error } = await service.rpc("grant_stripe_invoice_period_credits", {
      p_workspace_id: workspaceId,
      p_subscription_id: subscriptionId,
      p_invoice_id: invoiceId,
      p_credits: 100,
      p_period_start: stripeTimestamp(period.start),
      p_period_end: stripeTimestamp(period.end),
      p_billing_reason: stringValue(invoice.billing_reason),
      p_metadata: {
        stripeInvoiceId: invoiceId,
        stripeSubscriptionId: subscriptionId,
        billingReason: stringValue(invoice.billing_reason),
      },
    });
    if (error) throw new Error(`Paid invoice credit grant failed: ${error.message}`);
  }
}

async function applyInvoicePaymentFailed(
  service: BillingServiceClient,
  invoice: StripeObject,
  ordering: BillingEventOrdering,
): Promise<BillingEventApplyResult> {
  const patch: BillingPatch = {
    stripe_latest_invoice_status: "payment_failed",
    billing_access_state: "payment_recovery",
    billing_payment_recovery_required: true,
    billing_reconciliation_required: false,
  };
  const invoiceId = stringValue(invoice.id);
  if (invoiceId) patch.stripe_latest_invoice_id = invoiceId;

  return applyByStripeIdentity(service, invoice, patch, "failed_invoice_workspace_not_found", ordering);
}

async function applyRefund(
  service: BillingServiceClient,
  charge: StripeObject,
  ordering: BillingEventOrdering,
): Promise<BillingEventApplyResult> {
  const amount = integerValue(charge.amount) ?? 0;
  const amountRefunded = integerValue(charge.amount_refunded) ?? 0;
  const isFullRefund = booleanValue(charge.refunded) || (amount > 0 && amountRefunded >= amount);
  const patch: BillingPatch = isFullRefund
    ? {
        billing_access_state: "refunded",
        billing_risk_state: "refunded",
        billing_payment_recovery_required: true,
        billing_reconciliation_required: true,
      }
    : { billing_reconciliation_required: true };

  return applyByStripeIdentity(service, charge, patch, "refund_workspace_not_found", ordering);
}

async function applyDispute(
  service: BillingServiceClient,
  eventType: string,
  dispute: StripeObject,
  ordering: BillingEventOrdering,
): Promise<BillingEventApplyResult> {
  const status = stringValue(dispute.status);
  const remainsDisputed = eventType === "charge.dispute.created" || status !== "won";
  const patch: BillingPatch = {
    billing_access_state: remainsDisputed ? "disputed" : "payment_recovery",
    billing_risk_state: "disputed",
    billing_payment_recovery_required: remainsDisputed,
    billing_reconciliation_required: true,
  };

  const charge = objectValue(dispute.charge);
  return applyByStripeIdentity(service, charge ?? dispute, patch, "dispute_workspace_not_found", ordering);
}

async function applyByStripeIdentity(
  service: BillingServiceClient,
  object: StripeObject,
  patch: BillingPatch,
  missingReason: string,
  ordering: BillingEventOrdering,
): Promise<BillingEventApplyResult> {
  const lookup = await resolveWorkspaceLookup(object);
  if (!lookup) return { outcome: "ignored", workspaceIds: [], reason: missingReason };
  const workspaceIds = await updateWorkspace(service, lookup, patch, ordering);
  return workspaceIds.length
    ? { outcome: "applied", workspaceIds }
    : { outcome: "ignored", workspaceIds: [], reason: missingReason };
}

async function resolveWorkspaceLookup(
  object: StripeObject,
): Promise<{ kind: "id" | "subscription" | "customer" | "charge"; value: string } | null> {
  const workspaceId = metadataString(object, "workspace_id");
  if (workspaceId) return { kind: "id", value: workspaceId };
  const subscription = objectValue(object.subscription);
  const subscriptionWorkspaceId = subscription ? metadataString(subscription, "workspace_id") : null;
  if (subscriptionWorkspaceId) return { kind: "id", value: subscriptionWorkspaceId };
  const subscriptionDetails = objectValue(object.subscription_details);
  const invoiceSubscriptionWorkspaceId = subscriptionDetails
    ? metadataString(subscriptionDetails, "workspace_id")
    : null;
  if (invoiceSubscriptionWorkspaceId) return { kind: "id", value: invoiceSubscriptionWorkspaceId };
  const subscriptionId = stringValue(object.subscription);
  if (subscriptionId) return { kind: "subscription", value: subscriptionId };
  const customerId = stringValue(object.customer);
  if (customerId) return { kind: "customer", value: customerId };
  const chargeId = stringValue(object.charge);
  if (chargeId) return { kind: "charge", value: chargeId };
  return null;
}

async function updateWorkspace(
  service: BillingServiceClient,
  lookup: { kind: "id" | "subscription" | "customer" | "charge"; value: string },
  patch: BillingPatch,
  ordering: BillingEventOrdering,
): Promise<string[]> {
  const column = {
    id: "id",
    subscription: "stripe_subscription_id",
    customer: "stripe_customer_id",
    charge: "stripe_latest_charge_id",
  }[lookup.kind];
  const { data, error } = await service
    .from("workspaces")
    .update({
      ...patch,
      billing_event_created: ordering.created,
      billing_event_id: ordering.id,
      updated_at: new Date().toISOString(),
    })
    .eq(column, lookup.value)
    .lte("billing_event_created", ordering.created)
    .select("id");
  if (error) throw new Error(error.message);

  return (data ?? []).flatMap((row) => {
    const id = (row as { id?: unknown }).id;
    return typeof id === "string" ? [id] : [];
  });
}

async function findWorkspaceIds(
  service: BillingServiceClient,
  lookup: { kind: "id" | "subscription" | "customer" | "charge"; value: string },
): Promise<string[]> {
  const column = {
    id: "id",
    subscription: "stripe_subscription_id",
    customer: "stripe_customer_id",
    charge: "stripe_latest_charge_id",
  }[lookup.kind];
  const { data, error } = await service.from("workspaces").select("id").eq(column, lookup.value);
  if (error) throw new Error(error.message);

  return (data ?? []).flatMap((row) => {
    const id = (row as { id?: unknown }).id;
    return typeof id === "string" ? [id] : [];
  });
}

async function claimEvent(service: BillingServiceClient, event: StripeWebhookEvent): Promise<string | null> {
  const attemptId = randomUUID();
  const { data, error } = await service.rpc("claim_stripe_webhook_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_object_id: stringValue(event.data.object.id),
    p_payload: event,
    p_attempt_id: attemptId,
  });
  if (error) throw new Error(error.message);
  return data === true ? attemptId : null;
}

async function finishEvent(
  service: BillingServiceClient,
  eventId: string,
  attemptId: string,
  status: "applied" | "ignored" | "failed",
  errorMessage: string | null = null,
) {
  const { error } = await service.rpc("finish_stripe_webhook_event", {
    p_event_id: eventId,
    p_attempt_id: attemptId,
    p_status: status,
    p_error: errorMessage,
  });
  if (error) throw new Error(error.message);
}

function eventOrdering(event: StripeWebhookEvent): BillingEventOrdering {
  return {
    created: integerValue(event.created) ?? Math.floor(Date.now() / 1000),
    id: event.id,
  };
}

function checkoutAcceptance(
  session: StripeObject,
  workspaceId: string,
  customerId: string | null,
  subscriptionId: string | null,
) {
  const checkoutSessionId = stringValue(session.id);
  const offerKey = metadataString(session, "offer_key");
  const offerVersion = metadataString(session, "offer_version");
  const acceptedAt = metadataString(session, "accepted_at");
  const market = metadataString(session, "market");
  const currency = metadataString(session, "currency");
  const firstInvoiceAmount = metadataInteger(session, "first_invoice_amount");
  const renewalAmount = metadataInteger(session, "renewal_amount");
  const triggeringRule = metadataString(session, "triggering_rule");

  if (
    !checkoutSessionId ||
    !offerKey ||
    !offerVersion ||
    !acceptedAt ||
    !market ||
    !currency ||
    firstInvoiceAmount === null ||
    renewalAmount === null ||
    !triggeringRule
  ) {
    return null;
  }

  return {
    workspace_id: workspaceId,
    stripe_checkout_session_id: checkoutSessionId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    offer_key: offerKey,
    offer_version: offerVersion,
    accepted_at: acceptedAt,
    market,
    currency,
    first_invoice_amount: firstInvoiceAmount,
    renewal_amount: renewalAmount,
    triggering_rule: triggeringRule,
  };
}

function accessStateForSubscription(status: string): string {
  if (status === "trialing") return "trialing";
  if (status === "active") return "paid";
  if (status === "canceled" || status === "incomplete_expired") return "canceled";
  if (isPaymentRecoveryStatus(status)) return "payment_recovery";
  return "unbilled";
}

function isPaymentRecoveryStatus(status: string): boolean {
  return ["past_due", "unpaid", "incomplete", "paused"].includes(status);
}

function periodFromFirstItem(object: StripeObject, key: "current_period_start" | "current_period_end"): number | null {
  const items = objectValue(object.items);
  const data = Array.isArray(items?.data) ? items.data : [];
  const first = objectValue(data[0]);
  return first ? integerValue(first[key]) : null;
}

function invoicePeriod(invoice: StripeObject): { start: number; end: number } | null {
  const lines = objectValue(invoice.lines);
  const data = Array.isArray(lines?.data) ? lines.data : [];
  const firstLine = objectValue(data[0]);
  const period = objectValue(firstLine?.period);
  const start = integerValue(period?.start);
  const end = integerValue(period?.end);
  return start && end && end > start ? { start, end } : null;
}

function chargeIdFromInvoice(invoice: StripeObject): string | null {
  const direct = stringValue(invoice.charge);
  if (direct) return direct;

  const payments = objectValue(invoice.payments);
  const data = Array.isArray(payments?.data) ? payments.data : [];
  const firstPayment = objectValue(data[0]);
  const payment = objectValue(firstPayment?.payment);
  return stringValue(payment?.charge);
}

function metadataString(object: StripeObject, key: string): string | null {
  const value = object.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataInteger(object: StripeObject, key: string): number | null {
  const value = metadataString(object, key);
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const object = objectValue(value);
  return object ? stringValue(object.id) : null;
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function objectValue(value: unknown): StripeObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as StripeObject) : null;
}

function stripeTimestamp(value: number): string {
  return new Date(value * 1000).toISOString();
}
