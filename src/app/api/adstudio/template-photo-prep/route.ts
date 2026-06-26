import { NextResponse, type NextRequest } from "next/server";

import {
  loadCachedPhotoAssetsForTemplate,
  preparedPhotoUrlsByFormat,
  type AdStudioBrandKit,
  type AdStudioFormat,
  type AdStudioGoal,
  type FirstAdInput,
  type PreparedPhotoAssetsByFormat,
  type TemplatePhotoPrepInput,
} from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import { resolveApprovedAdStudioTemplate } from "@/lib/adstudio/template-resolver";
import { queueAdStudioTemplatePhotoPrep, type TemplatePhotoPrepQueueResult } from "@/lib/adstudio/template-photo-prep-queue";
import { resolveAdStudioGenerationBrandKit } from "@/lib/adstudio/trial-brand-kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type TemplatePhotoPrepBody = {
  brandKit?: AdStudioBrandKit;
  goal?: AdStudioGoal;
  suburb?: string;
  city?: string;
  state?: string;
  offerId?: string;
  firstAd?: FirstAdInput;
};

function isAdStudioImageSrc(value: string | undefined): boolean {
  return Boolean(
    value?.startsWith("data:image/") ||
      value?.startsWith("/api/adstudio/media?") ||
      value?.startsWith("/ads/"),
  );
}

function providerReadableSourceImage(request: NextRequest, ref: string | undefined, resolved: string | undefined): string | undefined {
  if (resolved) return resolved;
  if (ref?.startsWith("/ads/")) return new URL(ref, request.url).toString();
  return undefined;
}

function responseForPhotoPrep(input: {
  cachedAssets: PreparedPhotoAssetsByFormat;
  queue: TemplatePhotoPrepQueueResult;
}) {
  const readyFormats = Object.keys(preparedPhotoUrlsByFormat(input.cachedAssets)) as AdStudioFormat[];

  if (input.queue.status === "queue_failed") {
    return {
      status: "queue_failed" as const,
      readyFormats,
      pendingFormats: input.queue.pendingFormats,
      error: input.queue.error,
    };
  }
  if (input.queue.status === "queued") {
    return {
      status: "queued" as const,
      readyFormats,
      pendingFormats: input.queue.pendingFormats,
      taskId: input.queue.taskId,
    };
  }

  return { status: "cached" as const, readyFormats, pendingFormats: [] };
}

async function loadCachedTemplatePhotos(input: TemplatePhotoPrepInput): Promise<PreparedPhotoAssetsByFormat> {
  try {
    return await loadCachedPhotoAssetsForTemplate(input);
  } catch (error) {
    console.warn(JSON.stringify({
      level: "warning",
      msg: "adstudio_template_photo_prep_preload_cache_lookup_failed",
      workspaceId: input.workspaceId,
      templateKey: input.template.templateKey ?? input.template.id,
      error: error instanceof Error ? error.message : String(error),
    }));
    return {};
  }
}

export async function POST(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const body = await readJsonBody<TemplatePhotoPrepBody>(request);

  try {
    const firstAd = body.firstAd;
    if (!firstAd || firstAd.mode !== "template") {
      return NextResponse.json({ photoPrep: { status: "skipped", readyFormats: [], pendingFormats: [] } });
    }
    if (!isAdStudioImageSrc(firstAd.imageDataUrl)) {
      return NextResponse.json({ error: "An uploaded image is required." }, { status: 400 });
    }
    for (const slotImage of Object.values(firstAd.imageDataUrls ?? {})) {
      if (slotImage && !isAdStudioImageSrc(slotImage)) {
        return NextResponse.json({ error: "One of the selected template images is invalid." }, { status: 400 });
      }
    }
    if (!(firstAd.templateKey?.trim() || firstAd.templateId?.trim())) {
      return NextResponse.json({ error: "Selected template was not found." }, { status: 400 });
    }

    const resolvedTemplate = await resolveApprovedAdStudioTemplate({
      templateKey: firstAd.templateKey,
      templateId: firstAd.templateId,
    });

    if (!resolvedTemplate) {
      return NextResponse.json({ error: "Selected template was not found." }, { status: 400 });
    }

    const brandKitResult = await resolveAdStudioGenerationBrandKit({
      supabase: context.supabase,
      workspaceId: context.access.workspaceId,
      workspaceName: context.access.workspaceName,
      region: context.access.region,
      userId: context.access.userId,
      submittedBrandKit: body.brandKit,
      isTrialWorkspace: false,
    });
    const brandKit = brandKitResult.ok ? brandKitResult.brandKit : body.brandKit;

    if (!brandKit) {
      return NextResponse.json({ error: brandKitResult.ok ? "Brand kit is required." : brandKitResult.error }, { status: 400 });
    }

    const sourceImageUrl = await resolveAdStudioImageForModel(
      context.supabase,
      context.access.workspaceId,
      firstAd.imageDataUrl,
    );
    const sourceImageForModel = providerReadableSourceImage(request, firstAd.imageDataUrl, sourceImageUrl);
    const prepInput: TemplatePhotoPrepInput = {
      workspaceId: context.access.workspaceId,
      userId: context.access.userId,
      brandKit,
      template: resolvedTemplate,
      formats: firstAd.formats,
      sourceImageRef: firstAd.imageDataUrl,
      sourceImageForModel: sourceImageForModel ?? "",
      campaign: {
        goal: resolvedTemplate.goal,
        offerId: resolvedTemplate.offerId,
        market: {
          suburb: body.suburb ?? "Scarborough",
          city: body.city ?? "Perth",
          state: body.state ?? "WA",
        },
      },
      brief: firstAd.description,
    };
    const cachedAssets = await loadCachedTemplatePhotos(prepInput);
    const pendingFormats = firstAd.formats.filter((format) => !cachedAssets[format]);
    const queue = await queueAdStudioTemplatePhotoPrep(prepInput, pendingFormats);

    return NextResponse.json({
      photoPrep: responseForPhotoPrep({ cachedAssets, queue }),
      sourceImagesByFormat: preparedPhotoUrlsByFormat(cachedAssets),
    });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
