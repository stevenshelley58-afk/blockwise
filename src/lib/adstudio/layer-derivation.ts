import {
  createRegionEditMaskForDimensions,
  generateCloneWithCascade,
  persistCloneRender,
  resolveCloneProviders,
} from "./clone-generation.ts";
import { dataUrlToUploadBytes } from "./generated-media.ts";
import {
  buildPlateInpaintRequest,
  buildTemplateTextLayerStyles,
  derivePlateFromInpaint,
  textRegionsOf,
} from "./text-layers.ts";
import { buildingTextLayers } from "./text-layer-state.ts";
import { resolveAdStudioImageForModel } from "./resolve-image-for-model.ts";
import { isAdDocInstanceShape } from "./v2/template-doc.ts";
import type { AdStudioTemplate } from "./templates.ts";
import type { AdStudioCreative, AdStudioLegacyCanvas, AdStudioTextLayers } from "./types.ts";
import type { createSupabaseServerClient } from "../supabase/server.ts";

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

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
  return metadata.width && metadata.height ? { width: metadata.width, height: metadata.height } : null;
}
/**
 * Builds and stores the plate for high-confidence text regions after the
 * canonical finished clone exists. Partial templates treat it as advisory;
 * explicitly ready templates wait for it before release. A compare-and-swap
 * prevents stale work from winning.
 */
export async function deriveAndPersistTemplateTextLayers(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  userId: string;
  correlationId: string;
  creativeId: string;
  activeRevisionId: string | null;
  format: string;
  canvas: AdStudioCreative["canvas"];
  currentImageRef: string;
  currentImageUrl?: string;
  template: AdStudioTemplate;
}): Promise<AdStudioTextLayers | null> {
  if (isAdDocInstanceShape(input.canvas)) {
    throw new Error("Deterministic v2 documents do not support legacy clone text-layer derivation.");
  }
  try {
    return await deriveTemplateTextLayers(input as Omit<typeof input, "canvas"> & { canvas: AdStudioLegacyCanvas });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Plate construction failed.";
    return persistLayerFailure(input as Omit<typeof input, "canvas"> & { canvas: AdStudioLegacyCanvas }, message);
  }
}

async function deriveTemplateTextLayers(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  userId: string;
  correlationId: string;
  creativeId: string;
  activeRevisionId: string | null;
  format: string;
  canvas: AdStudioLegacyCanvas;
  currentImageRef: string;
  currentImageUrl?: string;
  template: AdStudioTemplate;
}): Promise<AdStudioTextLayers | null> {
  const existing = input.canvas.textLayers;
  if (existing?.status === "ready" && existing.validFor.includes(input.currentImageRef)) {
    return existing;
  }
  const regions = textRegionsOf(input.canvas.cloneQa?.regions);
  const styles = buildTemplateTextLayerStyles(input.template, regions);
  const liveRegions = regions.filter((region) => styles[region.key]?.mode === "live");
  if (liveRegions.length === 0) {
    return persistLayerFailure(input, "This template has no deterministic text regions for this render.");
  }

  const currentImage = input.currentImageUrl
    ?? await resolveAdStudioImageForModel(input.supabase, input.workspaceId, input.currentImageRef);
  if (!currentImage) return persistLayerFailure(input, "The finished render could not be loaded for plate construction.");
  const dimensions = await imageDimensions(currentImage);
  if (!dimensions) return persistLayerFailure(input, "The finished render dimensions could not be read.");

  const textBoxes = liveRegions.map((region) => region.box);
  const maskImage = await createRegionEditMaskForDimensions(dimensions, textBoxes);
  // A plate is a masked utility render, not a second customer-facing ad.
  // Use the same fast inpainting profile as targeted region edits. The
  // previous default silently selected the final-quality provider, which
  // took roughly 140-150 seconds per plate in production.
  const providers = (await resolveCloneProviders("fast")).sort(
    (left, right) => Number(Boolean(right.capabilities.inpainting)) - Number(Boolean(left.capabilities.inpainting)),
  );
  const generated = await generateCloneWithCascade({
    providers,
    request: {
      ...buildPlateInpaintRequest({ currentImage, aspectRatio: input.format }),
      maskImage,
    },
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId: input.correlationId,
    attempt: 1,
    modelProfile: "image_draft",
  });
  const plateDataUrl = await derivePlateFromInpaint(currentImage, generated.assetUrl, textBoxes);
  const platePath = await persistCloneRender({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    assetUrl: plateDataUrl,
    fileNameSeed: `${input.correlationId}-${input.creativeId}-plate`,
  });
  const textLayers: AdStudioTextLayers = {
    status: "ready",
    builtAt: new Date().toISOString(),
    derivedFrom: input.currentImageRef,
    deterministicOnly: input.canvas.textLayers?.deterministicOnly ?? false,
    plate: platePath,
    styles,
    validFor: [input.currentImageRef],
    model: generated.model,
  };

  let query = input.supabase
    .from("adstudio_creatives")
    .update({
      canvas_json: { ...input.canvas, textLayers },
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.creativeId);
  query = input.activeRevisionId
    ? query.eq("active_revision_id", input.activeRevisionId)
    : query.is("active_revision_id", null);
  const { data, error } = await query.select("id");
  if (error || !data?.length) return null;
  return textLayers;
}

async function persistLayerFailure(
  input: Parameters<typeof deriveTemplateTextLayers>[0],
  error: string,
): Promise<AdStudioTextLayers | null> {
  const failed: AdStudioTextLayers = {
    ...buildingTextLayers(
      input.currentImageRef,
      input.canvas.textLayers?.deterministicOnly ?? false,
    ),
    status: "failed",
    error,
  };
  let query = input.supabase
    .from("adstudio_creatives")
    .update({
      canvas_json: { ...input.canvas, textLayers: failed },
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.creativeId);
  query = input.activeRevisionId
    ? query.eq("active_revision_id", input.activeRevisionId)
    : query.is("active_revision_id", null);
  const { data, error: persistError } = await query.select("id");
  return persistError || !data?.length ? null : failed;
}
