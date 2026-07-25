import type { AdStudioCreative } from "@/lib/adstudio/types.ts";

type CreativeEditResponse = {
  image?: string;
  /** Data: URL preview for instant display — avoids a second round trip
   * through the auth-gated media proxy. The canonical `image` path is still
   * used for persistence/reload. */
  previewDataUrl?: string;
  qa?: AdStudioCreative["canvas"]["cloneQa"];
  renderHistory?: string[];
  renderQaHistory?: NonNullable<AdStudioCreative["canvas"]["cloneQa"]>[];
  redoHistory?: string[];
  redoQaHistory?: NonNullable<AdStudioCreative["canvas"]["cloneQa"]>[];
  revisionId?: string;
  error?: string;
};

export type CreativeEditMutation = {
  action?: "edit" | "undo" | "redo";
  fieldKey?: string;
  newValue?: string;
  newImage?: string;
  instruction?: string;
};

export async function requestCreativeEdit(input: {
  creative: AdStudioCreative;
  mutation: CreativeEditMutation;
  mutationId: string;
}): Promise<AdStudioCreative> {
  const { creative, mutation, mutationId } = input;
  if (!creative.activeRevisionId) throw new Error("This ad changed. Reload it before editing.");

  const cloneObject = creative.canvas.objects[0];
  const response = await fetch(`/api/adstudio/creatives/${creative.creativeId}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...mutation,
      expectedRevisionId: creative.activeRevisionId,
      mutationId,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as CreativeEditResponse;
  if (!response.ok || !data.image || !data.revisionId) {
    throw new Error(data.error || "The edit did not pass the ad checks. Your previous version is unchanged.");
  }

  return {
    ...creative,
    activeRevisionId: data.revisionId,
    canvas: {
      ...creative.canvas,
      // Use the data: URL for immediate pixel display; the canonical storage
      // path is still set as content/assetId for reload/export/persistence.
      // The browser paints the data URL instantly without a second fetch
      // through the /api/adstudio/media auth proxy.
      objects: [{ ...cloneObject, content: data.previewDataUrl ?? data.image, assetId: data.image }],
      cloneQa: data.qa ?? creative.canvas.cloneQa,
      renderHistory: data.renderHistory ?? creative.canvas.renderHistory,
      renderQaHistory: data.renderQaHistory ?? creative.canvas.renderQaHistory,
      redoHistory: data.redoHistory ?? creative.canvas.redoHistory,
      redoQaHistory: data.redoQaHistory ?? creative.canvas.redoQaHistory,
    },
  };
}
