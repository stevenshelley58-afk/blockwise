import type { AdStudioCreative } from "./types.ts";

/** A reference-clone creative: a single flat image with copy baked into pixels. */
export function isCloneCreative(creative: AdStudioCreative): boolean {
  return (
    creative.canvas.objects.length === 1 &&
    creative.canvas.objects[0]?.objectId === "template_clone_image"
  );
}

/** The primary image source (URL / storage path / data URL) of a creative, if any. */
export function primaryImageSource(creative: AdStudioCreative | null | undefined): string | null {
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
