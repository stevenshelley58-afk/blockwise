import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { DEFAULT_META_GRAPH_VERSION } from "@/lib/providers/meta-graph-version";
import {
  clearStoredProviderTokenSet,
  loadStoredProviderTokens,
  shouldRevokeMetaOAuthGrant,
} from "@/lib/providers/provider-connections";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { workspaceId?: string };
type MetaConnection = { id: string; metadata_json: Record<string, unknown> | null };

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

  const serviceSupabase = createSupabaseServiceClient();

  // Load every historical row. A reconnect can leave older vault entries, so
  // clearing only the newest public row would leave a usable credential behind.
  const { data: connections, error: connErr } = await serviceSupabase
    .from("provider_connections")
    .select("id,metadata_json")
    .eq("workspace_id", access.access.workspaceId)
    .eq("provider", "meta")
    .order("updated_at", { ascending: false });

  if (connErr) {
    console.error("[meta/disconnect] provider_connections query failed:", connErr.message);
    return NextResponse.json({ error: connErr.message }, { status: 500 });
  }

  const rows = (connections ?? []) as MetaConnection[];
  const latest = rows[0];

  // Capture an OAuth token for best-effort remote revocation, but do not call
  // Meta until local credentials and public status have been cleared. Partner
  // access uses a shared system-user token and is never remotely revoked here.
  let revokeAccessToken: string | null = null;
  if (latest && shouldRevokeMetaOAuthGrant(latest.metadata_json)) {
    try {
      revokeAccessToken = (await loadStoredProviderTokens(serviceSupabase, latest.id)).accessToken;
    } catch (err) {
      console.error("[meta/disconnect] revoke token lookup error:", err);
    }
  }

  // Clear every vault entry before changing public status. Readers reject
  // revoked rows, and a vault failure is surfaced rather than claiming a
  // disconnected workspace is safe while its credential may still work.
  try {
    await clearStoredProviderTokenSet(serviceSupabase, rows.map((row) => row.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not clear the Meta token vault.";
    console.error("[meta/disconnect] token vault clear failed:", message);
    return NextResponse.json({ error: "Could not securely clear the Meta connection." }, { status: 500 });
  }

  // Always update status to revoked in the DB regardless of whether the API revoke succeeded.
  const { error: updateErr } = await serviceSupabase
    .from("provider_connections")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("workspace_id", access.access.workspaceId)
    .eq("provider", "meta");

  if (updateErr) {
    console.error("[meta/disconnect] status update failed:", updateErr.message);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Best-effort remote revocation after local safety boundaries are complete.
  // A timeout prevents a provider outage from holding the disconnect request.
  if (revokeAccessToken) {
    try {
      const revokeUrl = new URL(`https://graph.facebook.com/${DEFAULT_META_GRAPH_VERSION}/me/permissions`);
      revokeUrl.searchParams.set("access_token", revokeAccessToken);
      const revokeRes = await fetch(revokeUrl.toString(), {
        method: "DELETE",
        signal: AbortSignal.timeout(15_000),
      });
      if (!revokeRes.ok) {
        console.error("[meta/disconnect] Meta revoke failed with status:", revokeRes.status);
      }
    } catch (err) {
      console.error("[meta/disconnect] revoke error:", err instanceof Error ? err.message : "unknown error");
    }
  }

  return NextResponse.json({ success: true });
}