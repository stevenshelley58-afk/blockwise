import { tasks } from "@trigger.dev/sdk/v3";
import { NextResponse, type NextRequest } from "next/server";

import { buildAdStudioLiveResult } from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  refundReservedTrialCredit,
  reserveAdStudioGenerationCredit,
  type AdStudioGenerationTrialReservation,
} from "@/lib/adstudio/generation-trial";
import {
  runTemplateCampaignGeneration,
  type CreateCampaignBody,
} from "@/lib/adstudio/generate-template-campaign";
import { compactAdStudioCampaignPackForTransport } from "@/lib/adstudio/persistence";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { FIRST_AD_FORMATS, type FirstAdInput } from "@/lib/adstudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The synchronous degraded-mode pipeline (copy + clone + vision QA in one
// request) regularly needs more than 120s; 300 is the Pro plan ceiling.
export const maxDuration = 300;

// Headroom under maxDuration for the synchronous fallback path.
const SYNC_GENERATION_DEADLINE_MS = 240_000;

// Secrets pasted into the Vercel dashboard can pick up an invisible BOM
// (U+FEFF), which makes every trigger call throw "Cannot convert argument to
// a ByteString" — the async path then silently degrades to sync forever.
if (process.env.TRIGGER_SECRET_KEY) {
  process.env.TRIGGER_SECRET_KEY = process.env.TRIGGER_SECRET_KEY.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

const inFlightGenerations = new Map<string, number>();
const GENERATION_DEDUP_TTL_MS = 30_000;

// Warm-lambda cache: once trigger.dev rejects the key as invalid, stop paying
// the queue-insert + failed-trigger round trip on every generation. Fixing
// the key requires a redeploy, which resets this.
let triggerAuthBroken = false;

function isAdStudioImageSrc(value: string | undefined): boolean {
  return Boolean(
    value?.startsWith("data:image/") ||
      value?.startsWith("/api/adstudio/media?") ||
      value?.startsWith("/adstudio-samples/") ||
      value?.startsWith("/ads/"),
  );
}

function validateFirstAd(firstAd: FirstAdInput | undefined): string | null {
  if (!firstAd) return "Choose an ad sample and add your assets before generating.";
  if (!firstAd.description?.trim()) return "Add a short description so Blockwise knows what to write. Include the property, suburb, offer, or key selling point.";
  if (firstAd.description.length > 500) return "Keep the short description to 500 characters or less.";
  if (!isAdStudioImageSrc(firstAd.imageDataUrl)) return "Add a required image before generating the ad. Upload a file, choose from library, or generate an image.";
  if (firstAd.templateCloneImage && !isAdStudioImageSrc(firstAd.templateCloneImage)) {
    return "Generated template clone is invalid. Generate the ad again.";
  }
  for (const cloneImage of Object.values(firstAd.templateCloneImagesByFormat ?? {})) {
    if (cloneImage && !isAdStudioImageSrc(cloneImage)) return "Generated template clone is invalid. Generate the ad again.";
  }
  for (const slotImage of Object.values(firstAd.imageDataUrls ?? {})) {
    if (slotImage && !isAdStudioImageSrc(slotImage)) return "One of the selected template images is invalid. Replace it and try again.";
  }
  if (JSON.stringify(firstAd.formats) !== JSON.stringify(FIRST_AD_FORMATS)) {
    return "First ad formats must be Story and Feed.";
  }
  if (!firstAd.templateId?.trim()) return "Selected sample was not found.";
  if (firstAd.copy) {
    const fields = [firstAd.copy.primaryText, firstAd.copy.headline, firstAd.copy.description, firstAd.copy.cta];
    if (fields.some((field) => typeof field !== "string" || field.length > 500)) {
      return "Generated copy is invalid. Generate the ad again.";
    }
  }
  for (const value of Object.values(firstAd.onImageCopy ?? {})) {
    if (typeof value !== "string" || value.length > 200) {
      return "Keep each ad text field to 200 characters or less.";
    }
  }
  return null;
}

function generationDedupKey(workspaceId: string, body: unknown): string {
  const text = JSON.stringify(body) ?? "";
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `${workspaceId}:${hash}`;
}

export async function GET(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const { data, error } = await context.supabase
    .from("adstudio_campaigns")
    .select("*")
    .eq("workspace_id", context.access.workspaceId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ campaigns: data ?? [] });
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
  let trialReservation: AdStudioGenerationTrialReservation | null = null;

  try {
    const firstAdError = validateFirstAd(body.firstAd);
    if (firstAdError) {
      return NextResponse.json({ error: firstAdError }, { status: 400 });
    }
    const trialGate = await reserveAdStudioGenerationCredit({
      supabase: context.supabase,
      workspaceId: context.access.workspaceId,
      actorProfileId: context.access.userId,
    });

    if (!trialGate.ok) {
      return trialGate.response;
    }

    trialReservation = trialGate.reservation;

    // Copy, clone, QA, and persistence run as one server-owned operation. The
    // whole copy → clone → QA → persist pipeline runs server-side. Normally as
    // a trigger.dev job (202 + polling — kills the 120s ceiling); inline only
    // when trigger is not configured or ADSTUDIO_SYNC_GENERATE=1 (local/dev).
    {
      const origin = request.nextUrl.origin;

      if (process.env.TRIGGER_SECRET_KEY && !triggerAuthBroken && process.env.ADSTUDIO_SYNC_GENERATE !== "1") {
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
              reservation: trialReservation,
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
        let triggered = false;

        try {
          await tasks.trigger(
            "adstudio.generate.template",
            {
              workspaceId: context.access.workspaceId,
              userId: context.access.userId,
              jobId,
              origin,
              body,
            },
            {
              idempotencyKey: jobId,
              tags: ["adstudio-generate", context.access.workspaceId, jobId],
              maxAttempts: 1,
            },
          );
          triggered = true;
        } catch (error) {
          // Trigger unavailable or the task not yet registered (e.g. the
          // deploy window right after a release): mark the queued row failed
          // and FALL THROUGH to the inline sync path — generation must never
          // depend on the queue being healthy.
          console.error("adstudio.generate.template trigger failed; falling back to sync", error);
          if ((error as { status?: number })?.status === 401) triggerAuthBroken = true;
          await service
            .from("adstudio_creative_jobs")
            .update({ status: "failed", error: "The generation job could not be started; ran synchronously instead.", updated_at: new Date().toISOString() })
            .eq("id", jobId)
            .eq("workspace_id", context.access.workspaceId);
        }

        // The generation lock is released in finally, as for the sync path; the
        // job itself is idempotent via the deterministic campaign id.
        if (triggered) {
          return NextResponse.json({ jobId }, { status: 202 });
        }
      }

      const result = await runTemplateCampaignGeneration({
        supabase: context.supabase,
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        origin,
        body,
        deadlineMs: SYNC_GENERATION_DEADLINE_MS,
        maxCloneAttempts: 1,
        // Draft-then-upgrade: the sync path returns preview-tier renders as quickly
        // as possible; the client can re-render them at the quality tier in
        // the background without making the current ad worse.
        tier: "preview",
        workspaceName: context.access.workspaceName,
        region: context.access.region,
        isTrialWorkspace: trialReservation.isTrialWorkspace,
      });

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
    await refundReservedTrialCredit(trialReservation);
    return errorResponse(error, 400);
  } finally {
    inFlightGenerations.delete(dedupKey);
    await releaseGenerationLock(context.supabase, dedupKey);
  }
}
