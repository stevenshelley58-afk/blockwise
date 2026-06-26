import { NextResponse, type NextRequest } from "next/server";

import {
  buildAdStudioLiveResult,
  fallbackPhotoAssetsForTemplate,
  generateAdStudioCampaignPack,
  loadCachedPhotoAssetsForTemplate,
  preparedPhotoUrlsByFormat,
  type PreparedPhotoAssetsByFormat,
  type TemplatePhotoPrepInput,
} from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  refundReservedTrialCredit,
  reserveAdStudioGenerationCredit,
  type AdStudioGenerationTrialReservation,
} from "@/lib/adstudio/generation-trial";
import { enrichCampaignPackCopyWithAi } from "@/lib/adstudio/campaign-copy-enrichment";
import { compactAdStudioCampaignPackForTransport, persistAdStudioCampaignPack } from "@/lib/adstudio/persistence";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import { resolveApprovedAdStudioTemplate, templatePromptHint } from "@/lib/adstudio/template-resolver";
import { queueAdStudioTemplatePhotoPrep, type TemplatePhotoPrepQueueResult } from "@/lib/adstudio/template-photo-prep-queue";
import { resolveAdStudioGenerationBrandKit } from "@/lib/adstudio/trial-brand-kit";
import { FIRST_AD_FORMATS, type AdStudioBrandKit, type AdStudioFormat, type AdStudioGoal, type AdStudioPlatform, type FirstAdInput } from "@/lib/adstudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type CreateCampaignBody = {
  brandKit?: AdStudioBrandKit;
  goal?: AdStudioGoal;
  suburb?: string;
  city?: string;
  state?: string;
  offerId?: string;
  platforms?: AdStudioPlatform[];
  creativeFormats?: AdStudioFormat[];
  variantCount?: number;
  firstAd?: FirstAdInput;
  sourceImageDataUrl?: string;
};

type TemplatePhotoPrepResponse = {
  status: "skipped" | "cached" | "queued" | "queue_failed";
  readyFormats: AdStudioFormat[];
  pendingFormats: AdStudioFormat[];
  taskId?: string;
  error?: string;
};

const inFlightGenerations = new Map<string, number>();
const GENERATION_DEDUP_TTL_MS = 30_000;

function isAdStudioImageSrc(value: string | undefined): boolean {
  return Boolean(
    value?.startsWith("data:image/") ||
      value?.startsWith("/api/adstudio/media?") ||
      value?.startsWith("/ads/"),
  );
}

function validateFirstAd(firstAd: FirstAdInput | undefined): string | null {
  if (!firstAd) return null;
  if (firstAd.mode !== "template" && firstAd.mode !== "custom") return "Invalid first ad start mode.";
  if (!firstAd.description?.trim()) return "Add a short description so Blockwise knows what to write. Include the property, suburb, offer, or key selling point.";
  if (firstAd.description.length > 500) return "Keep the short description to 500 characters or less.";
  if (!isAdStudioImageSrc(firstAd.imageDataUrl)) return "Add a required image before generating the ad. Upload a file, choose from library, or generate an image.";
  if (JSON.stringify(firstAd.formats) !== JSON.stringify(FIRST_AD_FORMATS)) {
    return "First ad formats must be Story, Feed, and Square.";
  }
  if (firstAd.mode === "template" && !(firstAd.templateKey?.trim() || firstAd.templateId?.trim())) {
    return "Selected template was not found.";
  }
  return null;
}

function providerReadableSourceImage(request: NextRequest, ref: string | undefined, resolved: string | undefined): string | undefined {
  if (resolved) return resolved;
  if (ref?.startsWith("/ads/")) return new URL(ref, request.url).toString();
  return undefined;
}

function generationDedupKey(workspaceId: string, body: unknown): string {
  const text = JSON.stringify(body) ?? "";
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `${workspaceId}:${hash}`;
}

function photoPrepResponse(input: {
  resolvedTemplate: boolean;
  cachedAssets: PreparedPhotoAssetsByFormat;
  queue: TemplatePhotoPrepQueueResult;
}): TemplatePhotoPrepResponse {
  const readyFormats = Object.keys(preparedPhotoUrlsByFormat(input.cachedAssets)) as AdStudioFormat[];

  if (!input.resolvedTemplate) {
    return { status: "skipped", readyFormats: [], pendingFormats: [] };
  }
  if (input.queue.status === "queue_failed") {
    return {
      status: "queue_failed",
      readyFormats,
      pendingFormats: input.queue.pendingFormats,
      error: input.queue.error,
    };
  }
  if (input.queue.status === "queued") {
    return {
      status: "queued",
      readyFormats,
      pendingFormats: input.queue.pendingFormats,
      taskId: input.queue.taskId,
    };
  }

  return { status: "cached", readyFormats, pendingFormats: [] };
}

async function loadCachedTemplatePhotos(input: TemplatePhotoPrepInput): Promise<PreparedPhotoAssetsByFormat> {
  try {
    return await loadCachedPhotoAssetsForTemplate(input);
  } catch (error) {
    console.warn(JSON.stringify({
      level: "warning",
      msg: "adstudio_template_photo_prep_cache_lookup_failed",
      workspaceId: input.workspaceId,
      templateKey: input.template.templateKey ?? input.template.id,
      error: error instanceof Error ? error.message : String(error),
    }));
    return {};
  }
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

  inFlightGenerations.set(dedupKey, Date.now());
  let trialReservation: AdStudioGenerationTrialReservation | null = null;

  try {
    const firstAdError = validateFirstAd(body.firstAd);
    if (firstAdError) {
      return NextResponse.json({ error: firstAdError }, { status: 400 });
    }
    const resolvedTemplate = body.firstAd?.mode === "template"
      ? await resolveApprovedAdStudioTemplate({
          templateKey: body.firstAd.templateKey,
          templateId: body.firstAd.templateId,
        })
      : null;

    const trialGate = await reserveAdStudioGenerationCredit({
      supabase: context.supabase,
      workspaceId: context.access.workspaceId,
      actorProfileId: context.access.userId,
    });

    if (!trialGate.ok) {
      return trialGate.response;
    }

    trialReservation = trialGate.reservation;

    const brandKitResult = await resolveAdStudioGenerationBrandKit({
      supabase: context.supabase,
      workspaceId: context.access.workspaceId,
      workspaceName: context.access.workspaceName,
      region: context.access.region,
      userId: context.access.userId,
      submittedBrandKit: body.brandKit,
      isTrialWorkspace: trialReservation.isTrialWorkspace,
    });

    if (!brandKitResult.ok) {
      await refundReservedTrialCredit(trialReservation);
      return NextResponse.json({ error: brandKitResult.error }, { status: brandKitResult.status });
    }

    const sourceImageRef = body.sourceImageDataUrl ?? body.firstAd?.imageDataUrl;
    const sourceImageUrl = await resolveAdStudioImageForModel(
      context.supabase,
      context.access.workspaceId,
      sourceImageRef,
    );
    const templatePrepSourceImage = providerReadableSourceImage(request, sourceImageRef, sourceImageUrl);
    const templatePhotoPrepInput = resolvedTemplate && body.firstAd?.mode === "template"
      ? {
          workspaceId: context.access.workspaceId,
          userId: context.access.userId,
          brandKit: brandKitResult.brandKit,
          template: resolvedTemplate,
          formats: body.firstAd.formats,
          sourceImageRef: body.firstAd.imageDataUrl,
          sourceImageForModel: templatePrepSourceImage ?? "",
          campaign: {
            goal: resolvedTemplate.goal,
            offerId: resolvedTemplate.offerId,
            market: {
              suburb: body.suburb ?? "Scarborough",
              city: body.city ?? "Perth",
              state: body.state ?? "WA",
            },
          },
          brief: body.firstAd.description,
        } satisfies TemplatePhotoPrepInput
      : null;
    const cachedTemplatePhotos = templatePhotoPrepInput ? await loadCachedTemplatePhotos(templatePhotoPrepInput) : {};
    const immediateTemplatePhotos = templatePhotoPrepInput
      ? {
          ...fallbackPhotoAssetsForTemplate(templatePhotoPrepInput),
          ...cachedTemplatePhotos,
        }
      : {};
    const pendingPhotoPrepFormats = templatePhotoPrepInput
      ? templatePhotoPrepInput.formats.filter((format) => !cachedTemplatePhotos[format])
      : [];

    let pack = generateAdStudioCampaignPack({
      workspaceId: context.access.workspaceId,
      brandKit: brandKitResult.brandKit,
      goal: resolvedTemplate?.goal ?? body.goal ?? "seller_leads",
      suburb: body.suburb ?? "Scarborough",
      city: body.city ?? "Perth",
      state: body.state ?? "WA",
      offerId: resolvedTemplate?.offerId ?? body.offerId ?? "seller_prep_checklist",
      // Google Ads parked for Meta-only v1 (see src/lib/config/feature-flags.ts). Was: ["meta", "google_search", "google_pmax", "google_demand_gen"]
      platforms: body.platforms ?? ["meta"],
      creativeFormats: body.creativeFormats,
      variantCount: body.variantCount ?? 5,
      firstAd: body.firstAd,
      sourceImageDataUrl: body.sourceImageDataUrl,
      sourceImagesByFormat: preparedPhotoUrlsByFormat(immediateTemplatePhotos),
      resolvedTemplate,
    });
    const photoPrepQueuePromise = templatePhotoPrepInput
      ? queueAdStudioTemplatePhotoPrep(
          {
            ...templatePhotoPrepInput,
            campaignId: pack.campaign.campaignId,
          },
          pendingPhotoPrepFormats,
        )
      : Promise.resolve({ status: "skipped" as const, pendingFormats: [] });
    // Selected templates ship their curated, on-brand copy (headline, body, and
    // CTA) as-is. AI copy enrichment is reserved for the free-form "describe your
    // ad" flow, where there is no curated copy to preserve. Routing template copy
    // through enrichment was the regression: it overwrote the curated headline and
    // body with generic AI text ("Spearwood Double-Storey Price Update") and
    // collapsed CTAs like "Request price update" down to "Learn more".
    if (body.firstAd?.mode !== "template") {
      pack = await enrichCampaignPackCopyWithAi({
        pack,
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        brief: body.firstAd?.description,
        templateName: resolvedTemplate?.name,
        templateHint: templatePromptHint(resolvedTemplate),
        sourceImageUrl,
      });
    }
    const persisted = await persistAdStudioCampaignPack(context.supabase, pack, context.access.userId);
    const photoPrepQueue = await photoPrepQueuePromise;

    if (persisted.error) {
      await refundReservedTrialCredit(trialReservation);
    }

    const liveResult = buildAdStudioLiveResult({
      data: compactAdStudioCampaignPackForTransport(pack),
      persistenceError: persisted.error?.message,
    });

    return NextResponse.json(
      {
        campaignPack: liveResult.data,
        data: liveResult.data,
        persistence: liveResult.persistence,
        photoPrep: photoPrepResponse({
          resolvedTemplate: Boolean(templatePhotoPrepInput),
          cachedAssets: cachedTemplatePhotos,
          queue: photoPrepQueue,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    await refundReservedTrialCredit(trialReservation);
    return errorResponse(error, 400);
  } finally {
    inFlightGenerations.delete(dedupKey);
  }
}
