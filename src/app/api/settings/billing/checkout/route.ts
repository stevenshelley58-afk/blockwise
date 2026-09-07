import { NextResponse, type NextRequest } from "next/server";

import { recordWorkspaceFunnelEventBestEffort } from "@/lib/analytics/progressive-funnel";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { evaluateCheckoutRequest } from "@/lib/billing/checkout-policy";
import {
  findReusableCheckoutSession,
  recordCheckoutSession,
} from "@/lib/billing/checkout-sessions";
import { isBillingConfigured, createCheckoutSession, findReusableStripeCheckoutSession } from "@/lib/billing/stripe-scaffold";
import { publicOrigin } from "@/lib/config/public-origin";
import { getBillingOffer } from "@/lib/billing/offers";
import type { BillingProduct } from "@/lib/billing/offers";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  workspaceId?: string;
  product?: BillingProduct;
  clientMutationId?: string;
};

export async function POST(request: NextRequest) {
  if (!isBillingConfigured()) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;

  const guard = await requireApiWorkspace(request, "monitor", body.workspaceId ?? null);

  if (!guard.ok) return guard.response;
  const { supabase, access } = guard;

  const product = body.product ?? "self_serve";
  if (product !== "self_serve" && product !== "managed") {
    return NextResponse.json({ error: "Unknown billing product." }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const [
    { data: ws, error: workspaceError },
    { data: activation, error: activationError },
  ] = await Promise.all([
    service
      .from("workspaces")
      .select(
        "stripe_customer_id, stripe_subscription_id, billing_access_state, country_code, billing_currency, managed_scope_approved_at",
      )
      .eq("id", access.workspaceId)
      .maybeSingle(),
    service
      .from("customer_activations")
      .select("country_confirmed_at")
      .eq("workspace_id", access.workspaceId)
      .maybeSingle(),
  ]);
  if (workspaceError) {
    return NextResponse.json({ error: "Couldn't load the workspace billing market." }, { status: 500 });
  }
  if (activationError) {
    return NextResponse.json({ error: "Couldn't verify the workspace market confirmation." }, { status: 500 });
  }

  const decision = evaluateCheckoutRequest({
    facts: {
      countryConfirmedAt: (activation as { country_confirmed_at?: unknown } | null)?.country_confirmed_at as
        | string
        | null
        | undefined ?? null,
      countryCode: (ws as { country_code?: unknown } | null)?.country_code as string | null,
      billingCurrency: (ws as { billing_currency?: unknown } | null)?.billing_currency as string | null,
      billingAccessState: (ws as { billing_access_state?: unknown } | null)?.billing_access_state as string | null,
      stripeSubscriptionId: (ws as { stripe_subscription_id?: unknown } | null)?.stripe_subscription_id as
        | string
        | null,
      managedScopeApprovedAt: (ws as { managed_scope_approved_at?: unknown } | null)?.managed_scope_approved_at as
        | string
        | null,
    },
    context: { role: access.role, product },
  });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: decision.status });
  }

  const stripeCustomerId =
    typeof (ws as { stripe_customer_id?: unknown } | null)?.stripe_customer_id === "string"
      ? ((ws as { stripe_customer_id?: unknown }).stripe_customer_id as string)
      : null;

  const { data: profile } = await supabase.auth.getUser();
  const customerEmail = profile.user?.email ?? null;
  const offer = getBillingOffer("AU", product);

  // Reuse an eligible open Checkout session so retries never create competing
  // subscriptions. Expired sessions are never reused; a fresh one is created.
  try {
    const reusable =
      (await findReusableCheckoutSession(service, access.workspaceId, offer.key).catch(() => null)) ??
      (await findReusableStripeCheckoutSession({
        workspaceId: access.workspaceId,
        offerKey: offer.key,
      }).catch(() => null));
    if (reusable) {
      return NextResponse.json({ url: reusable.url });
    }
  } catch {
    // Reuse is an optimization; fall through to session creation.
  }

  try {
    const session = await createCheckoutSession({
      workspaceId: access.workspaceId,
      market: "AU",
      currency: "AUD",
      product,
      stripeCustomerId,
      customerEmail,
      userId: profile.user?.id ?? null,
      successUrl: `${publicOrigin(request.url)}/settings?billing=success`,
      cancelUrl: `${publicOrigin(request.url)}/settings`,
      idempotencyKey: checkoutIdempotencyKey(access.workspaceId, product, body.clientMutationId),
    });
    await recordCheckoutSession(service, {
      workspaceId: access.workspaceId,
      offerKey: offer.key,
      session,
    });
    await recordWorkspaceFunnelEventBestEffort(service, {
      eventName: "checkout_started",
      workspaceId: access.workspaceId,
      idempotencyKey: `billing:${access.workspaceId}:checkout-started:${product}`,
      properties: {
        product,
        market: "AU",
        currency: "AUD",
      },
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't start checkout right now.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function checkoutIdempotencyKey(workspaceId: string, product: BillingProduct, clientMutationId?: string): string | null {
  const mutationId = clientMutationId?.trim();
  if (!mutationId) return null;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(mutationId)) {
    throw new Error("Checkout mutation ID is invalid.");
  }
  return `checkout:${workspaceId}:${product}:${mutationId}`;
}
