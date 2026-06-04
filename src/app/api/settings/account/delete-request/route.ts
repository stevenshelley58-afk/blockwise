import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
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

  const service = createSupabaseServiceClient();
  const { error } = await service.from("audit_logs").insert({
    workspace_id: access.access.workspaceId,
    actor_profile_id: access.access.userId,
    action: "account_deletion_requested",
    target_type: "account",
    target_id: access.access.userId,
    metadata: { requestedAt: new Date().toISOString(), role: access.access.role },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
