import { NextResponse, type NextRequest } from "next/server";

import { readJsonBody } from "@/lib/adbuilder/http";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { claimOrder, deliverFinal, FulfilmentError, publishDraft } from "@/lib/adbuilder/video-fulfilment-actions";
import { loadFulfilmentQueue } from "@/lib/adbuilder/video-fulfilment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The operator fulfilment queue endpoint, and the actions on one order.
 *
 * Operator-only: every request is checked for the operator role before any
 * order is read or changed, and an operator action is never something a
 * customer can invoke.
 */

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "operator");
  if (!guard.ok) return guard.response;
  if (!guard.access.isOperator) {
    // A non-operator gets the same answer as a missing page, so the surface
    // cannot be probed for existence.
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const includeDelivered = request.nextUrl.searchParams.get("includeDelivered") === "1";
  const service = createSupabaseServiceClient();

  try {
    const orders = await loadFulfilmentQueue(service, { includeDelivered });
    return NextResponse.json({ orders });
  } catch {
    return NextResponse.json({ error: "The queue could not be loaded." }, { status: 500 });
  }
}

type ActionBody = {
  action?: string;
  workspaceId?: string;
  orderId?: string;
  assetId?: string;
  notes?: string;
};

export async function POST(request: NextRequest) {
  const body = await readJsonBody<ActionBody>(request);
  const guard = await requireApiWorkspace(request, "operator", body.workspaceId ?? undefined);
  if (!guard.ok) return guard.response;
  if (!guard.access.isOperator) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const orderId = (body.orderId ?? "").trim();
  if (!orderId) return NextResponse.json({ error: "An order is required." }, { status: 400 });

  const service = createSupabaseServiceClient();
  const operatorId = guard.access.userId;

  try {
    switch (body.action) {
      case "claim": {
        const result = await claimOrder({ supabase: service, orderId, operatorId });
        return NextResponse.json(result);
      }
      case "draft": {
        const assetId = (body.assetId ?? "").trim();
        if (!assetId) return NextResponse.json({ error: "A draft file is required." }, { status: 400 });
        const result = await publishDraft({ supabase: service, orderId, operatorId, assetId, notes: body.notes ?? null });
        return NextResponse.json(result);
      }
      case "deliver": {
        const assetId = (body.assetId ?? "").trim();
        if (!assetId) return NextResponse.json({ error: "A final file is required." }, { status: 400 });
        const result = await deliverFinal({ supabase: service, orderId, operatorId, assetId });
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof FulfilmentError) {
      const status =
        error.kind === "invalid" ? 400 : error.kind === "conflict" ? 409 : error.kind === "forbidden" ? 403 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "That action could not be completed." }, { status: 500 });
  }
}
