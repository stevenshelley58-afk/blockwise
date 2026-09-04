import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { summarizePersistedPublishPlan, summarizePersistedPublishSource } from "@/lib/adstudio/publish-receipt";
import {
  PublishError,
  backfillPublishMetaCopy,
  buildPausedMetaPublishPlan,
  freezePublicationSnapshot,
  loadPublishState,
  loadLatestPublishPlanForAd,
  resolvePublishCreativeAssets,
  validatePublishState,
} from "@/lib/adstudio/publish-adapter";
import { resolveMetaPageAccessToken } from "@/lib/providers/meta-assets";
import {
  applyMetaPublishExecutionResult,
  createMetaExecutionAdapter,
  claimMetaPublishExecution,
  loadMetaPublishPlan,
  persistMetaPublishPlan,
  releaseMetaPublishExecutionLease,
  renewMetaPublishExecutionLease,
  resolveMetaConnectionSetup,
  updateMetaPublishPlanExecution,
  validateMetaConnectionSetup,
  type MetaPublishControls,
} from "@/lib/providers/meta-execution";
import { loadStoredProviderTokens } from "@/lib/providers/provider-connections";
import { metaPublishProviderWritesEnabled } from "@/lib/providers/meta-provider-write-gate";
import { createMetaExecutionLeaseHeartbeat } from "@/lib/providers/meta-execution-lease-heartbeat";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type PublishBody = {
  controls?: unknown;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  try {
    const serviceSupabase = createSupabaseServiceClient();
    const plan = await loadLatestPublishPlanForAd(serviceSupabase, access.access.workspaceId, id);
    if (!plan) return NextResponse.json({ receipt: null });
    const activation = await loadLatestActivationReceiptState(
      serviceSupabase,
      access.access.workspaceId,
      plan.planId,
    );
    const dryRun = plan.status === "draft";
    const status = activation.status ?? (dryRun
      ? "paused_disabled"
      : plan.status === "paused_live"
        ? "paused"
        : plan.status === "publishing"
          ? "publishing"
          : plan.status === "failed"
            ? "failed"
            : "unknown");
    return NextResponse.json({
      ok: true,
      mode: dryRun ? "dry_run" : "publish",
      providerWritesEnabled: metaPublishProviderWritesEnabled(access.access.workspaceId),
      ...summarizePersistedPublishSource(plan),
      planId: plan.planId,
      status,
      controlsFingerprint: plan.idempotencyKey,
      lastCheckedAt: activation.lastCheckedAt ?? plan.updatedAt,
      setupSummary: summarizePersistedPublishPlan(plan),
      message: durableReceiptMessage(status, activation.lastError ?? plan.lastError),
      reconciledObjects: plan.reconciledObjects,
      plannedObjects: {
        campaigns: 1,
        adSets: plan.adSets.length,
        leadForms: plan.leadForms.length,
        creatives: plan.creatives.length,
        ads: plan.ads.length,
      },
      ...(activation.lastError ? { activationError: activation.lastError } : {}),
      ...(activation.status === "unknown" ? { unconfirmedPauseIds: activation.unconfirmedPauseIds } : {}),
    });
  } catch (err) { return errorResponse(err); }
}

/**
 * POST /api/adstudio/ads/[id]/publish?workspaceId=...
 *
 * Complete Publish lifecycle (BW-M + BW-Q): freezes the LAST SAVED revision
 * into a publication snapshot and creates the Meta objects through the
 * existing Meta pipeline (marketing_api adapter), all PAUSED. The response
 * reports the truthful paused receipt and stops; activation is a separate,
 * explicit action at /activate.
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
    const loaded = await loadPublishState(access.supabase, id, access.access.workspaceId, {
      templateSupabase: serviceSupabase,
    });

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
      publicationSnapshotId: snapshotId,
      setup,
      controls,
      state,
    });

    // 7. Provider writes disabled → clear dry-run / paused-disabled receipt.
    // Snapshot is frozen and the plan is drafted, but nothing is written to
    // Meta and nothing is reported as created.
    if (!metaPublishProviderWritesEnabled(access.access.workspaceId)) {
      const persisted = await persistMetaPublishPlan(
        serviceSupabase,
        { ...plan, status: "draft" },
        access.access.userId,
      );
      const canonical = await loadMetaPublishPlan(serviceSupabase, {
        workspaceId: access.access.workspaceId,
        planId: persisted.id,
      });

      if (canonical.status !== "draft") {
        let status = canonical.status === "paused_live"
          ? "paused"
          : canonical.status === "publishing"
            ? "publishing"
            : "failed";
        let lastCheckedAt = canonical.updatedAt;
        let activationError: string | null = null;
        let unconfirmedPauseIds: string[] = [];
        if (canonical.status === "paused_live") {
          const activation = await loadLatestActivationReceiptState(
            serviceSupabase,
            canonical.workspaceId,
            canonical.planId,
          );
          status = activation.status ?? status;
          lastCheckedAt = activation.lastCheckedAt ?? canonical.updatedAt;
          activationError = activation.lastError;
          unconfirmedPauseIds = activation.unconfirmedPauseIds;
        }
        return NextResponse.json({
          ok: canonical.status === "paused_live",
          mode: "publish",
          providerWritesEnabled: false,
          ...summarizePersistedPublishSource(canonical),
          planId: canonical.planId,
          status,
          controlsFingerprint: canonical.idempotencyKey,
          lastCheckedAt,
          setupSummary: summarizePersistedPublishPlan(canonical),
          reconciledObjects: canonical.reconciledObjects,
          message: durableReceiptMessage(status, activationError ?? canonical.lastError),
          ...(activationError ? { activationError } : {}),
          ...(status === "unknown" ? { unconfirmedPauseIds } : {}),
        });
      }

      return NextResponse.json({
        ok: true,
        mode: "dry_run",
        providerWritesEnabled: false,
        ...summarizePersistedPublishSource(canonical),
        planId: canonical.planId,
        status: "paused_disabled",
        controlsFingerprint: canonical.idempotencyKey,
        lastCheckedAt: canonical.updatedAt,
        setupSummary: summarizePersistedPublishPlan(canonical),
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
    const persisted = await persistMetaPublishPlan(serviceSupabase, publishingPlan, access.access.userId);
    const canonical = await loadMetaPublishPlan(serviceSupabase, { workspaceId: access.access.workspaceId, planId: persisted.id });
    if (canonical.status === "paused_live") {
      const activation = await loadLatestActivationReceiptState(
        serviceSupabase,
        canonical.workspaceId,
        canonical.planId,
      );
      const status = activation.status ?? "paused";
      return NextResponse.json({
        ok: true,
        mode: "publish",
        providerWritesEnabled: true,
        ...summarizePersistedPublishSource(canonical),
        planId: canonical.planId,
        status,
        controlsFingerprint: canonical.idempotencyKey,
        lastCheckedAt: activation.lastCheckedAt ?? canonical.updatedAt,
        setupSummary: summarizePersistedPublishPlan(canonical),
        reconciledObjects: canonical.reconciledObjects,
        message: durableReceiptMessage(status, activation.lastError),
        ...(activation.lastError ? { activationError: activation.lastError } : {}),
        ...(status === "unknown" ? { unconfirmedPauseIds: activation.unconfirmedPauseIds } : {}),
      });
    }
    const lease = await claimMetaPublishExecution(serviceSupabase, { workspaceId: access.access.workspaceId, planId: canonical.planId });
    if (!lease.claimed || !lease.leaseToken) {
      const latest = await loadMetaPublishPlan(serviceSupabase, { workspaceId: access.access.workspaceId, planId: canonical.planId });
      return NextResponse.json({ ok: true, mode: "publish", providerWritesEnabled: true, ...summarizePersistedPublishSource(latest), planId: latest.planId, status: latest.status === "paused_live" ? "paused" : "publishing", controlsFingerprint: latest.idempotencyKey, lastCheckedAt: latest.updatedAt, setupSummary: summarizePersistedPublishPlan(latest), reconciledObjects: latest.reconciledObjects, message: "Publishing is already in progress; refresh shortly for the paused receipt." }, { status: 202 });
    }
    const claimedLeaseToken = lease.leaseToken;
    const leaseHeartbeat = createMetaExecutionLeaseHeartbeat({
      renew: () => renewMetaPublishExecutionLease(serviceSupabase, {
        workspaceId: access.access.workspaceId,
        planId: canonical.planId,
        leaseToken: claimedLeaseToken,
      }),
    });
    try {
      await leaseHeartbeat.renewNow();
      await updateMetaPublishPlanExecution(serviceSupabase, {
        ...canonical,
        status: "publishing",
        updatedAt: new Date().toISOString(),
      });

      const tokens = await loadStoredProviderTokens(serviceSupabase, connection.id);
      if (!tokens.accessToken) {
        throw new Error("The Meta access token is missing — reconnect Meta.");
      }

      const pageAccessToken = await resolveMetaPageAccessToken({
        accessToken: tokens.accessToken,
        pageId: setup.pageId,
        fetchImpl: leaseHeartbeat.fetch,
      });

      const executionPlan = await resolvePublishCreativeAssets(serviceSupabase, {
        ...canonical,
        status: "publishing",
      });
      const result = await createMetaExecutionAdapter(executionPlan.adapter).publish(executionPlan, {
        accessToken: tokens.accessToken,
        pageAccessToken,
        fetchImpl: leaseHeartbeat.fetch,
        onCheckpoint: async (checkpoint) => {
          await leaseHeartbeat.renewNow();
          await updateMetaPublishPlanExecution(
            serviceSupabase,
            applyMetaPublishExecutionResult({ ...canonical, status: "publishing" }, checkpoint),
          );
        },
      });
      leaseHeartbeat.assertOwned();

      const completed = applyMetaPublishExecutionResult({ ...canonical, status: "publishing" }, result);
      await updateMetaPublishPlanExecution(serviceSupabase, completed);

      if (result.status !== "paused_live") {
        return NextResponse.json(
          {
            ok: false,
            mode: "publish",
            status: "failed",
            planId: completed.planId,
            ...summarizePersistedPublishSource(completed),
            controlsFingerprint: completed.idempotencyKey,
            lastCheckedAt: completed.updatedAt,
            setupSummary: summarizePersistedPublishPlan(completed),
            reconciledObjects: completed.reconciledObjects,
            error: "publish_failed",
            message: result.lastError ?? "Meta object creation failed.",
          },
          { status: 502 },
        );
      }

      return NextResponse.json({
        ok: true,
        mode: "publish",
        providerWritesEnabled: true,
        ...summarizePersistedPublishSource(completed),
        planId: completed.planId,
        status: "paused",
        controlsFingerprint: completed.idempotencyKey,
        lastCheckedAt: completed.updatedAt,
        setupSummary: summarizePersistedPublishPlan(completed),
        reconciledObjects: completed.reconciledObjects,
        message:
          "Created on Meta in PAUSED state. These new objects cannot deliver until you explicitly activate them.",
      });
    } catch (executionError) {
      const latest = await loadMetaPublishPlan(serviceSupabase, {
        workspaceId: access.access.workspaceId,
        planId: canonical.planId,
      });
      if (latest.status === "publishing") {
        await updateMetaPublishPlanExecution(serviceSupabase, {
          ...latest,
          status: "failed",
          lastError: executionError instanceof Error ? executionError.message : "Meta publish execution failed.",
          updatedAt: new Date().toISOString(),
        });
      }
      throw executionError;
    } finally {
      leaseHeartbeat.stop();
      try {
        await releaseMetaPublishExecutionLease(serviceSupabase, {
          workspaceId: access.access.workspaceId,
          planId: canonical.planId,
          leaseToken: lease.leaseToken,
        });
      } catch {
        // Preserve the publish outcome; the token-fenced lease expires safely.
      }
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

function durableReceiptMessage(status: string, lastError: string | null | undefined): string {
  if (status === "active") return "Meta confirmed that the separately approved activation completed.";
  if (status === "paused") return lastError
    ? `The Blockwise-created objects remain paused after activation failed: ${lastError}`
    : "Meta confirmed that the Blockwise-created objects are paused.";
  if (status === "publishing") return "Meta object creation is still in progress.";
  if (status === "activating") return "The separately approved activation is still in progress.";
  if (status === "paused_disabled") return "Preview only: provider writes were disabled and no Meta objects were created.";
  if (status === "unknown") return lastError ?? "Blockwise could not confirm the final Meta status.";
  return lastError ?? "Meta creation did not complete.";
}

async function loadLatestActivationReceiptState(
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>,
  workspaceId: string,
  planId: string,
): Promise<{
  status: "active" | "unknown" | "activating" | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  unconfirmedPauseIds: string[];
}> {
  const result = await serviceSupabase
    .from("meta_publish_plan_mutations")
    .select("status,last_error,outcome_status,unconfirmed_pause_ids_json,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("meta_publish_plan_id", planId)
    .eq("action", "activate")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const mutation = result.data;
  const status = mutation?.status === "applied"
    ? "active"
    : mutation?.outcome_status === "unconfirmed"
      ? "unknown"
      : mutation?.status === "approved" || mutation?.status === "applying"
        ? "activating"
        : null;
  return {
    status,
    lastError: mutation?.last_error ?? null,
    lastCheckedAt: mutation?.updated_at ? String(mutation.updated_at) : null,
    unconfirmedPauseIds: Array.isArray(mutation?.unconfirmed_pause_ids_json)
      ? mutation.unconfirmed_pause_ids_json.filter((value): value is string => typeof value === "string")
      : [],
  };
}
