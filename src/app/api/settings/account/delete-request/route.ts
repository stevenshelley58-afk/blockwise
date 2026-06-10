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

  const service = createSupabaseServiceClient();
  const { error } = await service.from("audit_logs").insert({
    workspace_id: access.workspaceId,
    actor_profile_id: access.userId,
    action: "account_deletion_requested",
    target_type: "account",
    target_id: access.userId,
    metadata: { requestedAt: new Date().toISOString(), role: access.role },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Best-effort: delete the auth user via service role. If this fails the audit row
  // still exists as a paper trail and the request is considered received.
  const { error: deleteError } = await service.auth.admin.deleteUser(access.userId);
  if (deleteError) {
    console.error("[delete-request] auth.admin.deleteUser failed:", deleteError.message);
  }

  return NextResponse.json({ ok: true });
}
