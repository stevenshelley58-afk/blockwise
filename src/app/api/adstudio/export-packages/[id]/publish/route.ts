import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { persistAdStudioCampaignPack } from "@/lib/adstudio/persistence";
import type { AdStudioCampaignPack } from "@/lib/adstudio";
import { loadApprovalById, loadApprovalStatus, uniqueStrings } from "@/lib/publishing/approvals";
import { createAndPersistMetaPlan, publishableConnectionStatus } from "@/lib/publishing/meta-plan";
import {
  buildAdStudioPublishRequests,
  resolveAdStudioPublishReadiness,
} from "@/lib/providers/publishing-adapters";
import {
  persistMetaPublishPlan,
  validateMetaPublishPlanReadiness,
  type MetaConnectionSetup,
  type MetaExecutionAdapter,
  type MetaPublishControls,
  type MetaPublishPlan,
} from "@/lib/providers/meta-execution";
import { queueMetaPublishPlanExecution } from "@/lib/providers/meta-publish-queue";
import { listProviderConnections } from "@/lib/providers/provider-connections";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type PublishBody = {
  campaignPack?: AdStudioCampaignPack;
  dryRun?: boolean;
  adapter?: MetaExecutionAdapter;
  metaSetup?: Partial<MetaConnectionSetup>;
  controls?: MetaPublishControls;
  requestApproval?: boolean;
  /** A/B publish (A6): plan only these variants — one ad set, one tagged ad per variant. Absent = full pack (unchanged). */
  variantIds?: string[];
};

const WRITES_ENABLED = process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";

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
  const persistResult = await persistAdStudioCampaignPack(access.supabase, pack, access.access.userId);

  if (persistResult.error) {
    return NextResponse.json({ error: persistResult.error.message }, { status: 500 });
  }

  const [existingApproval, connections] = await Promise.all([
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
  const legacyReadiness = resolveAdStudioPublishReadiness({
    providerStatuses,
    approvalStatus: existingApproval.status,
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
    validateOnly: true,
  });
  const metaPublishPlan = metaConnection
    ? await createAndPersistMetaPlan({
        serviceSupabase,
        userId: access.access.userId,
        workspaceId: access.access.workspaceId,
        campaignPack: pack,
        connection: metaConnection,
        approval: existingApproval,
        adapter: body.adapter ?? "marketing_api",
        setupPatch: body.metaSetup,
        controls: body.controls,
        requestApproval: body.requestApproval ?? !body.dryRun,
        variantIds: body.variantIds,
      })
    : null;
  const metaReadiness = metaPublishPlan
    ? validateMetaPublishPlanReadiness(metaPublishPlan, {
        approvalStatus: metaPublishPlan.approvalRequestId ? await loadApprovalById(access.supabase, access.access.workspaceId, metaPublishPlan.approvalRequestId) : "draft",
        providerConnectionStatus: publishableConnectionStatus(metaConnection?.status),
        complianceStatus: pack.compliance.status,
      })
    : { ready: false, blockers: firstCopyPack?.meta ? ["Meta account is not connected."] : [] };
  const adapterBlockers = metaPublishPlan?.adapter && metaPublishPlan.adapter !== "marketing_api"
    ? [`${metaPublishPlan.adapter} is read-only for diagnostics and cannot publish yet.`]
    : [];
  const blockers = uniqueStrings([...metaReadiness.blockers, ...adapterBlockers]);
  const publishReady = blockers.length === 0;
  let triggerRunId: string | null = null;

  if (publishReady && !body.dryRun && WRITES_ENABLED && metaPublishPlan?.adapter === "marketing_api") {
    const approvedPlan: MetaPublishPlan = {
      ...metaPublishPlan,
      status: "approved",
      updatedAt: new Date().toISOString(),
    };
    await persistMetaPublishPlan(serviceSupabase, approvedPlan, access.access.userId);
    const run = await queueMetaPublishPlanExecution(approvedPlan);
    triggerRunId = run.id ?? null;
  }

  return NextResponse.json({
    exportPackageId: id,
    publishReady,
    blockers,
    providerWritesEnabled: WRITES_ENABLED,
    publishRequests,
    providerPayloadReadiness: legacyReadiness,
    metaPublishPlan: metaPublishPlan
      ? {
          id: metaPublishPlan.planId,
          status: publishReady ? "approved" : metaPublishPlan.status,
          adapter: metaPublishPlan.adapter,
          approvalRequestId: metaPublishPlan.approvalRequestId,
          idempotencyKey: metaPublishPlan.idempotencyKey,
          setup: metaPublishPlan.setup,
          plannedObjects: {
            adSets: metaPublishPlan.adSets.length,
            leadForms: metaPublishPlan.leadForms.length,
            creatives: metaPublishPlan.creatives.length,
            ads: metaPublishPlan.ads.length,
          },
          // Additive: which Ad Studio variants the planned ads map to (A6).
          variantIds: metaPublishPlan.ads
            .map((ad) => ad.variantTag?.variantId)
            .filter((variantId): variantId is string => Boolean(variantId)),
        }
      : null,
    triggerRunId,
  });
}
