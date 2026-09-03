import { NextResponse } from "next/server";

import { isOwnerRole, requireOperator } from "@/lib/operator/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { recordAuditLog } from "@/lib/supabase/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  if (!isOwnerRole(auth)) {
    return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
  }

  const { userId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(userId)) {
    return NextResponse.json({ error: "Invalid user." }, { status: 400 });
  }
  if (userId === auth.userId) {
    return NextResponse.json({ error: "Cannot revoke your own sessions." }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason || reason.length > 500) {
    return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  }

  const admin = createSupabaseServiceClient();
  const { data: target } = await admin
    .from("profiles")
    .select("is_operator, operator_role")
    .eq("id", userId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

  if (target.is_operator === true && target.operator_role === "owner") {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("is_operator", true)
      .eq("operator_role", "owner");
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: "Cannot revoke the last owner." }, { status: 409 });
    }
  }

  const correlationId = crypto.randomUUID();
  const intent = await admin.from("audit_logs").insert({
    workspace_id: null,
    actor_profile_id: auth.userId,
    action: "operator.revoke_sessions.intent",
    target_type: "auth_user",
    target_id: userId,
    correlation_id: correlationId,
    metadata: { reason, operatorEmail: auth.email, operatorRole: auth.role, phase: "intent" },
  });
  if (intent.error) {
    console.error("[operator] revocation intent audit failed", intent.error.message);
    return NextResponse.json({ error: "Revocation could not be recorded." }, { status: 503 });
  }

  const { error } = await admin.auth.admin.signOut(userId, "global");
  const result = await admin.from("audit_logs").insert({
    workspace_id: null,
    actor_profile_id: auth.userId,
    action: "operator.revoke_sessions",
    target_type: "auth_user",
    target_id: userId,
    correlation_id: correlationId,
    metadata: { reason, operatorEmail: auth.email, operatorRole: auth.role, phase: error ? "failed" : "complete", error: error?.message ?? null },
  });
  if (result.error) {
    console.error("[operator] revocation result audit failed", result.error.message);
  }
  if (error) {
    console.error("[operator] session revocation failed", error.message);
    return NextResponse.json({ error: "Revocation failed." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, revokedFor: userId });
}
