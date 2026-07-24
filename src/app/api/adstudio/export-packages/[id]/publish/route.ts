import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { persistAdStudioCampaignPack } from "@/lib/adstudio/persistence";
import { findPackCopyLimitViolations } from "@/lib/adstudio/readiness";
import type { AdStudioCampaignPack } from "@/lib/adstudio";
import type { ApprovalStatus, ProviderConnectionStatus } from "@/lib/publishing/readiness";
import {
  buildAdStudioPublishRequests,
  resolveAdStudioPublishReadiness,
} from "@/lib/providers/publishing-adapters";
import {
  buildMetaPublishPlan,
  loadMetaPublishPlanByIdempotencyKey,
  persistMetaPublishPlan,
  resolveMetaConnectionSetup,
  validateMetaPublishPlanReadiness,
  type MetaConnectionSetup,
  type MetaExecutionAdapter,
  type MetaPublishControls,
  type MetaPublishPlan,
} from "@/lib/providers/meta-execution";
import { queueMetaPublishPlanExecution } from "@/lib/providers/meta-publish-queue";
import {
  listProviderConnections,
  loadStoredProviderTokens,
  type ProviderConnectionMetadata,
} from "@/lib/providers/provider-connections";
import { fetchEligibleMetaCampaigns } from "@/lib/providers/meta-campaigns";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

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
  existingMetaCampaignId?: string;
};

type ApprovalRecord = {
  id: string | null;
  status: ApprovalStatus;
};

type MetaPlanPersistenceResult = {
  plan: MetaPublishPlan;
  reusedActivePlan: boolean;
};

function providerWritesEnabled() {
  return process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
}

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

  // Over-limit copy gets rejected or truncated by Meta — block, don't warn.
  const copyViolations = findPackCopyLimitViolations(pack);
  if (copyViolations.length > 0) {
    return NextResponse.json(
      { error: `Fix the ad copy before publishing: ${copyViolations.join(" ")}` },
      { status: 422 },
    );
  }

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
  const metaConnection =
    connections.find((connection) => connection.provider === "meta" && (connection.status === "connected" || connection.status === "needs_attention"))
    ?? connections.find((connection) => connection.provider === "meta");
  const googleConnection = connections.find((connection) => connection.provider === "google");
  const existingMetaCampaignId = body.existingMetaCampaignId?.trim() || null;

  if (existingMetaCampaignId) {
    if (!metaConnection?.externalAccountId) {
      return NextResponse.json({ error: "Connect Meta before choosing an existing campaign." }, { status: 422 });
    }

    const tokens = await loadStoredProviderTokens(serviceSupabase, metaConnection.id);
    if (!tokens.accessToken) {
      return NextResponse.json({ error: "Reconnect Meta before choosing an existing campaign." }, { status: 422 });
    }

    const eligibleCampaigns = await fetchEligibleMetaCampaigns({
      accessToken: tokens.accessToken,
      accountId: metaConnection.externalAccountId,
    }).catch(() => []);
    if (!eligibleCampaigns.some((campaign) => campaign.id === existingMetaCampaignId)) {
      return NextResponse.json({ error: "Choose an active or paused housing lead campaign from the connected Meta account." }, { status: 422 });
    }
  }
  const providerStatuses = {
    ...(firstCopyPack?.meta ? { meta: publishableConnectionStatus(metaConnection?.status) } : {}),
    ...(firstCopyPack?.googleSearch ? { google: publishableConnectionStatus(googleConnection?.status) } : {}),
  };
  const providerPayloadReadiness = resolveAdStudioPublishReadiness({
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
  const writesEnabled = providerWritesEnabled();
  const metaPublishPlanResult = metaConnection
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
        existingMetaCampaignId,
      })
    : null;
  let metaPublishPlan = metaPublishPlanResult?.plan ?? null;
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

  if (
    publishReady &&
    !body.dryRun &&
    writesEnabled &&
    metaPublishPlan?.adapter === "marketing_api" &&
    !metaPublishPlanResult?.reusedActivePlan
  ) {
    const approvedPlan: MetaPublishPlan = {
      ...metaPublishPlan,
      status: "approved",
      updatedAt: new Date().toISOString(),
    };
    await persistMetaPublishPlan(serviceSupabase, approvedPlan, access.access.userId);
    const run = await queueMetaPublishPlanExecution(approvedPlan);
    triggerRunId = run.id ?? null;
    metaPublishPlan = approvedPlan;
  }

  return NextResponse.json({
    exportPackageId: id,
    publishReady,
    blockers,
    providerWritesEnabled: writesEnabled,
    publishRequests,
    providerPayloadReadiness,
    metaPublishPlan: metaPublishPlan
      ? {
          id: metaPublishPlan.planId,
          status: metaPublishPlan.status,
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

async function createAndPersistMetaPlan(input: {
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>;
  userId: string;
  workspaceId: string;
  campaignPack: AdStudioCampaignPack;
  connection: ProviderConnectionMetadata;
  approval: ApprovalRecord;
  adapter: MetaExecutionAdapter;
  setupPatch?: Partial<MetaConnectionSetup>;
  controls?: MetaPublishControls;
  requestApproval: boolean;
  variantIds?: string[];
  existingMetaCampaignId?: string | null;
}): Promise<MetaPlanPersistenceResult> {
  const setup = mergeConnectionSetup(
    resolveMetaConnectionSetup(input.connection.metadata, input.connection.externalAccountId),
    input.setupPatch,
  );
  let approval = input.approval;
  let plan = buildMetaPublishPlan({
    workspaceId: input.workspaceId,
    campaignPack: input.campaignPack,
    connectionId: input.connection.id,
    setup,
    controls: input.controls,
    adapter: input.adapter,
    approvalRequestId: approval.id,
    variantIds: input.variantIds,
    existingMetaCampaignId: input.existingMetaCampaignId,
  });

  if (!approval.id && input.requestApproval) {
    const createdApproval = await createMetaPublishApproval(input.serviceSupabase, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      temporaryTargetId: plan.planId,
      campaignName: input.campaignPack.campaign.name,
      adapter: input.adapter,
    });
    // Auto-approve: the review step was removed from the UI, so submissions
    // are approved immediately instead of waiting for a separate approval action.
    await input.serviceSupabase
      .from("approval_requests")
      .update({ status: "approved" })
      .eq("id", createdApproval.id)
      .eq("workspace_id", input.workspaceId);
    approval = { id: createdApproval.id, status: "approved" };
    plan = buildMetaPublishPlan({
      workspaceId: input.workspaceId,
      campaignPack: input.campaignPack,
      connectionId: input.connection.id,
      setup,
      controls: input.controls,
      adapter: input.adapter,
      approvalRequestId: approval.id,
      variantIds: input.variantIds,
      existingMetaCampaignId: input.existingMetaCampaignId,
    });
    await input.serviceSupabase
      .from("approval_requests")
      .update({ target_id: plan.planId })
      .eq("id", approval.id)
      .eq("workspace_id", input.workspaceId);
    await input.serviceSupabase.from("audit_logs").insert({
      workspace_id: input.workspaceId,
      actor_profile_id: input.userId,
      action: "meta_publish_approval_requested",
      target_type: "approval_request",
      target_id: approval.id,
      metadata: {
        metaPublishPlanId: plan.planId,
        campaignName: input.campaignPack.campaign.name,
        adapter: input.adapter,
      },
    });
  }

  let persistedPlan: MetaPublishPlan = {
    ...plan,
    approvalRequestId: approval.id,
    status: approval.status === "approved" ? "approved" : "draft",
    updatedAt: new Date().toISOString(),
  };
  const existingPlan = await loadMetaPublishPlanByIdempotencyKey(input.serviceSupabase, {
    workspaceId: input.workspaceId,
    idempotencyKey: persistedPlan.idempotencyKey,
  });

  if (existingPlan && isActivePublishPlanStatus(existingPlan.status)) {
    return { plan: existingPlan, reusedActivePlan: true };
  }

  if (existingPlan) {
    persistedPlan = {
      ...persistedPlan,
      requestLog: existingPlan.requestLog,
      responseLog: existingPlan.responseLog,
      reconciledObjects: existingPlan.reconciledObjects,
      lastError: existingPlan.lastError,
      createdAt: existingPlan.createdAt,
    };
  }

  await persistMetaPublishPlan(input.serviceSupabase, persistedPlan, input.userId);

  return { plan: persistedPlan, reusedActivePlan: false };
}

function isActivePublishPlanStatus(status: MetaPublishPlan["status"]) {
  return status === "approved" || status === "publishing" || status === "paused_live";
}

function mergeConnectionSetup(
  current: MetaConnectionSetup,
  patch: Partial<MetaConnectionSetup> | undefined,
): MetaConnectionSetup {
  if (!patch) return current;

  return resolveMetaConnectionSetup(
    {
      meta: {
        ...current,
        ...patch,
        leadDestination: {
          ...current.leadDestination,
          ...(patch.leadDestination ?? {}),
          config: {
            ...(current.leadDestination.config ?? {}),
            ...(patch.leadDestination?.config ?? {}),
          },
        },
      },
    },
    patch.metaAdAccountId ?? current.metaAdAccountId,
  );
}

async function createMetaPublishApproval(
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>,
  input: {
    workspaceId: string;
    userId: string;
    temporaryTargetId: string;
    campaignName: string;
    adapter: MetaExecutionAdapter;
  },
): Promise<ApprovalRecord> {
  const { data, error } = await serviceSupabase
    .from("approval_requests")
    .insert({
      workspace_id: input.workspaceId,
      target_type: "meta_publish_plan",
      target_id: input.temporaryTargetId,
      status: "requested",
      requested_by: input.userId,
      risk_summary: `Publish paused Meta lead campaign pack "${input.campaignName}" through ${input.adapter}.`,
    })
    .select("id,status")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to create Meta publish approval request.");
  }

  return {
    id: data.id as string,
    status: normalizeApprovalStatus(data.status),
  };
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
): Promise<ApprovalRecord> {
  const uniqueTargetIds = uniqueStrings(targetIds);
  const { data: latestPlan } = await supabase
    .from("meta_publish_plans")
    .select("id,approval_request_id")
    .eq("workspace_id", workspaceId)
    .in("adstudio_campaign_id", uniqueTargetIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const possibleApprovalIds = typeof latestPlan?.approval_request_id === "string" ? [latestPlan.approval_request_id] : [];
  const possibleTargetIds = uniqueStrings([...uniqueTargetIds, ...(typeof latestPlan?.id === "string" ? [latestPlan.id] : [])]);

  if (possibleApprovalIds.length > 0) {
    const { data } = await supabase
      .from("approval_requests")
      .select("id,status")
      .eq("workspace_id", workspaceId)
      .in("id", possibleApprovalIds)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.id) {
      return { id: data.id as string, status: normalizeApprovalStatus(data.status) };
    }
  }

  const { data } = await supabase
    .from("approval_requests")
    .select("id,status")
    .eq("workspace_id", workspaceId)
    .in("target_id", possibleTargetIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    id: typeof data?.id === "string" ? data.id : null,
    status: normalizeApprovalStatus(data?.status),
  };
}

async function loadApprovalById(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  workspaceId: string,
  approvalRequestId: string,
): Promise<ApprovalStatus> {
  const { data } = await supabase
    .from("approval_requests")
    .select("status")
    .eq("workspace_id", workspaceId)
    .eq("id", approvalRequestId)
    .maybeSingle();

  return normalizeApprovalStatus(data?.status);
}

function normalizeApprovalStatus(value: unknown): ApprovalStatus {
  return value === "approved" || value === "rejected" || value === "cancelled" || value === "requested"
    ? value
    : "draft";
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
