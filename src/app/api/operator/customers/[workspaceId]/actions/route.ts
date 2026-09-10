import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import {
  OperatorCustomerActionError,
  runOperatorCustomerAction,
} from "@/lib/operator/customers";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { workspaceId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(workspaceId)) {
    return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
    mutationId?: unknown;
    reason?: unknown;
    creditDelta?: unknown;
  };
  const action = typeof body.action === "string" ? body.action : "";
  if (!["adjust_credits", "resend_booking", "complete_onboarding", "approve_managed_scope"].includes(action)) {
    return NextResponse.json({ error: "Unsupported customer action." }, { status: 400 });
  }
  const mutationId = typeof body.mutationId === "string" ? body.mutationId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!mutationId || mutationId.length > 160 || !reason || reason.length > 500) {
    return NextResponse.json({ error: "Mutation ID and reason are required." }, { status: 400 });
  }
  try {
    const result = await runOperatorCustomerAction({
      workspaceId,
      operatorProfileId: auth.userId,
      action: action as "adjust_credits" | "resend_booking" | "complete_onboarding" | "approve_managed_scope",
      mutationId,
      reason,
      creditDelta: body.creditDelta === undefined ? undefined : Number(body.creditDelta),
      serviceSupabase: createSupabaseServiceClient(),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof OperatorCustomerActionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Operator customer action failed", error);
    return NextResponse.json({ error: "Customer action failed." }, { status: 500 });
  }
}
