import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  assertActivationReadiness,
  loadLatestPublishPlanForAd,
  markPlanObjectsActive,
  PublishError,
} from "@/lib/adstudio/publish-adapter";
import {
  loadMetaPublishPlan,
  updateMetaPublishPlanExecution,
} from "@/lib/providers/meta-execution";
import { executeMetaMutationById } from "@/lib/providers/meta-mutation-worker";
import { buildMetaPlanMutation, buildOwnedMetaActivationPayload } from "@/lib/providers/meta-mutations";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type ActivateBody = {
  /** Optional explicit plan from the PAUSED publish receipt; defaults to the latest plan for the ad. */
  planId?: string;
};

function providerWritesEnabled() {
  return process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
}

/**
 * POST /api/adstudio/ads/[id]/activate?workspaceId=...
 *
 * BW-Q — the SEPARATE Activate action for a PAUSED Meta publish. Publish
 * creates campaign / ad set / creative / ad objects PAUSED; this route flips
 * them to ACTIVE only on an explicit customer click. It NEVER auto-lives and
 * NEVER reports the ad was already live.
 *
 * When BLOCKWISE_ENABLE_PROVIDER_WRITES is not "true" the route returns a
 * clear dry-run receipt: the campaign stays PAUSED on Meta and nothing is
 * written.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<ActivateBody>(request);
  const planId = typeof body.planId === "string" && body.planId.trim() ? body.planId.trim() : undefined;

  try {
    const serviceSupabase = createSupabaseServiceClient();
    const plan = planId
      ? await loadMetaPublishPlan(serviceSupabase, {
          workspaceId: access.access.workspaceId,
          planId,
        })
      : await loadLatestPublishPlanForAd(serviceSupabase, access.access.workspaceId, id);
    if (!plan) {
      throw new PublishError("no_paused_plan", "No paused Meta publish plan found for this ad — publish it first.");
    }
    if (plan.customerAdId !== id) {
      throw new PublishError("plan_ad_mismatch", "That Meta publish plan belongs to a different ad.");
    }

    const readiness = assertActivationReadiness(plan);
    if (!readiness.ok) throw new PublishError(readiness.code, readiness.message);
    let mutationPayload;
    try {
      mutationPayload = buildOwnedMetaActivationPayload(plan);
    } catch (error) {
      throw new PublishError(
        "activation_ownership_unverified",
        error instanceof Error ? error.message : "Meta activation ownership could not be verified.",
      );
    }
    const targets = {
      campaignId: plan.reconciledObjects.campaignId!,
      adSetIds: mutationPayload.adSetIds ?? [],
      adIds: mutationPayload.adIds ?? [],
    };

    if (!providerWritesEnabled()) {
      return NextResponse.json({
        ok: true,
        mode: "dry_run",
        status: "paused",
        planId: plan.planId,
        targets,
        message: "Activation was NOT applied — provider writes are disabled. Every Meta object remains unchanged.",
      });
    }

    const mutation = buildMetaPlanMutation({
      workspaceId: plan.workspaceId,
      planId: plan.planId,
      requestedBy: access.access.userId,
      action: "activate",
      payload: mutationPayload,
    });
    const now = new Date().toISOString();
    const { error: mutationError } = await serviceSupabase
      .from("meta_publish_plan_mutations")
      .insert({
        id: mutation.mutationId,
        workspace_id: mutation.workspaceId,
        meta_publish_plan_id: mutation.planId,
        action: mutation.action,
        status: "approved",
        payload_json: mutation.payload,
        requested_by: mutation.requestedBy,
        request_log_json: mutation.requestLog,
        response_log_json: mutation.responseLog,
        last_error: null,
        updated_at: now,
      });
    if (mutationError) throw new Error(mutationError.message);

    const { data: approval, error: approvalError } = await serviceSupabase
      .from("approval_requests")
      .insert({
        workspace_id: mutation.workspaceId,
        target_type: mutation.approval.targetType,
        target_id: mutation.approval.targetId,
        status: "approved",
        requested_by: mutation.requestedBy,
        approved_by: mutation.requestedBy,
        resolved_at: now,
        risk_summary: mutation.approval.riskSummary,
      })
      .select("id")
      .single();
    if (approvalError || !approval) {
      throw new Error(approvalError?.message ?? "Unable to record the activation approval.");
    }
    const { error: linkError } = await serviceSupabase
      .from("meta_publish_plan_mutations")
      .update({ approval_request_id: approval.id, updated_at: now })
      .eq("workspace_id", mutation.workspaceId)
      .eq("id", mutation.mutationId);
    if (linkError) throw new Error(linkError.message);

    const executed = await executeMetaMutationById({
      serviceSupabase,
      workspaceId: plan.workspaceId,
      mutationId: mutation.mutationId,
    });
    if (executed.status !== "applied") {
      throw new PublishError(
        "activation_failed",
        executed.lastError ?? "Meta could not activate the Blockwise-created ads; reused parents were not changed.",
      );
    }
    await updateMetaPublishPlanExecution(serviceSupabase, markPlanObjectsActive(plan));

    return NextResponse.json({
      ok: true,
      mode: "activate",
      status: "activated",
      planId: plan.planId,
      mutationId: mutation.mutationId,
      targets,
      message: "Activated only the Meta objects created by this publish plan. Reused campaigns and ad sets were verified active and left unchanged.",
    });
  } catch (err) {
    if (err instanceof PublishError) {
      const status =
        err.code === "no_paused_plan"
          ? 404
          : err.code === "activation_failed"
            ? 502
            : 400;
      return NextResponse.json({ error: err.code, message: err.message }, { status });
    }
    return errorResponse(err, 500);
  }
}
