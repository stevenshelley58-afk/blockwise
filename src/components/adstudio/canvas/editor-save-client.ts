// Client for the deterministic design-editor endpoints: editor-save (flattened
// scene → new revision, no AI) and prepare-editor (one-time clean-plate
// backfill for creatives generated before plates existed).

import type { AdStudioCloneRegion, AdStudioCreative } from "@/lib/adstudio/types.ts";

type EditorSaveResponse = {
  image?: string;
  qa?: AdStudioCreative["canvas"]["cloneQa"];
  renderHistory?: string[];
  renderQaHistory?: NonNullable<AdStudioCreative["canvas"]["cloneQa"]>[];
  redoHistory?: string[];
  redoQaHistory?: NonNullable<AdStudioCreative["canvas"]["cloneQa"]>[];
  cloneEdit?: AdStudioCreative["canvas"]["cloneEdit"];
  revisionId?: string;
  error?: string;
};

export async function requestEditorSave(input: {
  creative: AdStudioCreative;
  editorScene: Record<string, unknown>;
  flattenedImage: string;
  textByKey: Record<string, string>;
  regions: AdStudioCloneRegion[];
  mutationId: string;
}): Promise<AdStudioCreative> {
  const { creative } = input;
  if (!creative.activeRevisionId) throw new Error("This ad changed. Reload it before editing.");

  const cloneObject = creative.canvas.objects[0];
  const response = await fetch(`/api/adstudio/creatives/${creative.creativeId}/editor-save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      editorScene: input.editorScene,
      flattenedImage: input.flattenedImage,
      textByKey: input.textByKey,
      regions: input.regions,
      expectedRevisionId: creative.activeRevisionId,
      mutationId: input.mutationId,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as EditorSaveResponse;
  if (!response.ok || !data.image || !data.revisionId) {
    throw new Error(data.error || "The design could not be saved. Your previous version is unchanged.");
  }

  return {
    ...creative,
    activeRevisionId: data.revisionId,
    canvas: {
      ...creative.canvas,
      objects: [{ ...cloneObject, content: data.image, assetId: data.image }],
      cloneQa: data.qa ?? creative.canvas.cloneQa,
      renderHistory: data.renderHistory ?? creative.canvas.renderHistory,
      renderQaHistory: data.renderQaHistory ?? creative.canvas.renderQaHistory,
      redoHistory: data.redoHistory ?? creative.canvas.redoHistory,
      redoQaHistory: data.redoQaHistory ?? creative.canvas.redoQaHistory,
      cloneEdit: data.cloneEdit ?? creative.canvas.cloneEdit,
    },
  };
}

type PrepareEditorResponse = {
  cleanPlate?: string;
  revisionId?: string;
  error?: string;
};

export async function requestPrepareEditor(input: {
  creative: AdStudioCreative;
  mutationId: string;
}): Promise<AdStudioCreative> {
  const { creative } = input;
  if (!creative.activeRevisionId) throw new Error("This ad changed. Reload it before editing.");

  const response = await fetch(`/api/adstudio/creatives/${creative.creativeId}/prepare-editor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedRevisionId: creative.activeRevisionId,
      mutationId: input.mutationId,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as PrepareEditorResponse;
  if (!response.ok || !data.cleanPlate || !data.revisionId) {
    throw new Error(data.error || "The design editor could not be prepared. Try again shortly.");
  }

  return {
    ...creative,
    activeRevisionId: data.revisionId,
    canvas: {
      ...creative.canvas,
      cloneEdit: { ...(creative.canvas.cloneEdit ?? { version: 1 as const }), cleanPlate: data.cleanPlate },
    },
  };
}
