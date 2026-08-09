import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  createCloneRegionEditMask,
  generateCloneWithCascade,
  persistCloneRender,
  resolveCloneProviders,
} from "@/lib/adstudio/clone-generation";
import { compositeRegionBack, cropRegionWithPadding, rebaseBoxToCrop } from "@/lib/adstudio/region-edit";
import {
  appendAdStudioCreativeRevision,
  executeAdStudioCreativeRevisionMutation,
  releaseAdStudioCreativeRevisionMutation,
} from "@/lib/adstudio/creative-revisions";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { buildTargetedEditRequest } from "@/lib/adstudio/reference-clone";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import {
  boxIntersectsTextRegions,
  compositeTextPatch,
  extendTextLayersValidity,
  MAX_TEXT_PATCH_BYTES,
} from "@/lib/adstudio/text-layers";
import { normalizeCloneQa, type AdStudioCloneQa, type AdStudioCreative, type AdStudioTextLayers } from "@/lib/adstudio/types";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type TargetedEditBody = {
  action?: "edit" | "undo" | "redo";
  /** Copy-field key (text edit) or image-slot role (image edit) to change. */
  fieldKey?: string;
  /** The exact new text for a text edit. */
  newValue?: string;
  /** Replacement image (media path or data URL) for an image edit. */
  newImage?: string;
  /** Natural-language direction applied only inside the selected region. */
  instruction?: string;
  /**
   * Client-rendered text patch (data URL) for the selected region — the
   * browser re-typesets the exact copy over the plate crop with real fonts
   * (serverless sharp has no fontconfig). When present and the creative's
   * layers are valid, the edit composites deterministically with no
   * image-model round trip.
   */
  patchImage?: string;
  expectedRevisionId?: string;
  mutationId?: string;
};

// Every saved edit is a final-quality render, never a disposable preview.
const RENDER_HISTORY_LIMIT = 10;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// base64 inflates bytes ~4/3; this bounds the decoded patch near MAX_TEXT_PATCH_BYTES.
const MAX_TEXT_PATCH_DATAURL_LENGTH = Math.ceil((MAX_TEXT_PATCH_BYTES * 4) / 3) + 64;

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { id } = await Promise.resolve(routeContext.params);
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  const body = await readJsonBody<TargetedEditBody>(request);
  const action = body.action ?? "edit";
  const fieldKey = body.fieldKey?.trim();
  const newValue = body.newValue?.trim() ?? "";
  const newImageRef = body.newImage?.trim();
  const instruction = body.instruction?.trim() ?? "";
  const patchImage = body.patchImage?.trim() || undefined;
  const expectedRevisionId = body.expectedRevisionId?.trim() ?? "";
  const mutationId = body.mutationId?.trim() ?? "";

  // History restores and deterministic patch composites never call an image
  // model, so they draw on a far cheaper budget than model-backed edits.
  const usesImageModel = action === "edit" && !patchImage;
  const rateLimit = await checkRateLimit(context.supabase, context.access.workspaceId, context.access.userId, {
    windowSeconds: 3600,
    maxRequests: usesImageModel ? 30 : 120,
    bucket: usesImageModel ? "ai-clone-edit" : "clone-edit-composite",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  if (!(action === "edit" || action === "undo" || action === "redo")) {
    return NextResponse.json({ error: "Unsupported edit action." }, { status: 400 });
  }
  if (action === "edit" && !fieldKey) {
    return NextResponse.json({ error: "fieldKey is required." }, { status: 400 });
  }
  if (action === "edit" && !newValue && !newImageRef && !instruction) {
    return NextResponse.json(
      { error: "Provide new text, a replacement image, or an edit instruction." },
      { status: 400 },
    );
  }
  if (newValue.length > 200) {
    return NextResponse.json({ error: "Keep the new text to 200 characters or less." }, { status: 400 });
  }
  if (instruction.length > 500) {
    return NextResponse.json({ error: "Keep the edit direction to 500 characters or less." }, { status: 400 });
  }
  if (patchImage && (!patchImage.startsWith("data:image/") || patchImage.length > MAX_TEXT_PATCH_DATAURL_LENGTH)) {
    return NextResponse.json({ error: "The rendered text patch could not be read." }, { status: 400 });
  }
  if (patchImage && !newValue) {
    return NextResponse.json({ error: "A text patch needs its exact replacement text." }, { status: 400 });
  }
  if (!UUID_PATTERN.test(expectedRevisionId) || !UUID_PATTERN.test(mutationId)) {
    return NextResponse.json({ error: "Reload the ad before editing it." }, { status: 400 });
  }
  const requestHash = createHash("sha256")
    .update(JSON.stringify({
      workspaceId: context.access.workspaceId,
      creativeId: id,
      baseRevisionId: expectedRevisionId,
      action,
      fieldKey,
      newValue: newValue || null,
      newImage: newImageRef || null,
      instruction: instruction || null,
      patchImage: patchImage ? createHash("sha256").update(patchImage).digest("hex") : null,
    }))
    .digest("hex");

  const releaseClaim = () => releaseAdStudioCreativeRevisionMutation(context.supabase, {
    workspaceId: context.access.workspaceId,
    creativeId: id,
    mutationId,
  }).catch(() => undefined);

  let execution;
  try {
    execution = await executeAdStudioCreativeRevisionMutation(context.supabase, {
      workspaceId: context.access.workspaceId,
      creativeId: id,
      expectedActiveRevisionId: expectedRevisionId,
      mutationId,
      requestHash,
    }, async () => {

  const { data: row, error: loadError } = await context.supabase
    .from("adstudio_creatives")
    .select("id, campaign_id, variant_id, format, canvas_json, active_revision_id")
    .eq("workspace_id", context.access.workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (loadError) {
    await releaseClaim();
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!row) {
    await releaseClaim();
    return NextResponse.json({ error: "Creative not found." }, { status: 404 });
  }

  const baseRevisionId = typeof row.active_revision_id === "string" ? row.active_revision_id : "";
  if (!baseRevisionId || baseRevisionId !== expectedRevisionId) {
    await releaseClaim();
    return NextResponse.json(
      { code: "stale_revision", error: "This ad changed while you were editing. Reload and try again." },
      { status: 409 },
    );
  }

  const canvas = row.canvas_json as AdStudioCreative["canvas"];
  const cloneObject = canvas?.objects?.[0];
  const isClone = canvas?.objects?.length === 1 && cloneObject?.objectId === "template_clone_image";
  if (!isClone) {
    await releaseClaim();
    return NextResponse.json(
      { error: "In-place edits are only available for AI-designed creatives." },
      { status: 400 },
    );
  }
  if (action === "undo" || action === "redo") {
    const sourceHistory = action === "undo" ? canvas.renderHistory ?? [] : canvas.redoHistory ?? [];
    const sourceQaHistory = action === "undo" ? canvas.renderQaHistory ?? [] : canvas.redoQaHistory ?? [];
    const targetImageRef = sourceHistory.at(-1);
    const targetQa = sourceQaHistory.at(-1);
    if (!targetImageRef) {
      await releaseClaim();
      return NextResponse.json(
        { error: action === "undo" ? "There is nothing left to undo." : "There is nothing to redo." },
        { status: 409 },
      );
    }
    const currentImageRef = cloneObject.content || cloneObject.assetId || "";
    // Undo/redo restores a version the customer already had, with the editor
    // map (regions + text values) saved alongside it — no vision round-trip,
    // so restores are instant. A version saved before region detection landed
    // restores with the current map carried forward.
    const restoredQa: AdStudioCloneQa | undefined = targetQa ?? canvas.cloneQa;
    // The plate only survives a restore when it is known-valid for the
    // restored render; otherwise it drops and rebuilds in the background.
    const restoredLayers: AdStudioTextLayers | undefined =
      canvas.textLayers?.status === "ready" && canvas.textLayers.validFor.includes(targetImageRef)
        ? canvas.textLayers
        : undefined;
    const nextCanvas: AdStudioCreative["canvas"] = {
      ...canvas,
      objects: [{ ...cloneObject, content: targetImageRef, assetId: targetImageRef }],
      cloneQa: restoredQa,
      textLayers: restoredLayers,
      renderHistory: action === "undo"
        ? sourceHistory.slice(0, -1)
        : [...(canvas.renderHistory ?? []), currentImageRef].filter(Boolean).slice(-RENDER_HISTORY_LIMIT),
      renderQaHistory: action === "undo"
        ? sourceQaHistory.slice(0, -1)
        : [...(canvas.renderQaHistory ?? []), ...(canvas.cloneQa ? [canvas.cloneQa] : [])].slice(-RENDER_HISTORY_LIMIT),
      redoHistory: action === "undo"
        ? [...(canvas.redoHistory ?? []), currentImageRef].filter(Boolean).slice(-RENDER_HISTORY_LIMIT)
        : sourceHistory.slice(0, -1),
      redoQaHistory: action === "undo"
        ? [...(canvas.redoQaHistory ?? []), ...(canvas.cloneQa ? [canvas.cloneQa] : [])].slice(-RENDER_HISTORY_LIMIT)
        : sourceQaHistory.slice(0, -1),
    };
    const revision = await appendAdStudioCreativeRevision(context.supabase, {
      workspaceId: context.access.workspaceId,
      creativeId: id,
      expectedActiveRevisionId: expectedRevisionId,
      canvas: nextCanvas,
      renderStatus: "rendered",
      creationOperation: "targeted_edit",
      mutationId,
      requestHash,
    });
    if (!revision.ok) {
      await releaseClaim();
      return NextResponse.json(
        { code: "stale_revision", error: "This ad changed while the version was being restored. Reload and try again." },
        { status: 409 },
      );
    }
    return NextResponse.json({
      creativeId: id,
      image: targetImageRef,
      qa: restoredQa,
      textLayers: restoredLayers ?? null,
      renderHistory: nextCanvas.renderHistory,
      renderQaHistory: nextCanvas.renderQaHistory,
      redoHistory: nextCanvas.redoHistory,
      redoQaHistory: nextCanvas.redoQaHistory,
      revisionId: revision.revisionId,
      revisionNumber: revision.revisionNumber,
    });
  }

  // The edit-only validation above guarantees this after history actions return.
  const editFieldKey = fieldKey!;

  const currentImageRef = cloneObject.content || cloneObject.assetId || "";

  // Parallelize the three independent async setup steps that used to run
  // serially: fetch the current image, fetch the replacement image (if any),
  // and resolve the provider cascade. This saves ~1-3s per edit.
  // Region edits use the fast (draft) profile: an edit repaints a small masked
  // crop, sits behind undo/compare/history, and draft-class image models are
  // several times faster. The runtime model-profile table can re-pin models
  // without code changes if quality regresses.
  const [currentImage, newImage, providers] = await Promise.all([
    resolveAdStudioImageForModel(context.supabase, context.access.workspaceId, currentImageRef),
    newImageRef
      ? resolveAdStudioImageForModel(context.supabase, context.access.workspaceId, newImageRef)
      : Promise.resolve(undefined),
    resolveCloneProviders("fast"),
  ]);
  if (!currentImage) {
    await releaseClaim();
    return NextResponse.json({ error: "The current creative image could not be read." }, { status: 400 });
  }
  if (newImageRef && !newImage) {
    await releaseClaim();
    return NextResponse.json({ error: "The replacement image could not be read." }, { status: 400 });
  }

  // Expected copy carries the current value of every text field, with the
  // edited field overridden — sent to the image model so unedited text is not
  // drifted while it repaints the selected region.
  const currentQa = normalizeCloneQa(canvas.cloneQa);
  const expectedCopy: Record<string, string> = { ...(currentQa?.copyValues ?? {}) };
  if (newValue) expectedCopy[editFieldKey] = newValue;

  const selectedRegion = currentQa?.regions.find((region) => region.key === editFieldKey);
  if (!selectedRegion) {
    await releaseClaim();
    return NextResponse.json({ error: "That editable area is no longer available. Reload the ad." }, { status: 409 });
  }
  if (selectedRegion.kind === "text" && !newValue) {
    await releaseClaim();
    return NextResponse.json({ error: "Type the exact replacement text for this area." }, { status: 400 });
  }
  if (selectedRegion.kind === "image" && newValue) {
    await releaseClaim();
    return NextResponse.json({ error: "Use an image instruction or replacement image for this area." }, { status: 400 });
  }
  if (patchImage && selectedRegion.kind !== "text") {
    await releaseClaim();
    return NextResponse.json({ error: "Text patches only apply to text areas." }, { status: 400 });
  }
  const correlationId = mutationId;

  const layers = canvas.textLayers;
  const layersValidForCurrent = layers?.status === "ready" && layers.validFor.includes(currentImageRef);
  const textStyle = layers?.styles[editFieldKey];
  if (newValue && newValue.length > (textStyle?.maxLength ?? 200)) {
    await releaseClaim();
    return NextResponse.json(
      { error: `Keep the new text to ${textStyle?.maxLength ?? 200} characters or less.` },
      { status: 400 },
    );
  }
  if (selectedRegion.kind === "text" && layers?.deterministicOnly && !patchImage) {
    await releaseClaim();
    return NextResponse.json(
      {
        code: "layers_not_ready",
        error: "This text area is still preparing. Wait a moment, then apply the edit again.",
      },
      { status: 409 },
    );
  }

  // A text edit's new value IS the verified value — the copy editor map
  // updates deterministically either way, whether the pixels came from the
  // patch path below or the image model. There is nothing to re-verify: the
  // string the customer typed is, by construction, what is now on the ad.
  const nextQa: AdStudioCloneQa | null = currentQa
    ? {
      ...currentQa,
      copyValues: selectedRegion.kind === "text" && newValue
        ? { ...currentQa.copyValues, [editFieldKey]: newValue }
        : currentQa.copyValues,
    }
    : null;

  let qa: AdStudioCloneQa | null = null;
  let lastImage: { assetUrl: string; model: string; provider: string };
  if (patchImage) {
    // Deterministic fast path: the browser already re-typeset the exact copy
    // over the plate crop; the server only clamps it to the selected region
    // and composites — a patch can never touch pixels a model edit couldn't.
    if (!layers || !layersValidForCurrent || textStyle?.mode !== "live" || !textStyle.fontFile) {
      await releaseClaim();
      return NextResponse.json(
        { code: "layers_stale", error: "Instant editing is not ready for this version yet." },
        { status: 409 },
      );
    }
    try {
      const composited = await compositeTextPatch(currentImage, patchImage, selectedRegion.box);
      lastImage = { assetUrl: composited, model: "deterministic-text-patch", provider: "client-typeset" };
    } catch (error) {
      await releaseClaim();
      return errorResponse(error, 400);
    }
    qa = nextQa;
  } else {
    const fieldLabel = editFieldKey.replace(/_/g, " ");
    // Crop-region edit: send the model ONLY a padded window around the selected
    // region instead of the full ad. This drastically cuts model pixels (and
    // latency/cost); the composite below keeps every outside pixel from the
    // original, exactly like the legacy full-image path.
    const crop = await cropRegionWithPadding(currentImage, selectedRegion?.box);
    // The selected box re-based into the crop's normalized coordinate space so
    // the mask marks the right spot inside the (smaller) crop canvas.
    const cropLocalBox = rebaseBoxToCrop(
      selectedRegion?.box,
      crop.cropRect,
      crop.originalWidth,
      crop.originalHeight,
    );
    const baseRequest = buildTargetedEditRequest({
      currentImage: crop.croppedDataUrl,
      fieldLabel,
      newValue,
      newImage,
      editInstruction: instruction,
      expectedCopy,
      aspectRatio: String(row.format ?? "4:5"),
    });
    baseRequest.maskImage = await createCloneRegionEditMask(crop.croppedDataUrl, cropLocalBox);
    // All edits that reach the model go through it so the original type
    // treatment survives. (A long-gone deterministic fallback blurred the
    // selected rectangle and painted generic Arial over the ad — the patch
    // path above is different: it re-typesets over a clean inpainted plate
    // with the detected type treatment, so nothing is blurred or painted
    // over.) Providers were resolved in parallel above to save serial latency.
    const sortedProviders = providers.sort(
      (left, right) => Number(Boolean(right.capabilities.inpainting)) - Number(Boolean(left.capabilities.inpainting)),
    );

    try {
      const generated = await generateCloneWithCascade({
        providers: sortedProviders,
        request: { ...baseRequest, seed: 1 },
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId,
        attempt: 1,
        modelProfile: "image_draft",
      });
      // normalizeCloneRenderAspect is intentionally SKIPPED for cropped edits:
      // it force-resizes the render to the ad's exact placement ratio, which
      // would distort a region crop. The composite preserves the original
      // (already ratio-correct) full-image aspect anyway.
      const boundedModelEdit = await compositeRegionBack(
        currentImage,
        generated.assetUrl,
        crop.cropRect,
        selectedRegion?.box,
      );
      lastImage = { ...generated, assetUrl: boundedModelEdit };
    } catch (error) {
      await releaseClaim();
      return errorResponse(error, 502);
    }

    // Text edits update the stored value for the edited field (the requested
    // string IS the new value — no model round-trip). Image edits carry the
    // editor map forward unchanged. History, Compare, and Undo are the safety
    // net either way.
    qa = nextQa;
  }

  let image: string;
  try {
    image = await persistCloneRender({
      supabase: context.supabase,
      workspaceId: context.access.workspaceId,
      assetUrl: lastImage.assetUrl,
      fileNameSeed: `${correlationId}-edit`,
    });
  } catch (error) {
    await releaseClaim();
    return errorResponse(error, 500);
  }

  // Plate validity: a patch composite keeps the plate valid for the new
  // render by construction. A model edit keeps it only when its region cannot
  // have touched any text region; otherwise the layers drop and rebuild in
  // the background.
  let nextLayers: AdStudioTextLayers | undefined;
  if (layers?.status === "ready" && layersValidForCurrent) {
    if (patchImage || !boxIntersectsTextRegions(selectedRegion.box, currentQa?.regions)) {
      nextLayers = extendTextLayersValidity(layers, image);
    }
  }

  // Previous render goes to history (undo); the new render becomes current.
  // persistCloneRender runs before appendAdStudioCreativeRevision on purpose:
  // mutation replays return the completed canvas WITHOUT re-running this work
  // function, so a revision appended before a failed upload could never be
  // rolled back — it would permanently reference a path with no content.
  const renderHistory = [...(canvas.renderHistory ?? []), currentImageRef]
    .filter(Boolean)
    .slice(-RENDER_HISTORY_LIMIT);
  const renderQaHistory = [...(canvas.renderQaHistory ?? []), ...(currentQa ? [currentQa] : [])]
    .slice(-RENDER_HISTORY_LIMIT);
  const nextCanvas: AdStudioCreative["canvas"] = {
    ...canvas,
    objects: [{ ...cloneObject, content: image, assetId: image }],
    cloneQa: qa ?? currentQa,
    textLayers: nextLayers,
    renderHistory,
    renderQaHistory,
    redoHistory: [],
    redoQaHistory: [],
  };

  let revision;
  try {
    revision = await appendAdStudioCreativeRevision(context.supabase, {
      workspaceId: context.access.workspaceId,
      creativeId: id,
      expectedActiveRevisionId: expectedRevisionId,
      canvas: nextCanvas,
      renderStatus: "rendered",
      creationOperation: "targeted_edit",
      mutationId,
      requestHash,
    });
  } catch (error) {
    await releaseClaim();
    return errorResponse(error, 500);
  }

  if (!revision.ok) {
    if (revision.reason === "stale_revision") {
      await releaseClaim();
      return NextResponse.json(
        { code: "stale_revision", error: "This ad changed while your edit was rendering. Reload and try again." },
        { status: 409 },
      );
    }
    throw new Error("Creative revision append failed without a recognized reason.");
  }

  // The edit route returns a data: URL preview alongside the canonical storage
  // path so the client can paint pixels immediately without a second round
  // trip through the auth-gated media proxy. The storage path remains the
  // source of truth for reload/export; the data URL is purely a display hint.
  const previewImage = lastImage.assetUrl.startsWith("data:image/")
    ? lastImage.assetUrl
    : undefined;

  return NextResponse.json({
    creativeId: id,
    image,
    previewImage,
    qa,
    textLayers: nextLayers ?? null,
    renderHistory,
    renderQaHistory,
    redoHistory: [],
    redoQaHistory: [],
    revisionId: revision.revisionId,
    revisionNumber: revision.revisionNumber,
    model: lastImage.model,
    provider: lastImage.provider,
  });
    });
  } catch (error) {
    return errorResponse(error, 500);
  }

  if (!execution.ok) {
    const stale = execution.reason === "stale_revision";
    const contentMismatch = execution.reason === "mutation_content_mismatch";
    return NextResponse.json(
      {
        code: execution.reason,
        error: stale
          ? "This ad changed while you were editing. Reload and try again."
          : contentMismatch
            ? "This edit retry no longer matches the original request. Start the edit again."
            : "Another edit is already updating this ad. Try again shortly.",
      },
      { status: 409 },
    );
  }
  if (execution.state === "completed") {
    const completedCanvas = execution.canvas as AdStudioCreative["canvas"];
    const completedImage = completedCanvas.objects?.[0]?.content ?? completedCanvas.objects?.[0]?.assetId;
    if (!completedImage) return NextResponse.json({ error: "The saved edit is incomplete." }, { status: 500 });
    return NextResponse.json({
      creativeId: id,
      image: completedImage,
      qa: completedCanvas.cloneQa,
      textLayers: completedCanvas.textLayers ?? null,
      renderHistory: completedCanvas.renderHistory ?? [],
      renderQaHistory: completedCanvas.renderQaHistory ?? [],
      redoHistory: completedCanvas.redoHistory ?? [],
      redoQaHistory: completedCanvas.redoQaHistory ?? [],
      revisionId: execution.revisionId,
      revisionNumber: execution.revisionNumber,
      replayed: true,
    });
  }
  if (execution.state === "work_failed") {
    await releaseClaim();
    return errorResponse(execution.error, 500);
  }
  return execution.value;
}
