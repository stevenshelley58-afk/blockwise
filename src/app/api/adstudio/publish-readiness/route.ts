import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { listProviderConnections } from "@/lib/providers/provider-connections";
import { resolveMetaConnectionSetup, validateMetaConnectionSetup } from "@/lib/providers/meta-execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProviderReadiness = {
  connected: boolean;
  status: string;
  accountId: string | null;
};

/**
 * Read-only publish readiness check.
 *
 * Reports whether the workspace is set up to publish live ads to Meta
 * WITHOUT creating anything. Live publishing stays gated behind
 * BLOCKWISE_ENABLE_PROVIDER_WRITES plus connected accounts and platform app
 * review. This endpoint never writes to a provider.
 */
export async function GET(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const writesEnabled = process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
  const campaignId = request.nextUrl.searchParams.get("campaignId");
  const connections = await listProviderConnections(context.supabase, context.access.workspaceId);

  const metaConnection =
    connections.find((connection) => connection.provider === "meta" && (connection.status === "connected" || connection.status === "needs_attention"))
    ?? connections.find((connection) => connection.provider === "meta");
  const metaSetup = resolveMetaConnectionSetup(metaConnection?.metadata ?? {}, metaConnection?.externalAccountId);
  const metaSetupBlockers = metaConnection?.status === "connected" ? validateMetaConnectionSetup(metaSetup) : [];
  const metaReadiness: ProviderReadiness = {
    connected: metaConnection?.status === "connected",
    status: metaConnection?.status ?? "not_connected",
    accountId: metaConnection?.externalAccountId ?? null,
  };

  const [compliance, approval] = campaignId
    ? await Promise.all([
        loadLatestComplianceStatus(context.supabase, context.access.workspaceId, campaignId),
        loadLatestApprovalStatus(context.supabase, context.access.workspaceId, campaignId),
      ])
    : [null, null];

  const checklist = [
    {
      id: "meta_connected",
      label: "Connect a Meta ad account",
      done: metaReadiness.connected,
      automatic: true,
    },
    ...(metaReadiness.connected && metaSetupBlockers.length === 0
      ? [{
          id: "meta_setup",
          label: "Complete Meta publishing setup",
          done: true,
          automatic: true,
        }]
      : metaSetupBlockers.map((blocker, index) => ({
          id: `meta_setup_${index + 1}`,
          label: blocker,
          done: false,
          automatic: true,
        }))),
    {
      id: "provider_writes",
      label: writesEnabled
        ? "Live publishing is available"
        : "Live publishing is in final platform review - export your creatives, or we'll email you when it opens.",
      done: writesEnabled,
      automatic: true,
      blocked: !writesEnabled,
    },
    ...(campaignId
      ? [
          {
            id: "compliance_passed",
            label: "Compliance check passed",
            done: compliance === "approved",
            automatic: true,
          },
          {
            id: "approval_ready",
            label: approval === "approved" ? "Approval complete" : "Campaign approval complete",
            done: approval === "approved",
            automatic: true,
          },
        ]
      : []),
  ];

  const blockers = checklist.filter((item) => !item.done).map((item) => item.label);
  const ready = blockers.length === 0;

  return NextResponse.json({
    workspaceId: context.access.workspaceId,
    providerWritesEnabled: writesEnabled,
    providers: {
      meta: metaReadiness,
    },
    setup: metaSetup,
    blockers,
    checklist,
    ready,
    note: "Read-only Meta check - no ads are created. Live publishing remains disabled until every step is complete.",
  });
}

async function loadLatestComplianceStatus(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  workspaceId: string,
  campaignId: string,
) {
  const { data } = await supabase
    .from("adstudio_compliance_reports")
    .select("status")
    .eq("workspace_id", workspaceId)
    .eq("campaign_id", campaignId)
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return typeof data?.status === "string" ? data.status : null;
}

async function loadLatestApprovalStatus(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  workspaceId: string,
  campaignId: string,
) {
  const { data: latestPlan } = await supabase
    .from("meta_publish_plans")
    .select("id,approval_request_id")
    .eq("workspace_id", workspaceId)
    .eq("adstudio_campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const approvalIds = typeof latestPlan?.approval_request_id === "string" ? [latestPlan.approval_request_id] : [];
  const targetIds = [campaignId, ...(typeof latestPlan?.id === "string" ? [latestPlan.id] : [])];
  const query = supabase
    .from("approval_requests")
    .select("status")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1);

  const { data } = approvalIds.length
    ? await query.in("id", approvalIds)
    : await query.in("target_id", targetIds);

  return typeof data?.[0]?.status === "string" ? data[0].status : null;
}
