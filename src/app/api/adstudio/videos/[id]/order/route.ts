import { NextResponse, type NextRequest } from "next/server";

import { readJsonBody } from "@/lib/adstudio/http";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { submitBriefAndCreateOrder, VideoOrderError } from "@/lib/adstudio/video-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Submit a commissioned brief and open its order.
 *
 * Creating the order is separate from paying for it, and this route never
 * touches Stripe. The order starts in `awaiting_payment`, the brief is frozen,
 * and checkout is a distinct authorised step. That separation is what lets the
 * customer resume a saved brief after abandoning a payment page, and it means
 * an incomplete brief can never reach a payment screen.
 *
 * The order records the price, deliverable, deadline rules and revision
 * allowance it was sold on, so a later change to the offer config cannot alter
 * an existing customer's terms.
 */

type OrderBody = {
  workspaceId?: string;
  objective?: string;
  audience?: string;
  desiredAction?: string;
  keyFacts?: string;
  overlayWording?: string;
  wantsWordingHelp?: boolean;
  transcript?: string;
  referenceUrl?: string;
  musicPreference?: "house_licensed" | "customer_supplied" | "none";
  uploadPermissionConfirmed?: boolean;
};

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

export async function POST(request: NextRequest, context: RouteContext) {
  const body = await readJsonBody<OrderBody>(request);
  const guard = await requireApiWorkspace(request, "adstudio", body.workspaceId ?? undefined);
  if (!guard.ok) return guard.response;

  const { access } = guard;
  const workspaceId = access.workspaceId;
  const params = await context.params;
  const projectId = (params?.id ?? "").trim();
  if (!projectId) return NextResponse.json({ error: "A video is required." }, { status: 400 });

  const limited = await checkRateLimit(workspaceId, access.userId, {
    windowSeconds: 60,
    maxRequests: 20,
    bucket: "video-order-create",
  });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const service = createSupabaseServiceClient();

  try {
    const order = await submitBriefAndCreateOrder({
      supabase: service,
      workspaceId,
      projectId,
      createdBy: access.userId,
      brief: {
        objective: body.objective ?? null,
        audience: body.audience ?? null,
        desiredAction: body.desiredAction ?? null,
        keyFacts: body.keyFacts ?? null,
        overlayWording: body.overlayWording ?? null,
        wantsWordingHelp: body.wantsWordingHelp === true,
        transcript: body.transcript ?? null,
        referenceUrl: body.referenceUrl ?? null,
        musicPreference: body.musicPreference ?? "house_licensed",
        uploadPermissionConfirmed: body.uploadPermissionConfirmed === true,
      },
    });

    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    if (error instanceof VideoOrderError) {
      const status = error.kind === "invalid" ? 400 : error.kind === "conflict" ? 409 : 500;
      return NextResponse.json({ error: error.message, issues: error.issues }, { status });
    }
    return NextResponse.json({ error: "Your order could not be created." }, { status: 500 });
  }
}
