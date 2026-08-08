import { randomUUID } from "node:crypto";

import { NextResponse, after, type NextRequest } from "next/server";

import { recordWorkspaceFunnelEventBestEffort } from "@/lib/analytics/progressive-funnel";
import { buildAdStudioLiveResult } from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { validateFirstAd } from "@/lib/adstudio/first-ad-input";
import { publicAdStudioGenerationError } from "@/lib/adstudio/generation-error";
import {
  reserveAdStudioGenerationCredits,
  type AdStudioGenerationCreditReservation,
} from "@/lib/adstudio/generation-credits";
import { refundOutstandingWorkspaceCredits } from "@/lib/credits/workspace-credits";
import {
  assertDeterministicFeedEditingReady,
  runTemplateCampaignGeneration,
  type CreateCampaignBody,
} from "@/lib/adstudio/generate-template-campaign";
import { adstudioTemplatesV2Enabled } from "@/lib/adstudio/v2/flags";
import { generateV2Campaign, V2GenerationError } from "@/lib/adstudio/v2/generate.ts";
import { resolveReadyTemplateV2 } from "@/lib/adstudio/v2/template-resolver.ts";
import { resolveAdStudioGenerationBrandKit } from "@/lib/adstudio/trial-brand-kit";
import { compactAdStudioCampaignPackForTransport, persistAdStudioCampaignPack } from "@/lib/adstudio/persistence";
import { resolveCloneCampaignId } from "@/lib/adstudio/clone-campaign";
import { buildAdStudioCreativeLibrary } from "@/lib/adstudio/creative-library";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  cancelQueuedJob,
  enqueueQueuedJob,
} from "@/lib/providers/job-queue-enqueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The synchronous degraded-mode pipeline (copy + both clone renders in one
// request, plus the deferred advisory QA pass via after()) can exceed 120s;
// 300 is the Pro plan ceiling.
export const maxDuration = 300;

const inFlightGenerations = new Map<string, number>();
// This must exceed the whole Vercel render window. A 30-second lock allowed a
// retry to start while the median image request was still running, producing
// duplicate provider spend and competing with the original render.
const GENERATION_DEDUP_TTL_MS = 15 * 60_000;
const GENERATION_RECOVERY_DELAY_MS = 5 * 60_000 + 15_000;

function generationDedupKey(workspaceId: string, body: unknown): string {
  const text = JSON.stringify(body) ?? "";
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `${workspaceId}:${hash}`;
}

function generationCreditMutationKey(
  request: NextRequest,
  body: CreateCampaignBody,
  workspaceId: string,
  dedupKey: string,
): string {
  const supplied = body.clientMutationId ?? request.headers.get("idempotency-key");
  const normalized = supplied?.trim().replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 160);
  if (normalized) return `adstudio-generation:${workspaceId}:${normalized}`;

  const bucket = Math.floor(Date.now() / GENERATION_DEDUP_TTL_MS);
  return `adstudio-generation:${dedupKey}:${bucket}`;
}

export async function GET(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const requestedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
  const includeCreativeLibrary = request.nextUrl.searchParams.get("include") === "creativeLibrary";
  const { data, error } = await context.supabase
    .from("adstudio_campaigns")
    .select("id,name,status,created_at,updated_at")
    .eq("workspace_id", context.access.workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const campaigns = data ?? [];
  if (!includeCreativeLibrary) {
    return NextResponse.json({ campaigns });
  }
  const campaignIds = campaigns.flatMap((campaign) => typeof campaign.id === "string" ? [campaign.id] : []);
  if (campaignIds.length === 0) return NextResponse.json({ campaigns, creativeLibrary: [] });

  const [creativeResult, publishPlanResult] = await Promise.all([
    context.supabase
      .from("adstudio_creatives")
      .select("campaign_id,variant_id,format,canvas_json,preview_url,updated_at")
      .eq("workspace_id", context.access.workspaceId)
      .in("campaign_id", campaignIds)
      .order("updated_at", { ascending: false }),
    context.supabase
      .from("meta_publish_plans")
      .select("adstudio_campaign_id,status")
      .eq("workspace_id", context.access.workspaceId)
      .in("adstudio_campaign_id", campaignIds),
  ]);

  const creativeLibrary = buildAdStudioCreativeLibrary(
    campaigns,
    creativeResult.error ? [] : creativeResult.data ?? [],
    publishPlanResult.error ? [] : publishPlanResult.data ?? [],
  );

  return NextResponse.json({ campaigns, creativeLibrary });
}

type SupabaseAccessClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Cross-instance dedup: the primary-key insert into adstudio_generation_locks
 * wins; a concurrent duplicate on another Vercel instance sees the conflict
 * and 409s. Stale locks (crashed runs) older than the TTL are stolen. Fails
 * open on unexpected DB errors — the in-memory Map still guards this instance.
 */
async function acquireGenerationLock(
  supabase: SupabaseAccessClient,
  workspaceId: string,
  dedupeKey: string,
): Promise<boolean> {
  const inserted = await supabase
    .from("adstudio_generation_locks")
    .insert({ dedupe_key: dedupeKey, workspace_id: workspaceId });
  if (!inserted.error) return true;
  if (inserted.error.code !== "23505") {
    console.error("adstudio_generation_locks insert failed", inserted.error.message);
    return true;
  }

  const existing = await supabase
    .from("adstudio_generation_locks")
    .select("created_at")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  const createdAt = existing.data?.created_at ? Date.parse(existing.data.created_at) : 0;
  if (Date.now() - createdAt < GENERATION_DEDUP_TTL_MS) return false;

  const stolen = await supabase
    .from("adstudio_generation_locks")
    .upsert(
      { dedupe_key: dedupeKey, workspace_id: workspaceId, created_at: new Date().toISOString() },
      { onConflict: "dedupe_key" },
    );
  if (stolen.error) console.error("adstudio_generation_locks steal failed", stolen.error.message);
  return true;
}

async function releaseGenerationLock(supabase: SupabaseAccessClient, dedupeKey: string): Promise<void> {
  const deleted = await supabase.from("adstudio_generation_locks").delete().eq("dedupe_key", dedupeKey);
  if (deleted.error) console.error("adstudio_generation_locks release failed", deleted.error.message);
}

export async function POST(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const body = await readJsonBody<CreateCampaignBody>(request);
  const dedupKey = generationDedupKey(context.access.workspaceId, body);
  const creditMutationKey = generationCreditMutationKey(
    request,
    body,
    context.access.workspaceId,
    dedupKey,
  );
  const inFlightSince = inFlightGenerations.get(dedupKey);

  if (inFlightSince !== undefined && Date.now() - inFlightSince < GENERATION_DEDUP_TTL_MS) {
    return NextResponse.json(
      { error: "This generation is already running. Wait for it to finish before retrying." },
      { status: 409 },
    );
  }

  if (!(await acquireGenerationLock(context.supabase, context.access.workspaceId, dedupKey))) {
    return NextResponse.json(
      { error: "This generation is already running. Wait for it to finish before retrying." },
      { status: 409 },
    );
  }

  inFlightGenerations.set(dedupKey, Date.now());
  let creditReservation: AdStudioGenerationCreditReservation | null = null;
  let creativeJobId: string | null = null;
  let recoveryQueueJobId: string | null = null;

  try {
    const firstAdError = validateFirstAd(body.firstAd);
    if (firstAdError) {
      return NextResponse.json({ error: firstAdError }, { status: 400 });
    }
    // Track E (§6): resolve the v2 template BEFORE reserving credits. The v2
    // path renders free (0 credits) and must not hit the credit gate (402 on
    // empty trials). The reservation only applies to the v1 image-model path.
    const v2Template = adstudioTemplatesV2Enabled()
      ? resolveReadyTemplateV2(body.firstAd!.templateId)
      : null;

    if (!v2Template) {
      const creditGate = await reserveAdStudioGenerationCredits({
        supabase: context.supabase,
        workspaceId: context.access.workspaceId,
        actorProfileId: context.access.userId,
        mutationKey: creditMutationKey,
      });
      if (!creditGate.ok) {
        return creditGate.response;
      }
      creditReservation = creditGate.reservation;
    }
    const funnelService = createSupabaseServiceClient();

    if (v2Template) {
        try {
          const brandKitResult = await resolveAdStudioGenerationBrandKit({
            supabase: context.supabase,
            workspaceId: context.access.workspaceId,
            workspaceName: context.access.workspaceName,
            region: context.access.region,
            userId: context.access.userId,
          });
          if (!brandKitResult.ok) {
            throw new V2GenerationError(brandKitResult.error, 422);
          }
          const v2 = await generateV2Campaign({
            workspaceId: context.access.workspaceId,
            userId: context.access.userId,
            template: v2Template,
            brandKit: brandKitResult.brandKit,
            firstAd: body.firstAd!,
            suburb: body.suburb,
            city: body.city,
            state: body.state,
            supabase: createSupabaseServiceClient() as never,
          });
          await persistAdStudioCampaignPack(context.supabase, v2.pack, context.access.userId);
          await refundOutstandingWorkspaceCredits({
            reservation: creditReservation,
            mutationKey: `${creditMutationKey}:v2_zero_render_credits`,
            reason: "v2_renders_cost_zero",
          });
          const liveResult = buildAdStudioLiveResult({
            data: compactAdStudioCampaignPackForTransport(v2.pack),
          });
          return NextResponse.json(
            {
              campaignPack: liveResult.data,
              data: liveResult.data,
              persistence: liveResult.persistence,
              v2: true,
              renderMs: v2.renderMs,
              warnings: v2.warnings,
            },
            { status: 201 },
          );
        } catch (error) {
          if (error instanceof V2GenerationError) {
            return errorResponse(new Error(error.message), error.status);
          }
          throw error;
        }
    }
    // Template not ready yet: fall through to the v1 pipeline (rollout is
    // per-template during the transition, per §12 Track G).
    await recordWorkspaceFunnelEventBestEffort(funnelService, {
      eventName: "template_selected",
      workspaceId: context.access.workspaceId,
      idempotencyKey: `activation:${context.access.workspaceId}:first-template-selected`,
      properties: {
        template_id: body.firstAd!.templateId,
        mutation_key: creditMutationKey,
      },
    });

    // Vercel owns the customer-critical path so there is no queue/poll delay:
    // copy → feed clone → persist returns in this request. A delayed copy of
    // the same idempotent job sits in Supabase for the VPS worker to recover
    // only if this function is killed before it can cancel that row.
    {
      const origin = request.nextUrl.origin;
      const service = createSupabaseServiceClient();
      const correlationId = randomUUID();
      const expectedCampaignId = resolveCloneCampaignId({
        workspaceId: context.access.workspaceId,
        templateId: body.firstAd!.templateId,
        suburb: body.suburb ?? "Scarborough",
        description: body.firstAd!.description,
      });
      const inserted = await service
        .from("adstudio_creative_jobs")
        .insert({
          workspace_id: context.access.workspaceId,
          created_by: context.access.userId,
          status: "running",
          attempts: 1,
          kind: "template_campaign",
          headline: body.firstAd!.description.slice(0, 200),
          payload: {
            body,
            reservation: creditReservation,
            workspaceName: context.access.workspaceName,
            region: context.access.region,
            correlationId,
            expectedCampaignId,
          },
        })
        .select("id")
        .single();
      if (inserted.error) {
        throw new Error(`Could not create the generation job (${inserted.error.message}).`);
      }
      creativeJobId = String(inserted.data.id);

      const recovery = await enqueueQueuedJob({
        workspaceId: context.access.workspaceId,
        kind: "adstudio.generate.template",
        payload: {
          workspaceId: context.access.workspaceId,
          userId: context.access.userId,
          creativeJobId,
          origin,
        },
        // A caught generation failure is final and refunds immediately. The
        // queue's lease reaper still retries a worker process crash because no
        // fail_job call occurs in that case.
        maxAttempts: 1,
        runAfter: new Date(Date.now() + GENERATION_RECOVERY_DELAY_MS),
        dedupeKey: `adstudio.generate.template:${creativeJobId}`,
      });
      recoveryQueueJobId = recovery.id;

      await recordFirstGenerationStarted(
        funnelService,
        context.access.workspaceId,
        creditMutationKey,
        "inline",
      );
      const result = await runTemplateCampaignGeneration({
        supabase: context.supabase,
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        origin,
        body,
        workspaceName: context.access.workspaceName,
        region: context.access.region,
        creditReservation: creditReservation ?? undefined,
        correlationId,
        expectedCampaignId,
      });
      if (result.requiresDeterministicEditing) {
        await result.editingLayersTask;
        await assertDeterministicFeedEditingReady({
          supabase: context.supabase,
          workspaceId: context.access.workspaceId,
          campaignId: result.campaignId,
        });
      }
      const completedAt = new Date().toISOString();
      const completedJob = await service
        .from("adstudio_creative_jobs")
        .update({
          status: "done",
          campaign_id: result.campaignId,
          error: null,
          updated_at: completedAt,
        })
        .eq("id", creativeJobId)
        .eq("workspace_id", context.access.workspaceId);
      if (completedJob.error) {
        console.error("adstudio creative job completion update failed", completedJob.error.message);
      }
      if (recoveryQueueJobId) {
        await cancelGenerationRecoveryBestEffort({
          serviceSupabase: service,
          workspaceId: context.access.workspaceId,
          jobId: recoveryQueueJobId,
          failureContext: "after inline completion",
        });
      }
      await recordWorkspaceFunnelEventBestEffort(funnelService, {
        eventName: "first_generation_completed",
        workspaceId: context.access.workspaceId,
        idempotencyKey: `activation:${context.access.workspaceId}:first-generation-completed`,
        properties: {
          mutation_key: creditMutationKey,
          campaign_id: result.campaignId,
          execution: "inline",
        },
      });

      // The customer has the ad and its prebuilt editor hit-boxes in this
      // response. Only the optional instant-edit plate and Story patch finish
      // in the background.
      if (!result.requiresDeterministicEditing) {
        after(() => result.editingLayersTask);
      }
      if (result.storyTask) after(() => result.storyTask);

      const liveResult = buildAdStudioLiveResult({
        data: compactAdStudioCampaignPackForTransport(result.campaignPack),
      });

      return NextResponse.json(
        {
          campaignPack: liveResult.data,
          data: liveResult.data,
          persistence: liveResult.persistence,
          jobId: creativeJobId,
        },
        { status: 201 },
      );
    }

  } catch (error) {
    const service = createSupabaseServiceClient();
    if (recoveryQueueJobId) {
      await cancelGenerationRecoveryBestEffort({
        serviceSupabase: service,
        workspaceId: context.access.workspaceId,
        jobId: recoveryQueueJobId,
        failureContext: "after inline failure",
      });
    }
    if (creativeJobId) {
      const failedJob = await service
        .from("adstudio_creative_jobs")
        .update({
          status: "failed",
          error: error instanceof Error ? error.message : "Ad generation failed.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", creativeJobId)
        .eq("workspace_id", context.access.workspaceId);
      if (failedJob.error) console.error("adstudio creative job failure update failed", failedJob.error.message);
    }
    await refundOutstandingWorkspaceCredits({
      reservation: creditReservation,
      mutationKey: `${creditReservation?.mutationKey ?? creditMutationKey}:refund:route-failure`,
      reason: "generation_route_failed",
    });
    console.error("adstudio campaign generation failed", error);
    return errorResponse(new Error(publicAdStudioGenerationError(error)), 400);
  } finally {
    inFlightGenerations.delete(dedupKey);
    await releaseGenerationLock(context.supabase, dedupKey);
  }
}

async function cancelGenerationRecoveryBestEffort(input: {
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>;
  workspaceId: string;
  jobId: string;
  failureContext: string;
}): Promise<void> {
  try {
    const cancelled = await cancelQueuedJob({
      serviceSupabase: input.serviceSupabase,
      workspaceId: input.workspaceId,
      jobId: input.jobId,
    });
    if (!cancelled) {
      console.warn(
        `adstudio recovery cancellation ${input.failureContext} found no pending job`,
      );
    }
  } catch (error) {
    console.error(
      `adstudio recovery cancellation ${input.failureContext} failed`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function recordFirstGenerationStarted(
  service: ReturnType<typeof createSupabaseServiceClient>,
  workspaceId: string,
  mutationKey: string,
  execution: "inline" | "vps_recovery",
): Promise<void> {
  await recordWorkspaceFunnelEventBestEffort(service, {
    eventName: "first_generation_started",
    workspaceId,
    idempotencyKey: `activation:${workspaceId}:first-generation-started`,
    properties: { mutation_key: mutationKey, execution },
  });
}
