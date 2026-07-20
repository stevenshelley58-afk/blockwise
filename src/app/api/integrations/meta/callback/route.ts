import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { resolveMonitorDateRange } from "@/lib/monitor/dashboard-data";
import { exchangeProviderCode } from "@/lib/providers/oauth-handlers";
import { upsertProviderConnectionWithTokens } from "@/lib/providers/provider-connections";
import { syncProviderWorkspace } from "@/lib/providers/provider-sync";
import { sanitizeOAuthReturnPath, verifyOAuthState } from "@/lib/providers/oauth-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return handleCallback(request);
}

async function handleCallback(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const origin = request.nextUrl.origin;

  if (!code || !state) {
    return NextResponse.redirect(new URL("/results?integration=meta&error=missing_code", origin));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const verified = verifyOAuthState(state, {
    expectedProvider: "meta",
    expectedUserId: user.id,
  });

  if (!verified.ok) {
    return NextResponse.redirect(new URL("/results?integration=meta&error=invalid_state", origin));
  }

  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: verified.payload.workspaceId,
  });

  if (!access.ok || !canManageProviderConnections(access.access)) {
    return NextResponse.redirect(providerReturnUrl(verified.payload.returnPath, origin, { error: "forbidden" }));
  }

  const serviceSupabase = createSupabaseServiceClient();

  let exchangedAccountId: string | undefined;

  try {
    const exchanged = await exchangeProviderCode("meta", request, code);
    exchangedAccountId = exchanged.externalAccountId;
    await upsertProviderConnectionWithTokens({
      serviceSupabase,
      workspaceId: verified.payload.workspaceId,
      userId: user.id,
      provider: "meta",
      status: exchanged.status,
      scopes: exchanged.scopes,
      externalAccountId: exchanged.externalAccountId,
      externalAccountName: exchanged.externalAccountName,
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
      metadata: exchanged.metadata,
      tokenExpiresAt: exchanged.tokenExpiresAt,
    });
  } catch (error) {
    // Duplicate callback requests (double navigation, browser re-requests)
    // re-exchange an already-used code, which Meta rejects. The first request
    // has usually saved the connection by then, so a duplicate must not
    // surface a false "connection failed" error. If a fresh connection exists
    // for this workspace, treat the duplicate as a success.
    const recent = await loadFreshMetaConnection(serviceSupabase, verified.payload.workspaceId);

    if (recent) {
      return NextResponse.redirect(
        providerReturnUrl(
          verified.payload.returnPath,
          origin,
          recent.external_account_id === "meta_account_pending"
            ? { connected: "1", status: "needs_account" }
            : { connected: "1" },
        ),
      );
    }

    const message = error instanceof Error ? error.message : "Meta connection failed.";
    return NextResponse.redirect(providerReturnUrl(verified.payload.returnPath, origin, { error: message }));
  }

  // Best-effort first sync so the dashboard shows real data immediately after
  // connecting. A sync failure must NOT fail the connection itself.
  try {
    await syncProviderWorkspace({
      supabase,
      serviceSupabase,
      workspaceId: verified.payload.workspaceId,
      provider: "meta",
      range: resolveMonitorDateRange("last_30"),
      jobKey: "connect-auto-sync",
    });
  } catch {
    // Connection is already saved; the first sync can be retried later.
  }

  return NextResponse.redirect(
    providerReturnUrl(
      verified.payload.returnPath,
      origin,
      exchangedAccountId === "meta_account_pending"
        ? { connected: "1", status: "needs_account" }
        : { connected: "1" },
    ),
  );
}

const FRESH_CONNECTION_WINDOW_MS = 2 * 60 * 1000;

async function loadFreshMetaConnection(
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>,
  workspaceId: string,
): Promise<{ external_account_id: string | null } | null> {
  const { data } = await serviceSupabase
    .from("provider_connections")
    .select("external_account_id, status, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("provider", "meta")
    .maybeSingle();

  const row = data as { external_account_id: string | null; status: string; updated_at: string | null } | null;

  if (!row || (row.status !== "connected" && row.status !== "needs_attention")) {
    return null;
  }

  const updatedMs = row.updated_at ? Date.parse(row.updated_at) : Number.NaN;

  if (!Number.isFinite(updatedMs) || Date.now() - updatedMs > FRESH_CONNECTION_WINDOW_MS) {
    return null;
  }

  return row;
}

function providerReturnUrl(returnPath: string, origin: string, params: Record<string, string>): URL {
  const url = new URL(sanitizeOAuthReturnPath(returnPath), origin);
  url.searchParams.set("integration", "meta");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}
