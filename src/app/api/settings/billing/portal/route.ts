import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections, requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { BillingNotConfiguredError, createBillingPortalSession } from "@/lib/billing/stripe-scaffold";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { workspaceId?: string };

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;

  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, { surface: "monitor", requestedWorkspaceId: body.workspaceId });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  if (!canManageProviderConnections(access.access)) {
    return NextResponse.json({ error: "Only an owner or admin can manage billing." }, { status: 403 });
  }

  // select("*") so this still works before the billing columns migration is applied.
  const service = createSupabaseServiceClient();
  const { data: ws } = await service.from("workspaces").select("*").eq("id", access.access.workspaceId).maybeSingle();
  const stripeCustomerId = (ws as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null;

  try {
    const session = await createBillingPortalSession({
      workspaceId: access.access.workspaceId,
      stripeCustomerId,
      returnUrl: new URL("/settings", request.url).toString(),
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof BillingNotConfiguredError) {
      return NextResponse.json({ error: "Billing isn't connected yet. Add Stripe keys to enable it." }, { status: 501 });
    }
    return NextResponse.json({ error: "Couldn't open billing right now." }, { status: 500 });
  }
}
