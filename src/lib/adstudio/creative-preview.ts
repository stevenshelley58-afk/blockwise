import type {
  AdStudioCreative,
  AdStudioLegacyCreative,
  AdStudioLegacyCanvas,
} from "./types.ts";
import { isAdDocInstanceShape, TEMPLATE_FORMAT_DIMENSIONS } from "./v2/template-doc.ts";

export function isLegacyCreative(creative: AdStudioCreative): creative is AdStudioLegacyCreative {
  return !isAdDocInstanceShape(creative.canvas);
}

export function legacyCanvas(
  creative: AdStudioCreative,
): AdStudioLegacyCanvas | null {
  return isLegacyCreative(creative) ? creative.canvas : null;
}

export function canvasDimensions(canvas: AdStudioCreative["canvas"]): { width: number; height: number } {
  if (isAdDocInstanceShape(canvas)) {
    return TEMPLATE_FORMAT_DIMENSIONS[canvas.format];
  }
  return { width: canvas.width, height: canvas.height };
}

export function creativeDimensions(
  creative: Pick<AdStudioCreative, "canvas">,
): { width: number; height: number } {
  return canvasDimensions(creative.canvas);
}

/** A reference-clone creative: a single flat image with copy baked into pixels. */
export function isCloneCreative(creative: AdStudioCreative): creative is AdStudioLegacyCreative {
  return (
    isLegacyCreative(creative) &&
    creative.canvas.objects.length === 1 &&
    creative.canvas.objects[0]?.objectId === "template_clone_image"
  );
}

/** The primary image source (URL / storage path / data URL) of a creative, if any. */
export function primaryImageSource(creative: AdStudioCreative | null | undefined): string | null {
  if (!creative) return null;
  if (isAdDocInstanceShape(creative.canvas)) {
    const path = creative.canvas.format === "9:16"
      ? creative.canvas.renders?.story
      : creative.canvas.renders?.feed;
    return path ? `/api/adstudio/media?path=${encodeURIComponent(path)}` : null;
  }
  const imageObject = creative?.canvas.objects.find((object) => object.role === "primary_image");
  const src = imageObject?.content || imageObject?.assetId;
  return src || null;
}

/** Best-effort preview image for a creative in library/grid contexts.
 *
 *  Clone creatives render from their flat primary image; template creatives fall
 *  back to their stored SVG preview (encoded to a data URL when needed).
 */
export function creativeLibraryPreview(creative: AdStudioCreative): string | null {
  if (isCloneCreative(creative)) return primaryImageSource(creative);
  if (!creative.previewSvg) return null;
  return creative.previewSvg.startsWith("data:image/")
    ? creative.previewSvg
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(creative.previewSvg)}`;
}
