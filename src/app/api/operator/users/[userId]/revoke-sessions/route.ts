import { NextResponse } from "next/server";

import { isOwnerRole, requireOperator } from "@/lib/operator/auth";
import { recordAuditLog } from "@/lib/supabase/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ userId: string }> };

/**
 * Owner-only operator action: revoke a user's sessions by banning the
 * account. GoTrue invalidates refresh tokens immediately; outstanding access
 * tokens expire within their short TTL. Unban (ban_duration "none") restores
 * login. Used for offboarding, compromise response and the break-glass/
 * rotation runbook. Audited with named actor, target and reason.
 */
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
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason || reason.length > 500) {
    return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  }

  const admin = createSupabaseServiceClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
  if (error) {
    console.error("[operator] session revocation failed", error.message);
    return NextResponse.json({ error: "Revocation failed." }, { status: 502 });
  }

  await recordAuditLog(auth.supabase, {
    workspaceId: null,
    actorProfileId: auth.userId,
    action: "operator.revoke_sessions",
    targetType: "auth_user",
    targetId: userId,
    correlationId: null,
    metadata: { reason, operatorEmail: auth.email, operatorRole: auth.role },
  });

  return NextResponse.json({ ok: true, revokedFor: userId });
}
