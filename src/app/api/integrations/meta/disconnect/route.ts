import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { loadStoredProviderTokens } from "@/lib/providers/provider-connections";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const META_GRAPH_VERSION = process.env.META_GRAPH_API_VERSION ?? process.env.META_API_VERSION ?? "v19.0";

type Body = { workspaceId?: string };

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;

  const guard = await requireApiWorkspace(request, "monitor", body.workspaceId ?? null);

  if (!guard.ok) return guard.response;
  const { access } = guard;

  if (!canManageProviderConnections(access)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const serviceSupabase = createSupabaseServiceClient();

  // Load the connection row to get its id and then the stored tokens.
  const { data: connection, error: connErr } = await serviceSupabase
    .from("provider_connections")
    .select("id")
    .eq("workspace_id", access.workspaceId)
    .eq("provider", "meta")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (connErr) {
    console.error("[meta/disconnect] provider_connections query failed:", connErr.message);
  }

  // Best-effort: revoke the app grant via Meta Graph API.
  if (connection) {
    try {
      const tokens = await loadStoredProviderTokens(serviceSupabase, connection.id);
      if (tokens.accessToken) {
        const revokeUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/permissions`);
        revokeUrl.searchParams.set("access_token", tokens.accessToken);
        const revokeRes = await fetch(revokeUrl.toString(), { method: "DELETE" });
        if (!revokeRes.ok) {
          const body = await revokeRes.text().catch(() => "");
          console.error("[meta/disconnect] Meta revoke failed:", revokeRes.status, body);
        }
      }
    } catch (err) {
      console.error("[meta/disconnect] revoke error:", err);
    }
  }

  // Always update status to revoked in the DB regardless of whether the API revoke succeeded.
  const { error: updateErr } = await serviceSupabase
    .from("provider_connections")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("workspace_id", access.workspaceId)
    .eq("provider", "meta");

  if (updateErr) {
    console.error("[meta/disconnect] status update failed:", updateErr.message);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
