import type { AdStudioCreative } from "./types.ts";

export function isFinishedCloneCreative(
  creative: AdStudioCreative | null | undefined,
): creative is AdStudioCreative {
  return Boolean(
    creative
      && creative.canvas.objects.length === 1
      && creative.canvas.objects[0]?.objectId === "template_clone_image"
      && (creative.canvas.objects[0].content || creative.canvas.objects[0].assetId),
  );
}

export function cloneImageSource(creative: AdStudioCreative): string {
  const image = creative.canvas.objects[0];
  return image?.content || image?.assetId || "";
}
