import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { workspaceId?: string };

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;

  const guard = await requireApiWorkspace(request, "monitor", body.workspaceId ?? null);

  if (!guard.ok) return guard.response;
  const { access } = guard;
  if (access.role !== "owner") {
    return NextResponse.json({ error: "Only the workspace owner can request workspace deletion." }, { status: 403 });
  }

  const service = createSupabaseServiceClient();
  const requestedAt = new Date().toISOString();
  const [{ error }, { error: auditError }] = await Promise.all([
    service.from("account_deletion_requests").upsert({
      workspace_id: access.workspaceId,
      requested_by: access.userId,
      status: "requested",
      requested_at: requestedAt,
      updated_at: requestedAt,
    }, { onConflict: "workspace_id", ignoreDuplicates: false }),
    service.from("audit_logs").insert({
      workspace_id: access.workspaceId,
      actor_profile_id: access.userId,
      action: "account_deletion_requested",
      target_type: "workspace",
      target_id: access.workspaceId,
      metadata: { requestedAt, role: access.role },
    }),
  ]);

  if (error || auditError) {
    console.error("[delete-request] persistence failed", error ?? auditError);
    return NextResponse.json({ error: (error ?? auditError)?.message ?? "Deletion request failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
