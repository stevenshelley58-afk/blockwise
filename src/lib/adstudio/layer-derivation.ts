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
import { resolveAdStudioImageForModel } from "./resolve-image-for-model.ts";
import type { AdStudioTemplate } from "./templates.ts";
import type { AdStudioCreative, AdStudioTextLayers } from "./types.ts";
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
 * Builds and stores the advisory plate for high-confidence text regions.
 * This runs after the finished clone exists; it never delays or modifies the
 * canonical ad render. A compare-and-swap prevents stale work from winning.
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
  const regions = textRegionsOf(input.canvas.cloneQa?.regions);
  const styles = buildTemplateTextLayerStyles(input.template, regions);
  const liveRegions = regions.filter((region) => styles[region.key]?.mode === "live");
  if (liveRegions.length === 0) return null;

  const currentImage = input.currentImageUrl
    ?? await resolveAdStudioImageForModel(input.supabase, input.workspaceId, input.currentImageRef);
  if (!currentImage) return null;
  const dimensions = await imageDimensions(currentImage);
  if (!dimensions) return null;

  const textBoxes = liveRegions.map((region) => region.box);
  const maskImage = await createRegionEditMaskForDimensions(dimensions, textBoxes);
  const providers = (await resolveCloneProviders()).sort(
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
