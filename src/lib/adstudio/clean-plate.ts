// Clean-plate production for the embedded design editor.
//
// A finished clone is one flat image with the copy baked into the pixels, so
// no design editor can retype it. This module runs ONE inpaint pass per
// creative at generation (or first-open backfill) time: every QA-detected text
// region is masked out and the image model reconstructs the background behind
// it. The editor then draws real text layers over the plate, which makes text
// edits instant and deterministic — the AI is never in the text-edit loop again.

import {
  cloneModelProfileForQuality,
  compositeCloneRegionsEdit,
  createCloneRegionsEditMask,
  generateCloneWithCascade,
  normalizeCloneRenderAspect,
  persistCloneRender,
  resolveCloneProviders,
  type AdGenerationQuality,
  type CloneEditRegionBox,
} from "./clone-generation.ts";
import { buildCleanPlateRequest } from "./reference-clone.ts";
import type { AdStudioCloneRegion } from "./types.ts";

type PersistCloneRenderSupabase = Parameters<typeof persistCloneRender>[0]["supabase"];

export type GenerateCleanPlateInput = {
  supabase: PersistCloneRenderSupabase;
  workspaceId: string;
  userId: string;
  correlationId: string;
  /** Aspect-ratio format string, e.g. "4:5" or "9:16". */
  format: string;
  /** The finished, model-readable clone render (data URL or absolute URL). */
  renderImage: string;
  /** QA regions for the render; only text regions are cleared. */
  regions: AdStudioCloneRegion[];
  quality?: AdGenerationQuality;
  /** Storage seed; must be unique per creative+format. */
  fileNameSeed: string;
};

/** Storage seed for a creative's plate; unique per correlation+format. */
export function cleanPlateFileNameSeed(correlationId: string, format: string): string {
  return `${correlationId}-plate-${format.replace(":", "x")}`;
}

export function cleanPlateTextBoxes(regions: AdStudioCloneRegion[]): CloneEditRegionBox[] {
  return regions
    .filter((region) => region.kind === "text")
    .map((region) => region.box)
    .filter((box) => box.width > 0 && box.height > 0);
}

/**
 * Generate and persist a text-free clean plate for one finished clone render.
 * Returns the stored media path, or null when no plate could be produced —
 * a null plate is non-fatal: the creative simply keeps the in-place editor.
 */
export async function generateCleanPlate(input: GenerateCleanPlateInput): Promise<string | null> {
  const textBoxes = cleanPlateTextBoxes(input.regions);
  if (textBoxes.length === 0) return null;

  try {
    const quality = input.quality ?? "fast";
    const providers = (await resolveCloneProviders(quality)).sort(
      (left, right) => Number(Boolean(right.capabilities.inpainting)) - Number(Boolean(left.capabilities.inpainting)),
    );
    const request = buildCleanPlateRequest({
      currentImage: input.renderImage,
      aspectRatio: input.format,
      seed: 1,
    });
    request.maskImage = await createCloneRegionsEditMask(input.renderImage, textBoxes);

    const generated = await generateCloneWithCascade({
      providers,
      request,
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId: input.correlationId,
      attempt: 1,
      modelProfile: cloneModelProfileForQuality(quality),
    });
    const exact = await normalizeCloneRenderAspect(generated.assetUrl, input.format);
    // Pixels outside the text regions always come from the finished ad, even
    // if the model redraws them — plate damage is bounded to the text boxes.
    const bounded = await compositeCloneRegionsEdit(input.renderImage, exact, textBoxes);
    return await persistCloneRender({
      supabase: input.supabase,
      workspaceId: input.workspaceId,
      assetUrl: bounded,
      fileNameSeed: input.fileNameSeed,
    });
  } catch {
    // Plate production is best-effort by contract; the caller falls back to
    // the in-place editor when no plate exists.
    return null;
  }
}
