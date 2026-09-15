import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  assertCheckoutEnabled,
  VideoCheckoutGatedError,
  VideoOrderError,
} from "@/lib/adbuilder/video-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start payment for a specific video order.
 *
 * The gate runs first, before anything else, and it is server-side. Paid video
 * checkout stays unavailable until the accountant confirms the GST treatment,
 * and because the check reads both the offer's tax treatment and its explicit
 * switch, editing one constant cannot start charging customers.
 *
 * This route currently returns the gate response and nothing else. The Stripe
 * One-off session is deliberately not created yet: a payment-mode session needs
 * `automatic_tax` decided, and Stripe Tax is enabled on this account, so
 * creating a session under an undetermined tax treatment would risk charging
 * the wrong amount. The order-level idempotency below is in place for it.
 */

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

export async function POST(request: NextRequest, context: RouteContext) {
  // The gate is genuinely first: before workspace resolution, before any client
  // is constructed, and before Stripe is reachable. While it is closed this
  // route does no work and touches no customer record, so there is no partially
  // authorised path that could later be reordered into a live charge.
  try {
    assertCheckoutEnabled();
  } catch (error) {
    if (error instanceof VideoCheckoutGatedError) {
      // no-store: a gate answer must never be cached as if it were a payment state.
      return NextResponse.json(
        { error: error.message, gated: true },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    throw error;
  }

  const guard = await requireApiWorkspace(request, "adbuilder");
  if (!guard.ok) return guard.response;

  const { access } = guard;
  const workspaceId = access.workspaceId;

  const params = await context.params;
  const orderId = (params?.id ?? "").trim();
  if (!orderId) return NextResponse.json({ error: "An order is required." }, { status: 400 });

  const limited = await checkRateLimit(workspaceId, access.userId, {
    windowSeconds: 60,
    maxRequests: 10,
    bucket: "video-checkout",
  });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const service = createSupabaseServiceClient();

  // The order must belong to this workspace and still be awaiting payment, so
  // an id from another workspace pays for nothing.
  const { data: order, error } = await service
    .from("video_orders")
    .select("id, workspace_id, project_id, payment_state, fulfilment_state, amount_minor, currency, brief_version_id")
    .eq("id", orderId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "That order could not be loaded." }, { status: 500 });
  if (!order) return NextResponse.json({ error: "That order was not found." }, { status: 404 });
  if (order.payment_state === "paid") {
    // Never take a second payment for an order already paid.
    return NextResponse.json({ error: "This order is already paid.", paid: true }, { status: 409 });
  }

  // The brief must be frozen and complete before payment is offered.
  const { data: brief } = await service
    .from("video_brief_versions")
    .select("id, frozen_at, is_complete")
    .eq("id", order.brief_version_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!brief || !brief.frozen_at || brief.is_complete !== true) {
    return NextResponse.json(
      { error: "Finish your brief before paying." },
      { status: 409 },
    );
  }

  // Unreachable while the gate is closed; kept so the enabled path is explicit
  // and the guard cannot be dropped by accident when checkout is switched on.
  throw new VideoOrderError("blocked", "Video checkout is not available yet.");
}
