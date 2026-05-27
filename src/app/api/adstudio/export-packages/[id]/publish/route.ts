import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import type { AdStudioCampaignPack } from "@/lib/adstudio";
import {
  buildAdStudioPublishRequests,
  executeProviderPublishRequest,
  resolveAdStudioPublishReadiness,
} from "@/lib/providers/publishing-adapters";
import {
  listProviderConnections,
  loadStoredProviderTokens,
  type ProviderConnectionMetadata,
} from "@/lib/providers/provider-connections";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ApprovalStatus, ProviderConnectionStatus } from "@/lib/campaigns/publishing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type PublishBody = {
  campaignPack?: AdStudioCampaignPack;
  dryRun?: boolean;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = (await request.json().catch(() => null)) as PublishBody | null;

  if (!body?.campaignPack) {
    return NextResponse.json({ error: "campaignPack is required." }, { status: 400 });
  }

  const pack = body.campaignPack;
  const serviceSupabase = createSupabaseServiceClient();
  const [approvalStatus, connections] = await Promise.all([
    loadApprovalStatus(access.supabase, access.access.workspaceId, [pack.campaign.campaignId, id]),
    listProviderConnections(access.supabase, access.access.workspaceId),
  ]);
  const firstCopyPack = pack.copyPacks[0];
  const metaConnection = connections.find((connection) => connection.provider === "meta");
  const googleConnection = connections.find((connection) => connection.provider === "google");
  const providerStatuses = {
    ...(firstCopyPack?.meta ? { meta: publishableConnectionStatus(metaConnection?.status) } : {}),
    ...(firstCopyPack?.googleSearch ? { google: publishableConnectionStatus(googleConnection?.status) } : {}),
  };
  const readiness = resolveAdStudioPublishReadiness({
    providerStatuses,
    approvalStatus,
    complianceStatus: pack.compliance.status,
    hasDraftPayload: Boolean(firstCopyPack?.meta || firstCopyPack?.googleSearch),
  });
  const publishRequests = buildAdStudioPublishRequests({
    exportPackageId: id,
    workspaceId: access.access.workspaceId,
    metaAccountId: metaConnection?.externalAccountId,
    googleCustomerId: googleConnection?.externalAccountId,
    metaPayload: firstCopyPack?.meta,
    googlePayload: firstCopyPack?.googleSearch,
  });

  if (!readiness.ready || body.dryRun || process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES !== "true") {
    return NextResponse.json({
      exportPackageId: id,
      publishReady: readiness.ready,
      blockers: readiness.blockers,
      providerWritesEnabled: process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true",
      publishRequests,
    });
  }

  const providerResponses = await Promise.all(
    publishRequests.map(async (publishRequest) => {
      const connection = publishRequest.provider === "meta" ? metaConnection : googleConnection;

      if (!connection) {
        throw new Error(`${publishRequest.provider} connection is required for publishing.`);
      }

      const tokens = await loadStoredProviderTokens(serviceSupabase, connection.id);
      const accessToken = tokens.accessToken;

      if (!accessToken) {
        throw new Error(`${publishRequest.provider} access token is missing.`);
      }

      const response = await executeProviderPublishRequest({
        request: publishRequest,
        accessToken,
      });

      await persistPublishStatus(serviceSupabase, {
        workspaceId: access.access.workspaceId,
        campaignId: pack.campaign.campaignId,
        provider: publishRequest.provider,
        response,
      });

      return {
        provider: publishRequest.provider,
        response,
      };
    }),
  );

  return NextResponse.json({
    exportPackageId: id,
    publishReady: true,
    blockers: [],
    providerWritesEnabled: true,
    providerResponses,
  });
}

function publishableConnectionStatus(status: ProviderConnectionMetadata["status"] | undefined): ProviderConnectionStatus {
  if (status === "connected" || status === "needs_attention") {
    return status;
  }

  return "not_connected";
}

async function loadApprovalStatus(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  workspaceId: string,
  targetIds: string[],
): Promise<ApprovalStatus> {
  const { data } = await supabase
    .from("approval_requests")
    .select("status")
    .eq("workspace_id", workspaceId)
    .in("target_id", targetIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.status === "approved" ||
    data?.status === "rejected" ||
    data?.status === "cancelled" ||
    data?.status === "requested"
    ? data.status
    : "draft";
}

async function persistPublishStatus(
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>,
  input: {
    workspaceId: string;
    campaignId: string;
    provider: ProviderConnectionMetadata["provider"];
    response: Record<string, unknown>;
  },
) {
  await serviceSupabase.from("publish_statuses").insert({
    workspace_id: input.workspaceId,
    campaign_id: input.campaignId,
    provider: input.provider,
    status: "published",
    provider_response: input.response,
    updated_at: new Date().toISOString(),
  });
}
