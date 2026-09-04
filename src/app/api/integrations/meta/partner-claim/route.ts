import { after, NextResponse, type NextRequest } from "next/server";

import { recordWorkspaceFunnelEventBestEffort } from "@/lib/analytics/progressive-funnel";
import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { queueReportingRefresh } from "@/lib/meta-monitor/reporting-refresh-queue";
import { resolveMonitorDateRange } from "@/lib/monitor/dashboard-data";
import {
  getMetaPartnerConfig,
  META_PARTNER_SCOPES,
  verifyPartnerAccountAccess,
} from "@/lib/providers/meta-partner";
import { resolveMetaPageAccessToken } from "@/lib/providers/meta-assets";
import { upsertProviderConnectionWithTokens } from "@/lib/providers/provider-connections";
import { syncProviderWorkspace } from "@/lib/providers/provider-sync";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ClaimBody = {
  workspaceId?: string;
  adAccountId?: string;
  adAccountName?: string;
  currency?: string;
  timezone?: string;
};

type AssignmentRow = {
  ad_account_id: string;
  ad_account_name: string;
  page_id: string;
  page_name: string;
  currency: string;
  timezone: string;
};

/**
 * Claim endpoint for Meta partner access. The customer confirms "yes, that's
 * my account"; we verify Blockwise's system token can actually read it, then
 * create the provider connection with that token stored in the vault. From
 * here every existing Meta flow (assets, campaigns, leads, reporting,
 * publishing) works unchanged.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as ClaimBody;
  const guard = await requireApiWorkspace(
    request,
    "monitor",
    body.workspaceId ?? request.nextUrl.searchParams.get("workspaceId"),
  );
  if (!guard.ok) return guard.response;
  const { access } = guard;

  if (!canManageProviderConnections(access)) {
    return NextResponse.json({ error: "Provider connection management is not allowed." }, { status: 403 });
  }

  const adAccountId = body.adAccountId?.trim();
  if (!adAccountId) {
    return NextResponse.json({ error: "No ad account selected." }, { status: 400 });
  }

  const config = getMetaPartnerConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Meta partner access is not configured. Please contact support." },
      { status: 503 },
    );
  }

  const serviceSupabase = createSupabaseServiceClient();
  const { data: assignmentData, error: assignmentError } = await serviceSupabase
    .from("meta_partner_account_assignments")
    .select("ad_account_id,ad_account_name,page_id,page_name,currency,timezone")
    .eq("workspace_id", access.workspaceId)
    .maybeSingle();
  if (assignmentError) return NextResponse.json({ error: assignmentError.message }, { status: 500 });
  const assignment = assignmentData as AssignmentRow | null;
  const normalizedAccountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  if (!assignment || assignment.ad_account_id !== normalizedAccountId) {
    return NextResponse.json(
      { error: "That Meta account has not been verified for this workspace. Contact Blockwise support." },
      { status: 403 },
    );
  }

  // Refuse to persist a connection for an account the token cannot act on.
  // Covers view-only shares and shares revoked before the customer confirmed.
  let accessible = false;
  try {
    accessible = await verifyPartnerAccountAccess(config.systemToken, adAccountId);
  } catch {
    accessible = false;
  }
  if (!accessible) {
    return NextResponse.json(
      {
        error:
          "Blockwise can't access that ad account yet. Make sure Manage campaigns and View performance are turned on, then try again.",
      },
      { status: 409 },
    );
  }

  try {
    await resolveMetaPageAccessToken({ accessToken: config.systemToken, pageId: assignment.page_id });
  } catch {
    return NextResponse.json(
      { error: "Blockwise does not have Page access for this workspace. Share the Page and ask support to verify it." },
      { status: 409 },
    );
  }

  const accountName = assignment.ad_account_name;
  const currency = assignment.currency;
  const timezone = assignment.timezone;

  try {
    await upsertProviderConnectionWithTokens({
      serviceSupabase,
      workspaceId: access.workspaceId,
      userId: access.userId,
      provider: "meta",
      status: "connected",
      scopes: META_PARTNER_SCOPES,
      externalAccountId: normalizedAccountId,
      externalAccountName: accountName,
      accessToken: config.systemToken,
      refreshToken: null,
      tokenExpiresAt: null,
      metadata: {
        connectionMethod: "partner_access",
        blockwiseBusinessId: config.businessId,
        meta: {
          metaAdAccountId: normalizedAccountId,
          metaBusinessId: config.businessId,
          metaBusinessName: "",
          pageId: assignment.page_id,
          instagramActorId: null,
          pixelId: null,
          leadDestination: { type: "manual", label: "Manual review", config: { endpoint: "" } },
          privacyPolicyUrl: defaultPrivacyPolicyUrl(),
          currency,
          timezone,
          tokenExpiresAt: null,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't save the Meta connection.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await recordWorkspaceFunnelEventBestEffort(serviceSupabase, {
    eventName: "meta_connected",
    workspaceId: access.workspaceId,
    idempotencyKey: `meta:${access.workspaceId}:first-connection`,
    properties: { connection_status: "connected", method: "partner_access", account_bound: true },
  });

  // Best-effort first sync + reporting refresh so Results shows real data
  // immediately. A sync failure must not fail the connection.
  try {
    await syncProviderWorkspace({
      supabase: guard.supabase,
      serviceSupabase,
      workspaceId: access.workspaceId,
      provider: "meta",
      range: resolveMonitorDateRange("last_30", new Date()),
    }).catch((syncError) => {
      console.error("[meta-partner-claim] best-effort sync failed:", syncError);
    });
  } catch {
    // non-fatal
  }

  after(async () => {
    await queueReportingRefresh({
      workspaceId: access.workspaceId,
      range: "last_30",
      reason: "connection",
    }).catch(() => undefined);
  });

  return NextResponse.json({
    connected: true,
    adAccountId: normalizedAccountId,
    adAccountName: accountName,
  });
}

function defaultPrivacyPolicyUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return appUrl ? `${appUrl.replace(/\/$/, "")}/privacy` : "";
}
