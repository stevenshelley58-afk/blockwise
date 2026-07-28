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
  runTemplateCampaignGeneration,
  type CreateCampaignBody,
} from "@/lib/adstudio/generate-template-campaign";
import { compactAdStudioCampaignPackForTransport } from "@/lib/adstudio/persistence";
import { buildAdStudioCreativeLibrary } from "@/lib/adstudio/creative-library";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The synchronous degraded-mode pipeline (copy + both clone renders in one
// request, plus the deferred advisory QA pass via after()) can exceed 120s;
// 300 is the Pro plan ceiling.
export const maxDuration = 300;

// Secrets pasted into the Vercel dashboard can pick up an invisible BOM
// (U+FEFF), which makes every trigger call throw "Cannot convert argument to
// a ByteString" — the async path then silently degrades to sync forever.
export function normaliseTriggerSecretKey(value: string | undefined): string {
  return (value ?? "").replace(/[​-‍﻿]/g, "").trim();
}

async function triggerTemplateGeneration(payload: {
  workspaceId: string;
  userId: string;
  jobId: string;
  origin: string;
  body: CreateCampaignBody;
}): Promise<void> {
  const secretKey = normaliseTriggerSecretKey(process.env.TRIGGER_SECRET_KEY);
  if (!secretKey) throw new Error("Trigger.dev is not configured.");

  // Import after normalisation so the SDK cannot capture an invalid raw key.
  const { configure, tasks } = await import("@trigger.dev/sdk");
  configure({ secretKey });
  await tasks.trigger("adstudio.generate.template", payload, {
    idempotencyKey: payload.jobId,
    tags: ["adstudio-generate", payload.workspaceId, payload.jobId],
    maxAttempts: 1,
  });
}

const inFlightGenerations = new Map<string, number>();
const GENERATION_DEDUP_TTL_MS = 30_000;

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
      .select("campaign_id,format,canvas_json,preview_url,updated_at")
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

  try {
    const firstAdError = validateFirstAd(body.firstAd);
    if (firstAdError) {
      return NextResponse.json({ error: firstAdError }, { status: 400 });
    }
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
    const funnelService = createSupabaseServiceClient();
    await recordWorkspaceFunnelEventBestEffort(funnelService, {
      eventName: "template_selected",
      workspaceId: context.access.workspaceId,
      idempotencyKey: `activation:${context.access.workspaceId}:first-template-selected`,
      properties: {
        template_id: body.firstAd!.templateId,
        mutation_key: creditMutationKey,
      },
    });

    // Copy, clone, QA, and persistence run as one server-owned operation. The
    // whole copy → clone → QA → persist pipeline runs server-side. Normally as
    // a trigger.dev job (202 + polling — kills the 120s ceiling); inline only
    // when trigger is not configured or ADSTUDIO_SYNC_GENERATE=1 (local/dev).
    {
      const origin = request.nextUrl.origin;

      if (normaliseTriggerSecretKey(process.env.TRIGGER_SECRET_KEY) && process.env.ADSTUDIO_SYNC_GENERATE !== "1") {
        const service = createSupabaseServiceClient();
        const inserted = await service
          .from("adstudio_creative_jobs")
          .insert({
            workspace_id: context.access.workspaceId,
            created_by: context.access.userId,
            status: "queued",
            kind: "template_campaign",
            headline: body.firstAd!.description.slice(0, 200),
            // The task refunds the reservation on failure; the route cannot —
            // it has already returned 202 by then.
            payload: {
              body,
              reservation: creditReservation,
              workspaceName: context.access.workspaceName,
              region: context.access.region,
            },
          })
          .select("id")
          .single();

        if (inserted.error) {
          throw new Error(`Could not queue the generation job (${inserted.error.message}).`);
        }

        const jobId = String(inserted.data.id);

        try {
          await triggerTemplateGeneration({
            workspaceId: context.access.workspaceId,
            userId: context.access.userId,
            jobId,
            origin,
            body,
          });
          await recordFirstGenerationStarted(
            funnelService,
            context.access.workspaceId,
            creditMutationKey,
            "trigger",
          );
        } catch (error) {
          // Fail quickly instead of hiding a queue fault behind a multi-minute
          // synchronous request. The customer can retry without a lost credit.
          console.error("adstudio.generate.template trigger failed", error);
          await service
            .from("adstudio_creative_jobs")
            .update({ status: "failed", error: "The background generation job could not be started.", updated_at: new Date().toISOString() })
            .eq("id", jobId)
            .eq("workspace_id", context.access.workspaceId);
          throw new Error("Ad generation could not start. Please try again in a moment.");
        }

        // The generation lock is released in finally; Trigger owns the long run.
        return NextResponse.json({ jobId }, { status: 202 });
      }

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
        isTrialWorkspace: creditReservation.isTrialWorkspace,
        creditReservation,
      });
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

      // The customer has the ad in this response; region detection
      // (editor hit-boxes) and the story (9:16) background patch run
      // after the response is sent.
      after(() => result.enrichRegions());
      if (result.storyTask) after(() => result.storyTask);

      const liveResult = buildAdStudioLiveResult({
        data: compactAdStudioCampaignPackForTransport(result.campaignPack),
      });

      return NextResponse.json(
        {
          campaignPack: liveResult.data,
          data: liveResult.data,
          persistence: liveResult.persistence,
        },
        { status: 201 },
      );
    }

  } catch (error) {
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

async function recordFirstGenerationStarted(
  service: ReturnType<typeof createSupabaseServiceClient>,
  workspaceId: string,
  mutationKey: string,
  execution: "trigger" | "inline",
): Promise<void> {
  await recordWorkspaceFunnelEventBestEffort(service, {
    eventName: "first_generation_started",
    workspaceId,
    idempotencyKey: `activation:${workspaceId}:first-generation-started`,
    properties: { mutation_key: mutationKey, execution },
  });
}
