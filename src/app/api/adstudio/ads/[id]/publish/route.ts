import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  PublishError,
  activatePausedMetaPublish,
  backfillPublishMetaCopy,
  buildPausedMetaPublishPlan,
  freezePublicationSnapshot,
  loadPublishState,
  resolvePublishCreativeAssets,
  validatePublishState,
} from "@/lib/adstudio/publish-adapter";
import { resolveMetaPageAccessToken } from "@/lib/providers/meta-assets";
import {
  applyMetaPublishExecutionResult,
  createMetaExecutionAdapter,
  persistMetaPublishPlan,
  resolveMetaConnectionSetup,
  updateMetaPublishPlanExecution,
  validateMetaConnectionSetup,
  type MetaPublishControls,
} from "@/lib/providers/meta-execution";
import { loadStoredProviderTokens } from "@/lib/providers/provider-connections";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type PublishBody = {
  controls?: unknown;
};

function providerWritesEnabled() {
  return process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
}

/**
 * POST /api/adstudio/ads/[id]/publish?workspaceId=...
 *
 * Complete Publish lifecycle (BW-M + BW-Q): freezes the LAST SAVED revision
 * into a publication snapshot, creates the Meta objects through the existing
 * Meta pipeline (marketing_api adapter), then ACTIVATES them — the response
 * reports "active" only after Meta confirms the campaign/ad sets/ads are
 * ACTIVE. If activation fails after the objects were created, the receipt
 * reports the REAL state (created, still paused on Meta) plus the planId so
 * the UI can offer a safe retry — it never claims the ad is live when it
 * remains paused.
 *
 * When BLOCKWISE_ENABLE_PROVIDER_WRITES is not "true" the API returns a clear
 * dry-run receipt: snapshot frozen + plan drafted, NO Meta writes, and no
 * fake success.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<PublishBody>(request);
  const controls = isMetaPublishControls(body.controls) ? body.controls : {};

  try {
    // 1. Promote the frozen revision's Meta copy onto the ad row (the editor
    // stores copy in document_json; loadPublishState reads the ad columns).
    await backfillPublishMetaCopy(access.supabase, id, access.access.workspaceId);

    // 2. Load the workspace's Meta connection and resolved setup early — the
    const serviceSupabase = createSupabaseServiceClient();
    const connection = await loadMetaConnection(serviceSupabase, access.access.workspaceId);
    if (!connection) {
      return NextResponse.json({ error: "meta_not_connected", message: "Connect Meta before publishing." }, { status: 400 });
    }

    const setup = resolveMetaConnectionSetup(connection.metadata_json ?? {}, connection.external_account_id);
    const setupBlockers = validateMetaConnectionSetup(setup);
    if (setupBlockers.length > 0) {
      return NextResponse.json({ error: "setup_incomplete", blockers: setupBlockers }, { status: 400 });
    }

    // 3. Freeze the LAST SAVED revision — rejects when the ad has unsaved
    // changes (no active revision). This is the authoritative server state.
    const loaded = await loadPublishState(access.supabase, id, access.access.workspaceId);

    const state = loaded;

    // 4. Validate the frozen state.
    const issues = validatePublishState(state, { controls, setup });
    if (issues.length > 0) {
      return NextResponse.json({ error: "not_ready", issues }, { status: 400 });
    }

    // 5. Freeze the publication snapshot (idempotent per revision).
    const { snapshotId } = await freezePublicationSnapshot(
      access.supabase,
      {
        adId: id,
        workspaceId: access.access.workspaceId,
        connectionId: connection.id,
        setup,
        controls,
      },
      state,
    );

    // 6. Build the ALL-PAUSED Meta plan from the frozen state.
    const plan = buildPausedMetaPublishPlan({
      adId: id,
      workspaceId: access.access.workspaceId,
      connectionId: connection.id,
      setup,
      controls,
      state,
    });

    // 7. Provider writes disabled → clear dry-run / paused-disabled receipt.
    // Snapshot is frozen and the plan is drafted, but nothing is written to
    // Meta and nothing is reported as created.
    if (!providerWritesEnabled()) {
      await persistMetaPublishPlan(serviceSupabase, { ...plan, status: "draft" }, access.access.userId);

      return NextResponse.json({
        ok: true,
        mode: "dry_run",
        providerWritesEnabled: false,
        snapshotId,
        planId: plan.planId,
        status: "paused_disabled",
        plannedObjects: {
          campaigns: 1,
          adSets: plan.adSets.length,
          leadForms: plan.leadForms.length,
          creatives: plan.creatives.length,
          ads: plan.ads.length,
        },
        message:
          "Provider writes are disabled (BLOCKWISE_ENABLE_PROVIDER_WRITES=false). " +
          "The saved revision is frozen and the PAUSED Meta plan is drafted, but NO Meta objects were created.",
      });
    }

    // 8. Provider writes enabled → execute the paused create via the existing
    // marketing_api adapter, reading back the created object IDs.
    const publishingPlan = { ...plan, status: "publishing" as const };
    await persistMetaPublishPlan(serviceSupabase, publishingPlan, access.access.userId);

    const tokens = await loadStoredProviderTokens(serviceSupabase, connection.id);
    if (!tokens.accessToken) {
      return NextResponse.json({ error: "meta_token_missing", message: "The Meta access token is missing — reconnect Meta." }, { status: 502 });
    }

    const pageAccessToken = await resolveMetaPageAccessToken({
      accessToken: tokens.accessToken,
      pageId: setup.pageId,
    });

    const executionPlan = await resolvePublishCreativeAssets(serviceSupabase, publishingPlan);
    const result = await createMetaExecutionAdapter(executionPlan.adapter).publish(executionPlan, {
      accessToken: tokens.accessToken,
      pageAccessToken,
      onCheckpoint: async (checkpoint) => {
        await updateMetaPublishPlanExecution(
          serviceSupabase,
          applyMetaPublishExecutionResult(publishingPlan, checkpoint),
        );
      },
    });

    const completed = applyMetaPublishExecutionResult(publishingPlan, result);
    await updateMetaPublishPlanExecution(serviceSupabase, completed);

    if (result.status !== "paused_live") {
      return NextResponse.json(
        { error: "publish_failed", message: result.lastError ?? "Meta object creation failed." },
        { status: 502 },
      );
    }

    // 9. Activate — the customer's Publish click IS the explicit approval.
    // Success is only reported when Meta confirms the objects are ACTIVE.
    // Failure is reported honestly: objects were created and remain paused,
    // with the planId for a safe retry.
    try {
      const activation = await activatePausedMetaPublish(serviceSupabase, {
        adId: id,
        workspaceId: access.access.workspaceId,
        planId: completed.planId,
        requestedBy: access.access.userId,
        providerWritesEnabled: true,
      });

      return NextResponse.json({
        ok: true,
        mode: "publish",
        providerWritesEnabled: true,
        snapshotId,
        planId: completed.planId,
        status: "active",
        reconciledObjects: completed.reconciledObjects,
        activationTargets: activation.targets,
        message:
          "Published — Meta confirms your campaign, ad sets and ads are configured ACTIVE. " +
          "Individual ads may briefly show as in review (effective status IN_PROCESS or PENDING_REVIEW) " +
          "before they start delivering; that is Meta's normal approval flow, not a paused campaign.",
      });
    } catch (activationErr) {
      // Indeterminate state: activation failed AND the safety pause could not
      // be confirmed for every object — some objects may still be ACTIVE and
      // spending. Never report "paused" for an unverified state.
      const unconfirmed = activationErr instanceof PublishError && activationErr.code === "activation_unconfirmed";
      const detail = activationErr instanceof PublishError
        ? activationErr.message
        : activationErr instanceof Error
          ? activationErr.message
          : "Activation failed.";
      return NextResponse.json({
        ok: true,
        mode: "publish",
        providerWritesEnabled: true,
        snapshotId,
        planId: completed.planId,
        // The REAL state: with a confirmed safety pause the objects exist and
        // remain paused; unconfirmed means the state could not be verified.
        status: unconfirmed ? "unknown" : "paused",
        reconciledObjects: completed.reconciledObjects,
        activationError: detail,
        message: unconfirmed
          ? "Your ad was created on Meta, but activation failed and Blockwise could not confirm that every object was paused. " +
            "Some campaign objects may be ACTIVE — check Meta Ads Manager now. Retrying publish is still safe; it targets the exact objects already created."
          : "Your ad was created on Meta, but activation did not complete — nothing is running yet. " +
            "You can safely retry publishing; it targets the exact objects already created.",
      });
    }
  } catch (err) {
    if (err instanceof PublishError) {
      const status = err.code === "ad_not_found" || err.code === "revision_not_found" || err.code === "template_not_found"
        ? 404
        : err.code === "not_saved"
          ? 400
          : 500;
      return NextResponse.json({ error: err.code, message: err.message }, { status });
    }
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MetaConnectionRow = {
  id: string;
  external_account_id: string | null;
  external_account_name: string | null;
  metadata_json: Record<string, unknown> | null;
  token_expires_at: string | null;
};

async function loadMetaConnection(
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>,
  workspaceId: string,
): Promise<MetaConnectionRow | null> {
  const { data, error } = await serviceSupabase
    .from("provider_connections")
    .select("id,external_account_id,external_account_name,metadata_json,token_expires_at")
    .eq("workspace_id", workspaceId)
    .eq("provider", "meta")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as MetaConnectionRow | null) ?? null;
}

function isMetaPublishControls(value: unknown): value is MetaPublishControls {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return true;
}
