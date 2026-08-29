import { NextResponse, type NextRequest } from "next/server";

import { recordWorkspaceFunnelEventBestEffort } from "@/lib/analytics/progressive-funnel";
import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import {
  currencyForMarket,
  isBillingCurrency,
  isBillingMarket,
  isBillingProduct,
  type BillingProduct,
} from "@/lib/billing/offers";
import { isBillingConfigured, createCheckoutSession } from "@/lib/billing/stripe-scaffold";
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
  if (!canManageProviderConnections(access)) {
    return NextResponse.json({ error: "Only an owner or admin can manage billing." }, { status: 403 });
  }

  const service = createSupabaseServiceClient();
  const [
    { data: ws, error: workspaceError },
    { data: activation, error: activationError },
  ] = await Promise.all([
    service
      .from("workspaces")
      .select("stripe_customer_id, country_code, billing_currency")
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
  if (!(activation as { country_confirmed_at?: unknown } | null)?.country_confirmed_at) {
    return NextResponse.json({ error: "Confirm the workspace country before starting Checkout." }, { status: 409 });
  }
  const workspace = ws as {
    stripe_customer_id?: unknown;
    country_code?: unknown;
    billing_currency?: unknown;
  } | null;
  if (!isBillingMarket(workspace?.country_code) || !isBillingCurrency(workspace?.billing_currency)) {
    return NextResponse.json({ error: "Confirm the workspace country before starting Checkout." }, { status: 409 });
  }
  if (workspace.billing_currency !== currencyForMarket(workspace.country_code)) {
    return NextResponse.json({ error: "The workspace billing currency does not match its country." }, { status: 409 });
  }
  const product = body.product ?? "self_serve";
  if (!isBillingProduct(product)) {
    return NextResponse.json({ error: "Unknown billing product." }, { status: 400 });
  }
  const stripeCustomerId =
    typeof workspace.stripe_customer_id === "string" ? workspace.stripe_customer_id : null;

  const { data: profile } = await supabase.auth.getUser();
  const customerEmail = profile.user?.email ?? null;

  try {
    const session = await createCheckoutSession({
      workspaceId: access.workspaceId,
      market: workspace.country_code,
      currency: workspace.billing_currency,
      product,
      stripeCustomerId,
      customerEmail,
      userId: profile.user?.id ?? null,
      successUrl: new URL("/settings?billing=success", request.url).toString(),
      cancelUrl: new URL("/settings", request.url).toString(),
      idempotencyKey: checkoutIdempotencyKey(access.workspaceId, product, body.clientMutationId),
    });
    await recordWorkspaceFunnelEventBestEffort(service, {
      eventName: "checkout_started",
      workspaceId: access.workspaceId,
      idempotencyKey: `billing:${access.workspaceId}:checkout-started:${product}`,
      properties: {
        product,
        market: workspace.country_code,
        currency: workspace.billing_currency,
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
