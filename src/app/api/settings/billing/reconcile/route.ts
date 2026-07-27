import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { applyStripeBillingEvent, reconciliationEventForSubscription } from "@/lib/billing/billing-domain";
import { retrieveStripeSubscription } from "@/lib/billing/stripe-scaffold";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  workspaceId?: string;
  clientMutationId?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const guard = await requireApiWorkspace(request, "monitor", body.workspaceId ?? null);
  if (!guard.ok) return guard.response;
  if (!canManageProviderConnections(guard.access)) {
    return NextResponse.json({ error: "Only an owner or admin can reconcile billing." }, { status: 403 });
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("workspaces")
    .select("stripe_subscription_id")
    .eq("id", guard.access.workspaceId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Couldn't load the workspace subscription." }, { status: 500 });
  }
  const subscriptionId = (data as { stripe_subscription_id?: unknown } | null)?.stripe_subscription_id;
  if (typeof subscriptionId !== "string" || !subscriptionId) {
    return NextResponse.json({ error: "No Stripe subscription is connected." }, { status: 409 });
  }

  try {
    const subscription = await retrieveStripeSubscription(subscriptionId);
    const event = reconciliationEventForSubscription(
      subscription,
      reconciliationEventId(subscriptionId, guard.access.workspaceId, body.clientMutationId),
    );
    const result = await applyStripeBillingEvent(service, event);
    return NextResponse.json({ reconciled: true, duplicate: result.outcome === "duplicate" });
  } catch (reconciliationError) {
    console.error("[stripe-billing-reconcile] reconciliation failed", reconciliationError);
    await service
      .from("workspaces")
      .update({ billing_reconciliation_required: true, updated_at: new Date().toISOString() })
      .eq("id", guard.access.workspaceId);
    return NextResponse.json({ error: "Billing reconciliation failed." }, { status: 502 });
  }
}

function reconciliationEventId(
  subscriptionId: string,
  workspaceId: string,
  clientMutationId?: string,
): string {
  const mutationId = clientMutationId?.trim();
  if (mutationId && !/^[A-Za-z0-9_-]{8,100}$/.test(mutationId)) {
    throw new Error("Billing reconciliation mutation ID is invalid.");
  }

  const requestKey = mutationId ?? new Date().toISOString().slice(0, 16);
  return `reconcile:${workspaceId}:${subscriptionId}:${requestKey}`;
}
