import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  assertActivationReadiness,
  markPlanObjectsActive,
  PublishError,
} from "@/lib/adstudio/publish-adapter";
import {
  claimMetaPublishExecution,
  ensureMetaActivationMutation,
  loadMetaPublishPlan,
  releaseMetaPublishExecutionLease,
  renewMetaPublishExecutionLease,
  updateMetaPublishPlanExecution,
} from "@/lib/providers/meta-execution";
import { executeMetaMutationById } from "@/lib/providers/meta-mutation-worker";
import { buildOwnedMetaActivationPayload } from "@/lib/providers/meta-mutations";
import { metaPublishProviderWritesEnabled } from "@/lib/providers/meta-provider-write-gate";
import { createMetaExecutionLeaseHeartbeat, type MetaExecutionLeaseHeartbeat } from "@/lib/providers/meta-execution-lease-heartbeat";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type ActivateBody = {
  /** Exact plan from the PAUSED publish receipt. */
  planId?: string;
  controlsFingerprint?: string;
  clientMutationKey?: string;
};

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
  const controlsFingerprint = typeof body.controlsFingerprint === "string" ? body.controlsFingerprint.trim() : "";
  const clientMutationKey = typeof body.clientMutationKey === "string" ? body.clientMutationKey.trim() : "";

  if (!planId) {
    return NextResponse.json(
      { error: "plan_id_required", message: "Activate requires the exact planId returned by publish." },
      { status: 400 },
    );
  }
  if (!controlsFingerprint) return NextResponse.json({ error: "controls_fingerprint_required", message: "Activate requires controlsFingerprint from publish." }, { status: 400 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientMutationKey)) return NextResponse.json({ error: "client_mutation_key_invalid", message: "Activate requires a UUID clientMutationKey." }, { status: 400 });

  const serviceSupabase = createSupabaseServiceClient();
  let leaseToken: string | null = null;
  let leasePlanId: string | null = null;
  let leaseHeartbeat: MetaExecutionLeaseHeartbeat | null = null;
  try {
    const plan = await loadMetaPublishPlan(serviceSupabase, {
      workspaceId: access.access.workspaceId,
      planId,
    });
    if (!plan) {
      throw new PublishError("no_paused_plan", "No paused Meta publish plan found for this ad — publish it first.");
    }
    if (plan.adStudioCampaignId !== id) {
      throw new PublishError("plan_ad_mismatch", "That Meta publish plan belongs to a different ad.");
    }
    if (controlsFingerprint !== plan.idempotencyKey) throw new PublishError("controls_fingerprint_mismatch", "The publish controls have changed; publish again before activating.");

    const latestResult = await serviceSupabase
      .from("meta_publish_plan_mutations")
      .select("id,status,payload_json,last_error,outcome_status,unconfirmed_pause_ids_json,client_mutation_key")
      .eq("workspace_id", plan.workspaceId)
      .eq("meta_publish_plan_id", plan.planId)
      .eq("action", "activate")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestResult.error) throw new Error(latestResult.error.message);
    const latest = latestResult.data;
    const latestPayload = latest?.payload_json as { campaignId?: string; adSetIds?: string[]; adIds?: string[] } | undefined;
    const latestTargets = {
      campaignId: latestPayload?.campaignId ?? plan.reconciledObjects.campaignId,
      adSetIds: latestPayload?.adSetIds ?? [],
      adIds: latestPayload?.adIds ?? [],
    };
    if (latest?.status === "applied") {
      return NextResponse.json({
        ok: true,
        mode: "activate",
        status: "activated",
        planId: plan.planId,
        mutationId: latest.id,
        targets: latestTargets,
        message: "This publish plan is already active; no second activation was created.",
      });
    }
    if (latest?.outcome_status === "unconfirmed") {
      return NextResponse.json({
        ok: false,
        mode: "activate",
        status: "unknown",
        planId: plan.planId,
        mutationId: latest.id,
        targets: latestTargets,
        error: "activation_unconfirmed",
        message: latest.last_error ?? "Blockwise could not confirm that every owned object was paused.",
        unconfirmedPauseIds: latest.unconfirmed_pause_ids_json ?? [],
      }, { status: 502 });
    }
    if (latest?.status === "applying") {
      return NextResponse.json({
        ok: true,
        mode: "activate",
        status: "activating",
        planId: plan.planId,
        mutationId: latest.id,
        targets: latestTargets,
        message: "A prior activation request is still in progress; no second activation was created.",
      }, { status: 202 });
    }

    const existingResult = await serviceSupabase
      .from("meta_publish_plan_mutations")
      .select("id,status,approval_request_id,payload_json,last_error,outcome_status,unconfirmed_pause_ids_json")
      .eq("workspace_id", plan.workspaceId)
      .eq("meta_publish_plan_id", plan.planId)
      .eq("action", "activate")
      .eq("client_mutation_key", clientMutationKey)
      .maybeSingle();
    if (existingResult.error) throw new Error(existingResult.error.message);
    const existing = existingResult.data;
    const existingPayload = existing?.payload_json as { campaignId?: string; adSetIds?: string[]; adIds?: string[] } | undefined;
    const existingTargets = {
      campaignId: existingPayload?.campaignId ?? plan.reconciledObjects.campaignId,
      adSetIds: existingPayload?.adSetIds ?? [],
      adIds: existingPayload?.adIds ?? [],
    };
    if (existing?.status === "applied") {
      return NextResponse.json({
        ok: true,
        mode: "activate",
        status: "activated",
        planId: plan.planId,
        mutationId: existing.id,
        targets: existingTargets,
        message: "Activation already completed for this exact request.",
      });
    }
    if (existing?.status === "failed") {
      const unconfirmed = existing.outcome_status === "unconfirmed";
      return NextResponse.json(
        {
          ok: false,
          mode: "activate",
          status: unconfirmed ? "unknown" : "paused",
          planId: plan.planId,
          mutationId: existing.id,
          targets: existingTargets,
          error: unconfirmed ? "activation_unconfirmed" : "activation_failed",
          message: existing.last_error ?? (unconfirmed
            ? "Activation failed and Blockwise could not confirm that every owned object was paused."
            : "Activation failed; the Blockwise-created objects remain paused."),
          ...(unconfirmed ? { unconfirmedPauseIds: existing.unconfirmed_pause_ids_json ?? [] } : {}),
        },
        { status: 502 },
      );
    }

    const lease = await claimMetaPublishExecution(serviceSupabase, { workspaceId: plan.workspaceId, planId: plan.planId });
    if (!lease.claimed || !lease.leaseToken) {
      return NextResponse.json({
        ok: true,
        mode: "activate",
        status: "activating",
        planId: plan.planId,
        mutationId: existing?.id,
        message: "Activation is already in progress; refresh shortly.",
      }, { status: 202 });
    }
    const claimedLeaseToken = lease.leaseToken;
    leaseToken = claimedLeaseToken;
    leasePlanId = plan.planId;
    leaseHeartbeat = createMetaExecutionLeaseHeartbeat({
      renew: () => renewMetaPublishExecutionLease(serviceSupabase, {
        workspaceId: plan.workspaceId,
        planId: plan.planId,
        leaseToken: claimedLeaseToken,
      }),
    });

    if (existing?.status === "applying") {
      throw new PublishError(
        "activation_unconfirmed",
        "A previous activation attempt stopped while Meta was applying it. Check Meta Ads Manager before trying again.",
      );
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

    if (!metaPublishProviderWritesEnabled(plan.workspaceId)) {
      return NextResponse.json({
        ok: true,
        mode: "dry_run",
        status: "paused",
        planId: plan.planId,
        targets,
        message: "Activation was NOT applied — provider writes are disabled. Every Meta object remains unchanged.",
      });
    }

    const mutation = await ensureMetaActivationMutation(serviceSupabase, {
      workspaceId: plan.workspaceId,
      planId: plan.planId,
      requestedBy: access.access.userId,
      clientMutationKey: latest?.status === "approved" && latest.client_mutation_key
        ? latest.client_mutation_key
        : clientMutationKey,
      planFingerprint: controlsFingerprint,
    });

    await leaseHeartbeat.renewNow();

    const executed = await executeMetaMutationById({
      serviceSupabase,
      workspaceId: plan.workspaceId,
      mutationId: mutation.mutationId,
      fetchImpl: leaseHeartbeat.fetch,
      compensationFetchImpl: fetch,
      onCheckpoint: leaseHeartbeat.renewNow,
    });
    leaseHeartbeat.assertOwned();
    if (executed.status !== "applied") {
      const unconfirmedPauseIds = executed.unconfirmedPauseIds ?? [];
      if (unconfirmedPauseIds.length > 0) {
        return NextResponse.json({
          ok: false,
          mode: "activate",
          status: "unknown",
          planId: plan.planId,
          mutationId: mutation.mutationId,
          targets,
          error: "activation_unconfirmed",
          message: executed.lastError ?? "Activation failed and Blockwise could not confirm the final Meta status.",
          unconfirmedPauseIds,
        }, { status: 502 });
      }
      return NextResponse.json({
        ok: false,
        mode: "activate",
        status: "paused",
        planId: plan.planId,
        mutationId: mutation.mutationId,
        targets,
        error: "activation_failed",
        message: executed.lastError ?? "Meta could not activate the Blockwise-created ads; they remain paused.",
      }, { status: 502 });
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
          : err.code === "activation_failed" || err.code === "activation_unconfirmed"
            ? 502
            : 400;
      return NextResponse.json({
        ok: false,
        mode: "activate",
        status: err.code === "activation_unconfirmed" ? "unknown" : undefined,
        planId,
        error: err.code,
        message: err.message,
      }, { status });
    }
    return errorResponse(err, 500);
  } finally {
    leaseHeartbeat?.stop();
    if (leaseToken && leasePlanId) {
      try {
        await releaseMetaPublishExecutionLease(serviceSupabase, {
          workspaceId: access.access.workspaceId,
          planId: leasePlanId,
          leaseToken,
        });
      } catch {
        // Preserve the activation outcome; the lease expires safely.
      }
    }
  }
}
