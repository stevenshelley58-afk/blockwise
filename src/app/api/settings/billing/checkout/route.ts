import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { isBillingConfigured, createCheckoutSession } from "@/lib/billing/stripe-scaffold";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { workspaceId?: string; planKey?: string };

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
  const { data: ws } = await service.from("workspaces").select("*").eq("id", access.workspaceId).maybeSingle();
  const stripeCustomerId = (ws as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null;

  const { data: profile } = await supabase.auth.getUser();
  const customerEmail = profile.user?.email ?? null;

  try {
    const session = await createCheckoutSession({
      workspaceId: access.workspaceId,
      planKey: body.planKey ?? null,
      stripeCustomerId,
      customerEmail,
      userId: profile.user?.id ?? null,
      successUrl: new URL("/settings?billing=success", request.url).toString(),
      cancelUrl: new URL("/settings", request.url).toString(),
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't start checkout right now.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
