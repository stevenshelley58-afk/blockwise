import { NextResponse, type NextRequest } from "next/server";

import {
  BillingNotConfiguredError,
  constructStripeWebhookEvent,
  StripeWebhookVerificationError,
  type StripeObject,
  type StripeWebhookEvent,
} from "@/lib/billing/stripe-scaffold";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type WorkspaceBillingPatch = {
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_subscription_status?: string | null;
  updated_at: string;
};

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
    await syncStripeBillingEvent(createSupabaseServiceClient(), event);
  } catch (error) {
    console.error("[stripe-billing-webhook] sync failed", error);
    return NextResponse.json({ error: "Stripe billing sync failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function syncStripeBillingEvent(service: SupabaseServiceClient, event: StripeWebhookEvent) {
  if (event.type === "checkout.session.completed") {
    await syncCheckoutSession(service, event.data.object);
    return;
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    await syncSubscription(service, event.data.object);
  }
}

async function syncCheckoutSession(service: SupabaseServiceClient, session: StripeObject) {
  const workspaceId = metadataString(session, "workspace_id") ?? stringValue(session.client_reference_id);

  if (!workspaceId) {
    return;
  }

  const patch: WorkspaceBillingPatch = {
    updated_at: new Date().toISOString(),
  };
  const customerId = stringValue(session.customer);
  const subscriptionId = stringValue(session.subscription);

  if (!customerId && !subscriptionId) {
    return;
  }

  if (customerId) patch.stripe_customer_id = customerId;
  if (subscriptionId) patch.stripe_subscription_id = subscriptionId;

  await updateWorkspaceBillingById(service, workspaceId, patch);
}

async function syncSubscription(service: SupabaseServiceClient, subscription: StripeObject) {
  const workspaceId = metadataString(subscription, "workspace_id");
  const customerId = stringValue(subscription.customer);
  const subscriptionId = stringValue(subscription.id);
  const status = stringValue(subscription.status);
  const patch: WorkspaceBillingPatch = {
    updated_at: new Date().toISOString(),
  };

  if (!customerId && !subscriptionId && !status) {
    return;
  }

  if (customerId) patch.stripe_customer_id = customerId;
  if (subscriptionId) patch.stripe_subscription_id = subscriptionId;
  if (status) patch.stripe_subscription_status = status;

  if (workspaceId) {
    await updateWorkspaceBillingById(service, workspaceId, patch);
    return;
  }

  if (customerId) {
    await updateWorkspaceBillingByCustomer(service, customerId, patch);
  }
}

async function updateWorkspaceBillingById(
  service: SupabaseServiceClient,
  workspaceId: string,
  patch: WorkspaceBillingPatch,
) {
  const { error } = await service.from("workspaces").update(patch).eq("id", workspaceId);

  if (error) {
    throw new Error(error.message);
  }
}

async function updateWorkspaceBillingByCustomer(
  service: SupabaseServiceClient,
  stripeCustomerId: string,
  patch: WorkspaceBillingPatch,
) {
  const { error } = await service.from("workspaces").update(patch).eq("stripe_customer_id", stripeCustomerId);

  if (error) {
    throw new Error(error.message);
  }
}

function metadataString(object: StripeObject, key: string): string | null {
  const value = object.metadata?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;

    return typeof id === "string" && id.trim() ? id.trim() : null;
  }

  return null;
}
