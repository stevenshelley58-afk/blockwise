import type {
  AdStudioLegacyCanvas,
  AdStudioLegacyCreative,
  AdStudioTextLayers,
} from "@/lib/adstudio/types.ts";

type CreativeEditResponse = {
  image?: string;
  /** Finished pixels inline — painted immediately, no media-proxy round trip. */
  previewImage?: string;
  qa?: AdStudioLegacyCanvas["cloneQa"];
  textLayers?: AdStudioTextLayers | null;
  renderHistory?: string[];
  renderQaHistory?: NonNullable<AdStudioLegacyCanvas["cloneQa"]>[];
  redoHistory?: string[];
  redoQaHistory?: NonNullable<AdStudioLegacyCanvas["cloneQa"]>[];
  revisionId?: string;
  code?: string;
  error?: string;
};

export type CreativeEditMutation = {
  action?: "edit" | "undo" | "redo";
  fieldKey?: string;
  newValue?: string;
  newImage?: string;
  instruction?: string;
  /** Client-rendered deterministic text patch (data URL) for the region. */
  patchImage?: string;
};

export class CreativeEditError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "CreativeEditError";
    this.code = code;
  }
}

export type CreativeEditResult = {
  creative: AdStudioLegacyCreative;
  /** Data URL of the finished render when the server inlined it. */
  previewImage?: string;
};

export async function requestCreativeEdit(input: {
  creative: AdStudioLegacyCreative;
  mutation: CreativeEditMutation;
  mutationId: string;
}): Promise<CreativeEditResult> {
  const { creative, mutation, mutationId } = input;
  if (!creative.activeRevisionId) throw new CreativeEditError("This ad changed. Reload it before editing.");

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
    throw new CreativeEditError(
      data.error || "The edit did not pass the ad checks. Your previous version is unchanged.",
      data.code,
    );
  }

  return {
    creative: {
      ...creative,
      activeRevisionId: data.revisionId,
      canvas: {
        ...creative.canvas,
        objects: [{ ...cloneObject, content: data.image, assetId: data.image }],
        cloneQa: data.qa ?? creative.canvas.cloneQa,
        textLayers: data.textLayers === null ? undefined : data.textLayers ?? creative.canvas.textLayers,
        renderHistory: data.renderHistory ?? creative.canvas.renderHistory,
        renderQaHistory: data.renderQaHistory ?? creative.canvas.renderQaHistory,
        redoHistory: data.redoHistory ?? creative.canvas.redoHistory,
        redoQaHistory: data.redoQaHistory ?? creative.canvas.redoQaHistory,
      },
    },
    previewImage: data.previewImage,
  };
}

type CreativeLayersResponse = {
  textLayers?: AdStudioTextLayers;
  error?: string;
};

/**
 * Ask the server to build (or return) the creative's text-editing layers.
 * Returns the persisted state, including `building`, so editor tabs converge
 * on one durable background build instead of starting their own.
 */
export async function requestCreativeLayers(creativeId: string): Promise<AdStudioTextLayers | null> {
  try {
    const response = await fetch(`/api/adstudio/creatives/${creativeId}/layers`, { method: "POST" });
    const data = (await response.json().catch(() => ({}))) as CreativeLayersResponse;
    if ((!response.ok && response.status !== 202) || !data.textLayers) return null;
    return data.textLayers;
  } catch {
    return null;
  }
}
