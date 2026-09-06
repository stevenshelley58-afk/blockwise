import { NextResponse, type NextRequest } from "next/server";

import {
  recordWorkspaceFunnelEventBestEffort,
  type BillingFunnelEventName,
} from "@/lib/analytics/progressive-funnel";
import { applyStripeBillingEvent } from "@/lib/billing/billing-domain";
import { markCheckoutSessionBestEffort } from "@/lib/billing/checkout-sessions";
import {
  BillingNotConfiguredError,
  constructStripeWebhookEvent,
  retrieveStripeCharge,
  retrieveStripeSubscription,
  StripeWebhookVerificationError,
  type StripeObject,
  type StripeWebhookEvent,
} from "@/lib/billing/stripe-scaffold";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  let event: StripeWebhookEvent;
  try {
    event = constructStripeWebhookEvent(payload, signature);
  } catch (error) {
    if (error instanceof BillingNotConfiguredError) {
      return NextResponse.json({ error: "Stripe webhook secret is not configured." }, { status: 501 });
    }
    if (error instanceof StripeWebhookVerificationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid Stripe webhook payload." }, { status: 400 });
  }

  try {
    const authoritativeEvent = await expandStripeReferences(event);
    const service = createSupabaseServiceClient();
    await syncCheckoutSessionBookkeeping(service, authoritativeEvent);
    const result = await applyStripeBillingEvent(service, authoritativeEvent);
    if (result.outcome === "applied") {
      await recordAppliedBillingEvents(service, authoritativeEvent, result.workspaceIds);
    }
    return NextResponse.json({
      received: true,
      duplicate: result.outcome === "duplicate",
      applied: result.outcome === "applied",
    });
  } catch (error) {
    console.error("[stripe-billing-webhook] domain sync failed", error);
    return NextResponse.json({ error: "Stripe billing sync failed." }, { status: 500 });
  }
}

/**
 * Keep local Checkout session rows in sync so a retried Checkout reuses the
 * eligible open session and never creates a competing subscription.
 */
async function syncCheckoutSessionBookkeeping(
  service: ReturnType<typeof createSupabaseServiceClient>,
  event: StripeWebhookEvent,
): Promise<void> {
  const sessionId = typeof event.data.object.id === "string" ? event.data.object.id : null;
  if (!sessionId) return;
  if (event.type === "checkout.session.completed") {
    await markCheckoutSessionBestEffort(service, sessionId, "completed");
  } else if (event.type === "checkout.session.expired") {
    await markCheckoutSessionBestEffort(service, sessionId, "expired");
  }
}

async function recordAppliedBillingEvents(
  service: ReturnType<typeof createSupabaseServiceClient>,
  event: StripeWebhookEvent,
  workspaceIds: string[],
): Promise<void> {
  const eventNames = billingFunnelEventNames(event);
  await Promise.all(
    workspaceIds.flatMap((workspaceId) =>
      eventNames.map((eventName) =>
        recordWorkspaceFunnelEventBestEffort(service, {
          eventName,
          workspaceId,
          idempotencyKey: billingFunnelIdempotencyKey(event, eventName, workspaceId),
          occurredAt: event.created ? new Date(event.created * 1000) : undefined,
          properties: {
            stripe_event_type: event.type,
            offer_key: metadataValue(event.data.object, "offer_key"),
          },
        }),
      ),
    ),
  );
}

function billingFunnelEventNames(event: StripeWebhookEvent): BillingFunnelEventName[] {
  if (event.type === "checkout.session.completed") {
    return (metadataValue(event.data.object, "offer_key") ?? "").startsWith("managed_")
      ? ["checkout_completed", "managed_checkout"]
      : ["checkout_completed"];
  }
  if (event.type === "invoice.paid") {
    const amountPaid = numberValue(event.data.object.amount_paid);
    if (amountPaid <= 0) return [];
    const reason = stringValue(event.data.object.billing_reason);
    if (reason === "subscription_create") return ["first_invoice_paid"];
    if (reason === "subscription_cycle") return ["first_renewal_paid"];
  }
  if (event.type === "invoice.payment_failed") return ["payment_failed"];
  if (
    event.type === "customer.subscription.deleted" ||
    (event.type === "customer.subscription.updated" &&
      event.data.object.cancel_at_period_end === true)
  ) {
    return ["cancellation"];
  }
  return [];
}

function billingFunnelIdempotencyKey(
  event: StripeWebhookEvent,
  eventName: BillingFunnelEventName,
  workspaceId: string,
): string {
  return eventName === "payment_failed"
    ? `stripe:${event.id}:${eventName}:${workspaceId}`
    : `billing:${workspaceId}:${eventName}`;
}

function metadataValue(object: StripeObject, key: string): string | null {
  const value = object.metadata?.[key];
  return typeof value === "string" && value ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function expandStripeReferences(event: StripeWebhookEvent): Promise<StripeWebhookEvent> {
  if (event.type === "invoice.paid" && typeof event.data.object.subscription === "string") {
    const subscription = await retrieveStripeSubscription(event.data.object.subscription);
    return {
      ...event,
      data: {
        object: {
          ...event.data.object,
          subscription,
        },
      },
    };
  }

  if (!event.type.startsWith("charge.dispute.")) return event;
  const charge = event.data.object.charge;
  if (typeof charge !== "string") return event;

  const authoritativeCharge = await retrieveStripeCharge(charge);
  return {
    ...event,
    data: {
      object: {
        ...event.data.object,
        charge: authoritativeCharge as StripeObject,
      },
    },
  };
}
