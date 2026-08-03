import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  buildAdStudioLibrarySelectionPack,
  type AdStudioCreativeLibrarySelection,
} from "@/lib/adstudio/creative-library";
import { loadAdStudioCampaignPack, persistAdStudioCampaignPack } from "@/lib/adstudio/persistence";
import { findPackCopyLimitViolations } from "@/lib/adstudio/readiness";
import type { AdStudioCampaignPack } from "@/lib/adstudio";
import type { ApprovalStatus, ProviderConnectionStatus } from "@/lib/publishing/readiness";
import {
  buildAdStudioPublishRequests,
  resolveAdStudioPublishReadiness,
} from "@/lib/providers/publishing-adapters";
import {
  buildMetaPublishPlan,
  hasExplicitMetaPublishAudience,
  loadMetaPublishPlanByIdempotencyKey,
  persistMetaPublishPlan,
  resolveMetaConnectionSetup,
  validateMetaConnectionSetup,
  validateMetaPublishPlanReadiness,
  type MetaConnectionSetup,
  type MetaExecutionAdapter,
  type MetaPublishControls,
  type MetaPublishPlan,
} from "@/lib/providers/meta-execution";
import {
  hasActiveMetaPublishPlanExecution,
  queueMetaPublishPlanExecution,
} from "@/lib/providers/meta-publish-queue";
import {
  listProviderConnections,
  loadStoredProviderTokens,
  type ProviderConnectionMetadata,
} from "@/lib/providers/provider-connections";
import { checkMetaConnectionHealth } from "@/lib/providers/meta-assets";
import {
  fetchEligibleMetaCampaigns,
  metaExistingCampaignReuseIssue,
} from "@/lib/providers/meta-campaigns";
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
  /** A/B publish (A6): plan only these variants — one ad set, one tagged ad per variant. Absent = full pack (unchanged). */
  variantIds?: string[];
  librarySelections?: AdStudioCreativeLibrarySelection[];
  existingMetaCampaignId?: string;
};

type ApprovalRecord = {
  id: string | null;
  status: ApprovalStatus;
};

type MetaPlanPersistenceResult = {
  plan: MetaPublishPlan;
  approval: ApprovalRecord;
  reusedActivePlan: boolean;
};

function providerWritesEnabled() {
  return process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
}

/**
 * Resolves the Meta connection's real publishable status from live token health
 * and setup completeness, ignoring the denormalised `status` column. That column
 * is written by several paths (OAuth callback, Settings GET/PATCH, a scheduled
 * health task) with inconsistent criteria, and the scheduled task has been
 * failing to run — so a healthy, fully-configured connection can sit at
 * "needs_attention" and block every publish. The source of truth is the token
 * itself plus the setup, so check those and persist the result so the dashboard
 * and subsequent reads stop trusting the stale flag.
 */
async function reconcileMetaConnectionStatus(
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>,
  connection: ProviderConnectionMetadata,
): Promise<ProviderConnectionStatus> {
  try {
    const tokens = await loadStoredProviderTokens(serviceSupabase, connection.id);
    const health = await checkMetaConnectionHealth({
      accessToken: tokens.accessToken ?? "",
      tokenExpiresAt: connection.tokenExpiresAt,
    });
    const tokenUsable = health.status === "healthy" || health.status === "expiring_soon";
    const setupClean = validateMetaConnectionSetup(
      resolveMetaConnectionSetup(connection.metadata, connection.externalAccountId),
    ).length === 0;
    const reconciled: ProviderConnectionStatus = tokenUsable && setupClean ? "connected" : "needs_attention";

    if (reconciled !== connection.status) {
      await serviceSupabase
        .from("provider_connections")
        .update({
          status: reconciled,
          health_status: health.status,
          health_checked_at: health.checkedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", connection.id)
        .eq("workspace_id", connection.workspaceId)
        .eq("provider", "meta");
    }

    return reconciled;
  } catch {
    // A transient health-check failure must not block publish harder than the
    // stored status already would — fall back to it.
    return publishableConnectionStatus(connection.status);
  }
}

/**
 * Filters the campaign pack's compliance issues to only those relevant to Meta,
 * then re-evaluates the status. The compliance report is global — Google Search
 * structural issues (missing headlines, images, etc.) must not block a Meta-only
 * publish. Only Meta-relevant blocking issues should gate the Meta publish.
 */
function metaScopedComplianceStatus(
  compliance: AdStudioCampaignPack["compliance"],
): AdStudioCampaignPack["compliance"]["status"] {
  const metaIssues = compliance.issues.filter((issue) => !issue.code.startsWith("google_"));
  if (metaIssues.some((issue) => issue.severity === "blocking")) {
    return "blocked";
  }
  return metaIssues.length > 0 ? "needs_review" : "approved";
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

  const basePack = body.campaignPack;
  const existingMetaCampaignId = body.existingMetaCampaignId?.trim() || null;
  if (existingMetaCampaignId && !hasExplicitMetaPublishAudience(body.controls)) {
    return NextResponse.json(
      { error: "Choose the audience for the new ad set before using an existing Meta campaign." },
      { status: 422 },
    );
  }
  const librarySelections = normalizeLibrarySelections(body.librarySelections);
  if (librarySelections instanceof NextResponse) return librarySelections;

  const sourcePacks = librarySelections.length > 0
    ? await Promise.all(
        [...new Set(librarySelections.map((selection) => selection.campaignId))]
          .map((campaignId) => loadAdStudioCampaignPack(
            access.supabase,
            access.access.workspaceId,
            campaignId,
          )),
      )
    : [];
  if (sourcePacks.some((pack) => pack === null)) {
    return NextResponse.json(
      { error: "One of the selected ads is no longer available. Refresh the page and choose it again." },
      { status: 422 },
    );
  }

  let pack = basePack;
  if (librarySelections.length > 0) {
    try {
      pack = buildAdStudioLibrarySelectionPack(
        basePack,
        sourcePacks.filter((sourcePack): sourcePack is AdStudioCampaignPack => sourcePack !== null),
        librarySelections,
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "The selected ads could not be prepared." },
        { status: 422 },
      );
    }
  }

  // Over-limit copy gets rejected or truncated by Meta — block, don't warn.
  const copyViolations = findPackCopyLimitViolations(pack);
  if (copyViolations.length > 0) {
    return NextResponse.json(
      { error: `Fix the ad copy before publishing: ${copyViolations.join(" ")}` },
      { status: 422 },
    );
  }

  const serviceSupabase = createSupabaseServiceClient();
  const persistResult = await persistAdStudioCampaignPack(access.supabase, basePack, access.access.userId);

  if (persistResult.error) {
    return NextResponse.json({ error: persistResult.error.message }, { status: 500 });
  }

  if (existingMetaCampaignId) {
    const { data: workspaceBilling, error: workspaceBillingError } = await serviceSupabase
      .from("workspaces")
      .select("billing_access_state,billing_offer_key,billing_offer_version,stripe_subscription_status")
      .eq("id", access.access.workspaceId)
      .single();
    if (workspaceBillingError || !workspaceBilling) {
      return NextResponse.json(
        { error: "Campaign eligibility could not be verified. Try again in a moment." },
        { status: 503 },
      );
    }
    const reuseIssue = metaExistingCampaignReuseIssue({
      billingAccessState: workspaceBilling.billing_access_state,
      billingOfferKey: workspaceBilling.billing_offer_key,
      billingOfferVersion: workspaceBilling.billing_offer_version,
      stripeSubscriptionStatus: workspaceBilling.stripe_subscription_status,
    });
    if (reuseIssue) {
      return NextResponse.json({ error: reuseIssue }, { status: 422 });
    }
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
  let existingMetaCampaignBudgetMode: "campaign" | "adset" | undefined;

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
    const selectedExistingCampaign = eligibleCampaigns.find((campaign) => campaign.id === existingMetaCampaignId);
    if (!selectedExistingCampaign) {
      return NextResponse.json({ error: "Choose an active or paused housing lead campaign from the connected Meta account." }, { status: 422 });
    }
    existingMetaCampaignBudgetMode = selectedExistingCampaign.budgetMode;
  }
  // Reconcile the Meta connection from live health/setup rather than the stale
  // stored status (see reconcileMetaConnectionStatus).
  const metaConnectionStatus = metaConnection
    ? await reconcileMetaConnectionStatus(serviceSupabase, metaConnection)
    : ("not_connected" as ProviderConnectionStatus);
  const providerStatuses = {
    ...(firstCopyPack?.meta ? { meta: metaConnectionStatus } : {}),
    ...(firstCopyPack?.googleSearch ? { google: publishableConnectionStatus(googleConnection?.status) } : {}),
  };
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
        requestApproval: !body.dryRun,
        variantIds: librarySelections.length > 0
          ? pack.variants.map((variant) => variant.variantId)
          : body.variantIds,
        existingMetaCampaignId,
        existingMetaCampaignBudgetMode,
      })
    : null;
  let metaPublishPlan = metaPublishPlanResult?.plan ?? null;
  const scopedComplianceStatus = metaScopedComplianceStatus(pack.compliance);
  const providerPayloadReadiness = resolveAdStudioPublishReadiness({
    providerStatuses,
    approvalStatus: metaPublishPlanResult?.approval.status ?? existingApproval.status,
    complianceStatus: scopedComplianceStatus,
    hasDraftPayload: Boolean(firstCopyPack?.meta || firstCopyPack?.googleSearch),
  });
  const metaReadiness = metaPublishPlan
    ? validateMetaPublishPlanReadiness(metaPublishPlan, {
        approvalStatus: metaPublishPlanResult?.approval.status ?? "draft",
        providerConnectionStatus: metaConnectionStatus,
        complianceStatus: scopedComplianceStatus,
      })
    : { ready: false, blockers: firstCopyPack?.meta ? ["Meta account is not connected."] : [] };
  const adapterBlockers = metaPublishPlan?.adapter && metaPublishPlan.adapter !== "marketing_api"
    ? [`${metaPublishPlan.adapter} is read-only for diagnostics and cannot publish yet.`]
    : [];
  const blockers = uniqueStrings([...metaReadiness.blockers, ...adapterBlockers]);
  const publishReady = blockers.length === 0;
  let queueJobId: string | null = null;
  const activePublishJob = metaPublishPlan && (
    metaPublishPlan.status === "approved" || metaPublishPlan.status === "publishing"
  )
    ? await hasActiveMetaPublishPlanExecution({
        serviceSupabase,
        workspaceId: metaPublishPlan.workspaceId,
        planId: metaPublishPlan.planId,
      })
    : false;

  if (
    publishReady &&
    !body.dryRun &&
    writesEnabled &&
    metaPublishPlan?.adapter === "marketing_api" &&
    metaPublishPlan.status !== "paused_live" &&
    (!metaPublishPlanResult?.reusedActivePlan || !activePublishJob)
  ) {
    const queuedPlan: MetaPublishPlan = metaPublishPlan.status === "publishing"
      ? metaPublishPlan
      : {
          ...metaPublishPlan,
          status: "approved",
          lastError: null,
          updatedAt: new Date().toISOString(),
        };
    if (queuedPlan.status === "approved") {
      await persistMetaPublishPlan(serviceSupabase, queuedPlan, access.access.userId);
    }

    try {
      const run = await queueMetaPublishPlanExecution(queuedPlan);
      queueJobId = run.id ?? null;
      metaPublishPlan = queuedPlan;
    } catch (error) {
      // A never-started plan is safe to fail and rebuild. A publishing plan may
      // already own provider objects, so keep it reconcilable instead of
      // claiming that no provider mutation occurred.
      const queueFailedPlan: MetaPublishPlan = {
        ...queuedPlan,
        status: queuedPlan.status === "publishing" ? "publishing" : "failed",
        lastError: error instanceof Error ? error.message : "Publish could not be queued.",
        updatedAt: new Date().toISOString(),
      };
      await persistMetaPublishPlan(serviceSupabase, queueFailedPlan, access.access.userId);

      return NextResponse.json(
        { error: "Your ad could not be submitted to Meta. Try again in a moment." },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({
    exportPackageId: id,
    publishReady,
    blockers,
    providerWritesEnabled: writesEnabled,
    activePublishJob,
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
    queueJobId,
  });
}

function normalizeLibrarySelections(
  value: PublishBody["librarySelections"],
): AdStudioCreativeLibrarySelection[] | NextResponse {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return NextResponse.json({ error: "Selected ads are invalid." }, { status: 400 });
  }

  const normalized = value.flatMap((selection) => {
    const campaignId = selection?.campaignId?.trim();
    const variantId = selection?.variantId?.trim();
    return campaignId && variantId ? [{ campaignId, variantId }] : [];
  });
  if (normalized.length !== value.length) {
    return NextResponse.json({ error: "Selected ads are invalid." }, { status: 400 });
  }
  if (normalized.length > 6) {
    return NextResponse.json({ error: "Select up to six ads for one campaign." }, { status: 422 });
  }

  const unique = new Set(normalized.map((selection) => `${selection.campaignId}:${selection.variantId}`));
  if (unique.size !== normalized.length) {
    return NextResponse.json({ error: "Choose each saved ad only once." }, { status: 422 });
  }

  return normalized;
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
  existingMetaCampaignBudgetMode?: "campaign" | "adset";
}): Promise<MetaPlanPersistenceResult> {
  const setup = mergeConnectionSetup(
    resolveMetaConnectionSetup(input.connection.metadata, input.connection.externalAccountId),
    input.setupPatch,
  );
  let approval = input.approval;

  // The review step was removed from the UI, so submissions are approved
  // immediately. This also unblocks approvals created before the removal that
  // are still sitting in "requested" with no UI left to resolve them.
  if (input.requestApproval && approval.id && approval.status !== "approved") {
    const approvalId = approval.id;
    const { error } = await input.serviceSupabase
      .from("approval_requests")
      .update({ status: "approved", approved_by: input.userId, resolved_at: new Date().toISOString() })
      .eq("id", approvalId)
      .eq("workspace_id", input.workspaceId);

    if (error) {
      throw new Error(error.message);
    }
    approval = { id: approvalId, status: "approved" };
    await recordAutoApprovalAudit(input, approvalId);
  }

  if (input.requestApproval && !approval.id) {
    const createdApproval = await createMetaPublishApproval(input.serviceSupabase, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      campaignName: input.campaignPack.campaign.name,
      adapter: input.adapter,
    });
    approval = createdApproval;
    if (createdApproval.id) {
      await recordAutoApprovalAudit(input, createdApproval.id);
    }
  }

  const plan = buildMetaPublishPlan({
    workspaceId: input.workspaceId,
    campaignPack: input.campaignPack,
    connectionId: input.connection.id,
    setup,
    controls: input.controls,
    adapter: input.adapter,
    approvalRequestId: approval.id,
    variantIds: input.variantIds,
    existingMetaCampaignId: input.existingMetaCampaignId,
    existingMetaCampaignBudgetMode: input.existingMetaCampaignBudgetMode,
  });

  if (approval.id) {
    const { error } = await input.serviceSupabase
      .from("approval_requests")
      .update({ target_id: plan.planId })
      .eq("id", approval.id)
      .eq("workspace_id", input.workspaceId);

    if (error) {
      throw new Error(error.message);
    }
  }

  // Plans persist as "draft" here; the POST handler flips them to "approved"
  // only when the plan is actually ready and a worker run is being queued.
  let persistedPlan: MetaPublishPlan = {
    ...plan,
    approvalRequestId: approval.id,
    status: "draft",
    updatedAt: new Date().toISOString(),
  };
  const existingPlan = await loadMetaPublishPlanByIdempotencyKey(input.serviceSupabase, {
    workspaceId: input.workspaceId,
    idempotencyKey: persistedPlan.idempotencyKey,
  });

  // Reuse completed/provider-ambiguous plans, and reuse an approved plan only
  // while its queue row is genuinely active. This prevents a second click from
  // overwriting an in-flight plan to draft, while still repairing an approved
  // plan whose enqueue failed or whose queue row became terminal.
  const existingApprovedJobActive = existingPlan?.status === "approved"
    ? await hasActiveMetaPublishPlanExecution({
        serviceSupabase: input.serviceSupabase,
        workspaceId: input.workspaceId,
        planId: existingPlan.planId,
      })
    : false;
  if (
    existingPlan &&
    (
      existingPlan.status === "publishing" ||
      existingPlan.status === "paused_live" ||
      existingApprovedJobActive
    )
  ) {
    return { plan: existingPlan, approval, reusedActivePlan: true };
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

  return { plan: persistedPlan, approval, reusedActivePlan: false };
}

async function recordAutoApprovalAudit(
  input: { serviceSupabase: ReturnType<typeof createSupabaseServiceClient>; workspaceId: string; userId: string; campaignPack: AdStudioCampaignPack; adapter: MetaExecutionAdapter },
  approvalRequestId: string,
) {
  await input.serviceSupabase.from("audit_logs").insert({
    workspace_id: input.workspaceId,
    actor_profile_id: input.userId,
    action: "meta_publish_approval_auto_approved",
    target_type: "approval_request",
    target_id: approvalRequestId,
    metadata: {
      campaignName: input.campaignPack.campaign.name,
      adapter: input.adapter,
    },
  });
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
    campaignName: string;
    adapter: MetaExecutionAdapter;
  },
): Promise<ApprovalRecord> {
  const { data, error } = await serviceSupabase
    .from("approval_requests")
    .insert({
      workspace_id: input.workspaceId,
      target_type: "meta_publish_plan",
      // Placeholder until the plan id exists (it depends on the approval id);
      // the caller updates target_id to the real plan id straight after.
      target_id: randomUUID(),
      status: "approved",
      requested_by: input.userId,
      approved_by: input.userId,
      resolved_at: new Date().toISOString(),
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

function normalizeApprovalStatus(value: unknown): ApprovalStatus {
  return value === "approved" || value === "rejected" || value === "cancelled" || value === "requested"
    ? value
    : "draft";
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
