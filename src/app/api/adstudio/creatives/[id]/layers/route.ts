import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  createRegionEditMaskForDimensions,
  generateCloneWithCascade,
  persistCloneRender,
  resolveCloneProviders,
} from "@/lib/adstudio/clone-generation";
import { dataUrlToUploadBytes } from "@/lib/adstudio/generated-media";
import { errorResponse, requireAdStudioRequest } from "@/lib/adstudio/http";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import {
  buildPlateInpaintRequest,
  derivePlateFromInpaint,
  detectTextLayerStyles,
  textRegionsOf,
} from "@/lib/adstudio/text-layers";
import type { AdStudioCreative, AdStudioTextLayers } from "@/lib/adstudio/types";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

async function imageDimensions(assetUrl: string): Promise<{ width: number; height: number } | null> {
  let bytes: Uint8Array;
  if (assetUrl.startsWith("data:image/")) {
    bytes = dataUrlToUploadBytes(assetUrl).bytes;
  } else {
    const response = await fetch(assetUrl);
    if (!response.ok) return null;
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height) return null;
  return { width: metadata.width, height: metadata.height };
}

/**
 * Build (or return) the creative's text-editing layers: a text-free background
 * plate plus per-region type treatments. Runs in the background from the
 * editor; while it runs, edits keep working through the model path.
 */
export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { id } = await Promise.resolve(routeContext.params);
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  const rateLimit = await checkRateLimit(context.supabase, context.access.workspaceId, context.access.userId, {
    windowSeconds: 3600,
    maxRequests: 20,
    bucket: "ai-layer-decompose",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const { data: row, error: loadError } = await context.supabase
    .from("adstudio_creatives")
    .select("id, format, canvas_json, active_revision_id")
    .eq("workspace_id", context.access.workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Creative not found." }, { status: 404 });

  const canvas = row.canvas_json as AdStudioCreative["canvas"];
  const cloneObject = canvas?.objects?.[0];
  const isClone = canvas?.objects?.length === 1 && cloneObject?.objectId === "template_clone_image";
  if (!isClone) {
    return NextResponse.json({ error: "Layers are only available for AI-designed creatives." }, { status: 400 });
  }

  const currentImageRef = cloneObject.content || cloneObject.assetId || "";
  const existing = canvas.textLayers;
  if (existing?.status === "ready" && existing.validFor.includes(currentImageRef)) {
    return NextResponse.json({ creativeId: id, textLayers: existing });
  }

  const textRegions = textRegionsOf(canvas.cloneQa?.regions);
  if (textRegions.length === 0) {
    return NextResponse.json({ error: "This creative has no editable text regions yet." }, { status: 409 });
  }

  const correlationId = randomUUID();
  const currentImage = await resolveAdStudioImageForModel(context.supabase, context.access.workspaceId, currentImageRef);
  if (!currentImage) {
    return NextResponse.json({ error: "The current creative image could not be read." }, { status: 400 });
  }
  const dimensions = await imageDimensions(currentImage);
  if (!dimensions) {
    return NextResponse.json({ error: "The current creative image could not be read." }, { status: 400 });
  }

  const textBoxes = textRegions.map((region) => region.box);
  try {
    const maskImage = await createRegionEditMaskForDimensions(dimensions, textBoxes);
    const providers = (await resolveCloneProviders()).sort(
      (left, right) => Number(Boolean(right.capabilities.inpainting)) - Number(Boolean(left.capabilities.inpainting)),
    );

    // The inpaint and the style read are independent — run them together.
    const [generated, styles] = await Promise.all([
      generateCloneWithCascade({
        providers,
        request: { ...buildPlateInpaintRequest({ currentImage, aspectRatio: String(row.format ?? "4:5") }), maskImage },
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId,
        attempt: 1,
      }),
      detectTextLayerStyles({
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId,
        imageUrl: currentImage,
        regionKeys: textRegions.map((region) => region.key),
      }),
    ]);

    const plateDataUrl = await derivePlateFromInpaint(currentImage, generated.assetUrl, textBoxes);
    const platePath = await persistCloneRender({
      supabase: context.supabase,
      workspaceId: context.access.workspaceId,
      assetUrl: plateDataUrl,
      fileNameSeed: `${correlationId}-plate`,
    });

    const textLayers: AdStudioTextLayers = {
      status: "ready",
      builtAt: new Date().toISOString(),
      plate: platePath,
      styles,
      validFor: [currentImageRef],
      model: generated.model,
    };

    // Advisory write, same shape as enrichCloneCreativesWithRegions: never
    // clobber a render that changed while the plate was building.
    const { data: updated, error: updateError } = await context.supabase
      .from("adstudio_creatives")
      .update({ canvas_json: { ...canvas, textLayers }, updated_at: new Date().toISOString() })
      .eq("workspace_id", context.access.workspaceId)
      .eq("id", id)
      .eq("active_revision_id", row.active_revision_id)
      .select("id");
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { code: "stale_revision", error: "This ad changed while its layers were building." },
        { status: 409 },
      );
    }

    return NextResponse.json({ creativeId: id, textLayers });
  } catch (error) {
    return errorResponse(error, 502);
  }
}
