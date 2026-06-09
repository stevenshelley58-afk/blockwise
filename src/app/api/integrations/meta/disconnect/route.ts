import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections, requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { loadStoredProviderTokens } from "@/lib/providers/provider-connections";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { workspaceId?: string };

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;

  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: body.workspaceId,
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (!canManageProviderConnections(access.access)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = createSupabaseServiceClient();

  const { data: connection } = await service
    .from("provider_connections")
    .select("id, external_account_id")
    .eq("workspace_id", access.access.workspaceId)
    .eq("provider", "meta")
    .neq("status", "revoked")
    .maybeSingle();

  if (!connection) {
    return NextResponse.json({ error: "No active Meta connection found." }, { status: 404 });
  }

  const tokens = await loadStoredProviderTokens(service, connection.id);

  // Best-effort: revoke the app token via Meta Graph API.
  // A failure here does NOT block the DB revoke — the user must still be disconnected locally.
  if (tokens.accessToken && connection.external_account_id) {
    try {
      await fetch(
        `https://graph.facebook.com/v20.0/${encodeURIComponent(connection.external_account_id)}/permissions`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        },
      );
    } catch {
      // Network errors are non-fatal; proceed with DB revoke.
    }
  }

  const { error } = await service
    .from("provider_connections")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("id", connection.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
