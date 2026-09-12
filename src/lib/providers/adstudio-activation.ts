
import {
  assertActivationReadiness,
  markPlanObjectsActive,
  PublishError,
} from "../adstudio/publish-adapter.ts";
import {
  claimMetaPublishExecution,
  ensureMetaActivationMutation,
  loadMetaPublishPlan,
  releaseMetaPublishExecutionLease,
  renewMetaPublishExecutionLease,
  updateMetaPublishPlanExecution,
} from "../providers/meta-execution.ts";
import { executeMetaMutationById } from "../providers/meta-mutation-worker.ts";
import { buildOwnedMetaActivationPayload } from "../providers/meta-mutations.ts";
import { metaPublishProviderWritesEnabled } from "../providers/meta-provider-write-gate.ts";
import { createMetaExecutionLeaseHeartbeat, type MetaExecutionLeaseHeartbeat } from "../providers/meta-execution-lease-heartbeat.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";


/** Execute a customer approval, including a persisted single-publish approval. */
export async function activateApprovedAdStudioPlan(input: {
  adId: string; workspaceId: string; requestedBy: string; planId: string;
  controlsFingerprint: string; clientMutationKey: string;
  serviceSupabase?: ReturnType<typeof createSupabaseServiceClient>;
  fetchImpl?: typeof fetch; compensationFetchImpl?: typeof fetch;
}) {
  const { adId: id, workspaceId, requestedBy, planId, controlsFingerprint, clientMutationKey } = input;
  const serviceSupabase = input.serviceSupabase ?? createSupabaseServiceClient();
  let leaseToken: string | null = null;
  let leasePlanId: string | null = null;
  let leaseHeartbeat: MetaExecutionLeaseHeartbeat | null = null;
  try {
    const plan = await loadMetaPublishPlan(serviceSupabase, {
      workspaceId: workspaceId,
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
      .select("id,status,payload_json,request_log_json,response_log_json,last_error,outcome_status,unconfirmed_pause_ids_json,client_mutation_key")
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
      return Response.json({
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
      return Response.json({
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
    const existingResult = await serviceSupabase
      .from("meta_publish_plan_mutations")
      .select("id,status,approval_request_id,payload_json,request_log_json,response_log_json,last_error,outcome_status,unconfirmed_pause_ids_json")
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
      return Response.json({
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
      return Response.json(
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
      return Response.json({
        ok: true,
        mode: "activate",
        status: "activating",
        planId: plan.planId,
        mutationId: latest?.id ?? existing?.id,
        message: "Activation is already in progress; refresh shortly.",
      }, { status: 202 });
    }
    const claimedLeaseToken = lease.leaseToken;
    leaseToken = claimedLeaseToken;
    leasePlanId = plan.planId;

    // An applying mutation is genuinely in progress only while another
    // executor still owns the plan lease. Reaching this branch means that
    // lease expired (or was released), so a provider request may have escaped
    // without a durable final outcome. Quarantine it atomically with its audit
    // record instead of spinning forever or replaying ACTIVE writes.
    const staleApplying = latest?.status === "applying"
      ? latest
      : existing?.status === "applying"
        ? existing
        : null;
    if (staleApplying) {
      const stalePayload = staleApplying.payload_json as { campaignId?: string; adSetIds?: string[]; adIds?: string[] } | undefined;
      const unconfirmedPauseIds = Array.from(new Set([
        stalePayload?.campaignId,
        ...(stalePayload?.adSetIds ?? []),
        ...(stalePayload?.adIds ?? []),
      ].filter((value): value is string => typeof value === "string" && value.length > 0)));
      const quarantineMessage = "A previous activation lost its execution lease while Meta may have been applying changes. Its final state is unconfirmed; verify these objects in Meta Ads Manager before any further activation.";
      const quarantineResult = await serviceSupabase.rpc("finalize_meta_publish_plan_mutation", {
        p_workspace_id: plan.workspaceId,
        p_mutation_id: staleApplying.id,
        p_status: "failed",
        p_request_log: staleApplying.request_log_json ?? [],
        p_response_log: staleApplying.response_log_json ?? [],
        p_last_error: quarantineMessage,
        p_outcome_status: "unconfirmed",
        p_unconfirmed_pause_ids: unconfirmedPauseIds,
      });
      if (quarantineResult.error) throw new Error(quarantineResult.error.message);
      if (quarantineResult.data !== true) {
        // The previous executor may have committed its terminal outcome while
        // this request was acquiring the expired lease. Final outcomes are
        // monotonic in the RPC, so read and report that canonical result.
        const canonicalResult = await serviceSupabase
          .from("meta_publish_plan_mutations")
          .select("id,status,payload_json,last_error,outcome_status,unconfirmed_pause_ids_json")
          .eq("workspace_id", plan.workspaceId)
          .eq("id", staleApplying.id)
          .single();
        if (canonicalResult.error || !canonicalResult.data) {
          throw new Error(canonicalResult.error?.message ?? "Stale activation final state could not be loaded.");
        }
        const canonical = canonicalResult.data;
        const canonicalPayload = canonical.payload_json as { campaignId?: string; adSetIds?: string[]; adIds?: string[] } | undefined;
        const canonicalTargets = {
          campaignId: canonicalPayload?.campaignId ?? plan.reconciledObjects.campaignId,
          adSetIds: canonicalPayload?.adSetIds ?? [],
          adIds: canonicalPayload?.adIds ?? [],
        };
        if (canonical.status === "applied") {
          await updateMetaPublishPlanExecution(serviceSupabase, markPlanObjectsActive(plan));
          return Response.json({
            ok: true,
            mode: "activate",
            status: "activated",
            planId: plan.planId,
            mutationId: canonical.id,
            targets: canonicalTargets,
            message: "The prior activation completed while its stale lease was being reconciled; no second activation was created.",
          });
        }
        if (canonical.status === "failed") {
          const unconfirmed = canonical.outcome_status === "unconfirmed";
          return Response.json({
            ok: false,
            mode: "activate",
            status: unconfirmed ? "unknown" : "paused",
            planId: plan.planId,
            mutationId: canonical.id,
            targets: canonicalTargets,
            error: unconfirmed ? "activation_unconfirmed" : "activation_failed",
            message: canonical.last_error ?? (unconfirmed
              ? "Activation failed and Blockwise could not confirm the final Meta status."
              : "Activation failed; the Blockwise-created objects remain paused."),
            ...(unconfirmed ? { unconfirmedPauseIds: canonical.unconfirmed_pause_ids_json ?? [] } : {}),
          }, { status: 502 });
        }
        throw new Error("Stale activation could not be quarantined atomically.");
      }
      return Response.json({
        ok: false,
        mode: "activate",
        status: "unknown",
        planId: plan.planId,
        mutationId: staleApplying.id,
        targets: {
          campaignId: stalePayload?.campaignId ?? plan.reconciledObjects.campaignId,
          adSetIds: stalePayload?.adSetIds ?? [],
          adIds: stalePayload?.adIds ?? [],
        },
        error: "activation_unconfirmed",
        message: quarantineMessage,
        unconfirmedPauseIds,
      }, { status: 502 });
    }

    leaseHeartbeat = createMetaExecutionLeaseHeartbeat({
      fetchImpl: input.fetchImpl,
      renew: () => renewMetaPublishExecutionLease(serviceSupabase, {
        workspaceId: plan.workspaceId,
        planId: plan.planId,
        leaseToken: claimedLeaseToken,
      }),
    });

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
      return Response.json({
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
      requestedBy: requestedBy,
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
      compensationFetchImpl: input.compensationFetchImpl ?? fetch,
      onCheckpoint: leaseHeartbeat.renewNow,
    });
    leaseHeartbeat.assertOwned();
    if (executed.status !== "applied") {
      const unconfirmedPauseIds = executed.unconfirmedPauseIds ?? [];
      if (unconfirmedPauseIds.length > 0) {
        return Response.json({
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
      return Response.json({
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

    return Response.json({
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
      return Response.json({
        ok: false,
        mode: "activate",
        status: err.code === "activation_unconfirmed" ? "unknown" : undefined,
        planId,
        error: err.code,
        message: err.message,
      }, { status });
    }
    return Response.json({ error: "activation_failed", message: "Publishing activation could not be confirmed. Refresh its saved status." }, { status: 500 });
  } finally {
    leaseHeartbeat?.stop();
    if (leaseToken && leasePlanId) {
      try {
        await releaseMetaPublishExecutionLease(serviceSupabase, {
          workspaceId: workspaceId,
          planId: leasePlanId,
          leaseToken,
        });
      } catch {
        // Preserve the activation outcome; the lease expires safely.
      }
    }
  }
}
