import type { AdStudioCampaignPack } from "../adstudio/index.ts";
import {
  buildMetaPublishPlan,
  persistMetaPublishPlan,
  resolveMetaConnectionSetup,
  type MetaConnectionSetup,
  type MetaExecutionAdapter,
  type MetaPublishControls,
  type MetaPublishPlan,
} from "../providers/meta-execution.ts";
import type { ProviderConnectionMetadata } from "../providers/provider-connections.ts";
import { recordAuditLog } from "../supabase/audit.ts";
import type { createSupabaseServiceClient } from "../supabase/service.ts";
import { normalizeApprovalStatus, type ApprovalRecord } from "./approvals.ts";
import type { ProviderConnectionStatus } from "./readiness.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export function publishableConnectionStatus(
  status: ProviderConnectionMetadata["status"] | undefined,
): ProviderConnectionStatus {
  if (status === "connected" || status === "needs_attention") {
    return status;
  }

  return "not_connected";
}

/**
 * Builds the Meta publish plan for a campaign pack, creating (and auditing)
 * an approval request when none exists yet, and persists the plan.
 */
export async function createAndPersistMetaPlan(input: {
  serviceSupabase: SupabaseServiceClient;
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
}): Promise<MetaPublishPlan> {
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
  });

  if (!approval.id && input.requestApproval) {
    approval = await createMetaPublishApproval(input.serviceSupabase, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      temporaryTargetId: plan.planId,
      campaignName: input.campaignPack.campaign.name,
      adapter: input.adapter,
    });
    plan = buildMetaPublishPlan({
      workspaceId: input.workspaceId,
      campaignPack: input.campaignPack,
      connectionId: input.connection.id,
      setup,
      controls: input.controls,
      adapter: input.adapter,
      approvalRequestId: approval.id,
      variantIds: input.variantIds,
    });
    await input.serviceSupabase
      .from("approval_requests")
      .update({ target_id: plan.planId })
      .eq("id", approval.id)
      .eq("workspace_id", input.workspaceId);
    await recordAuditLog(input.serviceSupabase, {
      workspaceId: input.workspaceId,
      actorProfileId: input.userId,
      action: "meta_publish_approval_requested",
      targetType: "approval_request",
      targetId: approval.id,
      metadata: {
        metaPublishPlanId: plan.planId,
        campaignName: input.campaignPack.campaign.name,
        adapter: input.adapter,
      },
    });
  }

  const persistedPlan: MetaPublishPlan = {
    ...plan,
    approvalRequestId: approval.id,
    status: approval.status === "approved" ? "approved" : "draft",
    updatedAt: new Date().toISOString(),
  };
  await persistMetaPublishPlan(input.serviceSupabase, persistedPlan, input.userId);

  return persistedPlan;
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
  serviceSupabase: SupabaseServiceClient,
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
