import { isLegacyCreative } from "./creative-preview.ts";
import type { AdStudioCreative, AdStudioLegacyCreative } from "./types.ts";

export function isFinishedCloneCreative(
  creative: AdStudioCreative | null | undefined,
): creative is AdStudioLegacyCreative {
  return Boolean(
    creative
      && isLegacyCreative(creative)
      && creative.canvas.objects.length === 1
      && creative.canvas.objects[0]?.objectId === "template_clone_image"
      && (creative.canvas.objects[0].content || creative.canvas.objects[0].assetId),
  );
}

export function cloneImageSource(creative: AdStudioCreative): string {
  if (!isLegacyCreative(creative)) {
    throw new Error("V2 document creatives do not have a legacy clone image source.");
  }
  const image = creative.canvas.objects[0];
  return image?.content || image?.assetId || "";
}
