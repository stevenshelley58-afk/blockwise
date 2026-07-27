import { NextResponse, type NextRequest } from "next/server";

import { recordWorkspaceFunnelEventBestEffort } from "@/lib/analytics/progressive-funnel";
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

  if (!state) {
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

  if (!code) {
    return NextResponse.redirect(
      providerReturnUrl(
        verified.payload.returnPath,
        origin,
        { error: request.nextUrl.searchParams.get("error") ?? "missing_code" },
        verified.payload.campaignId ?? null,
      ),
    );
  }

  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: verified.payload.workspaceId,
  });

  if (!access.ok || !canManageProviderConnections(access.access)) {
    return NextResponse.redirect(
      providerReturnUrl(
        verified.payload.returnPath,
        origin,
        { error: "forbidden" },
        verified.payload.campaignId ?? null,
      ),
    );
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
    await recordMetaConnected(
      serviceSupabase,
      verified.payload.workspaceId,
      exchanged.status,
      exchanged.externalAccountId,
    );
  } catch (error) {
    // Duplicate callback requests (double navigation, browser re-requests)
    // re-exchange an already-used code, which Meta rejects. The first request
    // has usually saved the connection by then, so a duplicate must not
    // surface a false "connection failed" error. If a fresh connection exists
    // for this workspace, treat the duplicate as a success.
    const recent = await loadFreshMetaConnection(serviceSupabase, verified.payload.workspaceId);

    if (recent) {
      await recordMetaConnected(
        serviceSupabase,
        verified.payload.workspaceId,
        "connected",
        recent.external_account_id ?? undefined,
      );
      return NextResponse.redirect(
        providerReturnUrl(
          verified.payload.returnPath,
          origin,
          recent.external_account_id === "meta_account_pending"
            ? { connected: "1", status: "needs_account" }
            : { connected: "1" },
          verified.payload.campaignId ?? null,
        ),
      );
    }

    const message = error instanceof Error ? error.message : "Meta connection failed.";
    return NextResponse.redirect(
      providerReturnUrl(verified.payload.returnPath, origin, { error: message }, verified.payload.campaignId ?? null),
    );
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
      verified.payload.campaignId ?? null,
    ),
  );
}

async function recordMetaConnected(
  service: ReturnType<typeof createSupabaseServiceClient>,
  workspaceId: string,
  status: string,
  externalAccountId?: string,
): Promise<void> {
  await recordWorkspaceFunnelEventBestEffort(service, {
    eventName: "meta_connected",
    workspaceId,
    idempotencyKey: `meta:${workspaceId}:first-connection`,
    properties: {
      connection_status: status,
      account_bound: Boolean(externalAccountId && externalAccountId !== "meta_account_pending"),
    },
  });
}

const FRESH_CONNECTION_WINDOW_MS = 2 * 60 * 1000;

async function loadFreshMetaConnection(
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>,
  workspaceId: string,
): Promise<{ external_account_id: string | null } | null> {
  // Latest row only: historical sibling rows can exist for a workspace, and
  // maybeSingle() without limit(1) errors on multiples, which would silently
  // disable this idempotent success path.
  const { data } = await serviceSupabase
    .from("provider_connections")
    .select("external_account_id, status, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("provider", "meta")
    .order("updated_at", { ascending: false })
    .limit(1)
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

function providerReturnUrl(
  returnPath: string,
  origin: string,
  params: Record<string, string>,
  campaignId: string | null,
): URL {
  const url = new URL(sanitizeOAuthReturnPath(returnPath), origin);
  url.searchParams.set("integration", "meta");
  if (campaignId) url.searchParams.set("campaignId", campaignId);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}
