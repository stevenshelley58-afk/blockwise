import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { BillingNotConfiguredError, createBillingPortalSession } from "@/lib/billing/stripe-scaffold";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { workspaceId?: string };

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;

  const guard = await requireApiWorkspace(request, "monitor", body.workspaceId ?? null);

  if (!guard.ok) return guard.response;
  const { access } = guard;
  if (!canManageProviderConnections(access)) {
    return NextResponse.json({ error: "Only an owner or admin can manage billing." }, { status: 403 });
  }

  // select("*") so this still works before the billing columns migration is applied.
  const service = createSupabaseServiceClient();
  const { data: ws } = await service.from("workspaces").select("*").eq("id", access.workspaceId).maybeSingle();
  const stripeCustomerId = (ws as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null;

  try {
    const session = await createBillingPortalSession({
      workspaceId: access.workspaceId,
      stripeCustomerId,
      returnUrl: new URL("/settings", request.url).toString(),
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof BillingNotConfiguredError) {
      return NextResponse.json({ error: "billing_not_configured", message: "Billing is coming soon." }, { status: 200 });
    }
    return NextResponse.json({ error: "Couldn't open billing right now." }, { status: 500 });
  }
}
