// Deterministic save for the embedded design editor. The client flattens the
// scene (clean plate + real text layers) itself, so this route only validates,
// stores, and versions the result — no image model and no vision QA. This is
// what makes editor text edits instant AND letter-perfect: the server never
// re-renders what the customer already saw.

import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { persistCloneRender } from "@/lib/adstudio/clone-generation";
import { applyEditorSceneQa } from "@/lib/adstudio/clone-qa";
import {
  appendAdStudioCreativeRevision,
  executeAdStudioCreativeRevisionMutation,
  releaseAdStudioCreativeRevisionMutation,
} from "@/lib/adstudio/creative-revisions";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { dataUrlToUploadBytes } from "@/lib/adstudio/generated-media";
import type { AdStudioCloneRegion, AdStudioCreative } from "@/lib/adstudio/types";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type EditorSaveBody = {
  /** Polotno scene JSON, stored verbatim on the creative. */
  editorScene?: Record<string, unknown>;
  /** Flattened scene render (png or jpeg data URL) at exact canvas size. */
  flattenedImage?: string;
  /** Exact text per copy-field key, extracted from the scene. */
  textByKey?: Record<string, string>;
  /** Current text-layer boxes (normalized 0-1), extracted from the scene. */
  regions?: AdStudioCloneRegion[];
  expectedRevisionId?: string;
  mutationId?: string;
};

const RENDER_HISTORY_LIMIT = 10;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SCENE_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_LENGTH = 200;

function isValidRegion(region: unknown): region is AdStudioCloneRegion {
  if (!region || typeof region !== "object") return false;
  const candidate = region as AdStudioCloneRegion;
  return (
    typeof candidate.key === "string" &&
    (candidate.kind === "text" || candidate.kind === "image") &&
    !!candidate.box &&
    [candidate.box.x, candidate.box.y, candidate.box.width, candidate.box.height]
      .every((value) => typeof value === "number" && Number.isFinite(value))
  );
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { id } = await Promise.resolve(routeContext.params);
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  // Deterministic saves are cheap; this bucket is deliberately far looser than
  // the AI edit bucket so normal editing sessions never hit it.
  const rateLimit = await checkRateLimit(context.supabase, context.access.workspaceId, context.access.userId, {
    windowSeconds: 3600,
    maxRequests: 120,
    bucket: "editor-save",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const body = await readJsonBody<EditorSaveBody>(request);
  const expectedRevisionId = body.expectedRevisionId?.trim() ?? "";
  const mutationId = body.mutationId?.trim() ?? "";
  const flattenedImage = body.flattenedImage?.trim() ?? "";
  const editorScene = body.editorScene;
  const textByKey = body.textByKey ?? {};
  const regions = Array.isArray(body.regions) ? body.regions.filter(isValidRegion) : [];

  if (!UUID_PATTERN.test(expectedRevisionId) || !UUID_PATTERN.test(mutationId)) {
    return NextResponse.json({ error: "Reload the ad before editing it." }, { status: 400 });
  }
  if (!editorScene || typeof editorScene !== "object") {
    return NextResponse.json({ error: "The editor scene is missing." }, { status: 400 });
  }
  if (JSON.stringify(editorScene).length > MAX_SCENE_BYTES) {
    return NextResponse.json({ error: "The design is too complex to save." }, { status: 400 });
  }
  if (!flattenedImage.startsWith("data:image/png") && !flattenedImage.startsWith("data:image/jpeg")) {
    return NextResponse.json({ error: "The flattened design image is missing." }, { status: 400 });
  }
  for (const [key, value] of Object.entries(textByKey)) {
    if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `Keep "${key.replace(/_/g, " ")}" to ${MAX_TEXT_LENGTH} characters or less.` },
        { status: 400 },
      );
    }
  }

  const requestHash = createHash("sha256")
    .update(JSON.stringify({
      workspaceId: context.access.workspaceId,
      creativeId: id,
      baseRevisionId: expectedRevisionId,
      action: "editor_save",
      image: createHash("sha256").update(flattenedImage).digest("hex"),
      scene: createHash("sha256").update(JSON.stringify(editorScene)).digest("hex"),
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
        .select("id, format, width, height, canvas_json, active_revision_id")
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
      if (!isClone || !canvas.cloneEdit?.cleanPlate) {
        await releaseClaim();
        return NextResponse.json(
          { error: "This ad is not set up for the design editor yet." },
          { status: 400 },
        );
      }

      // Validate the flattened render: decoded, exact canvas size, PNG stored.
      let storedImageDataUrl: string;
      try {
        const decoded = dataUrlToUploadBytes(flattenedImage);
        if (decoded.bytes.byteLength > MAX_IMAGE_BYTES) {
          await releaseClaim();
          return NextResponse.json({ error: "The design image is too large to save." }, { status: 400 });
        }
        const { default: sharp } = await import("sharp");
        const image = sharp(decoded.bytes);
        const metadata = await image.metadata();
        const expectedWidth = Number(canvas.width);
        const expectedHeight = Number(canvas.height);
        if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
          await releaseClaim();
          return NextResponse.json(
            { error: `The design must be exactly ${expectedWidth}x${expectedHeight} pixels.` },
            { status: 400 },
          );
        }
        const png = await image.png().toBuffer();
        storedImageDataUrl = `data:image/png;base64,${png.toString("base64")}`;
      } catch {
        await releaseClaim();
        return NextResponse.json({ error: "The design image could not be read." }, { status: 400 });
      }

      let image: string;
      try {
        image = await persistCloneRender({
          supabase: context.supabase,
          workspaceId: context.access.workspaceId,
          assetUrl: storedImageDataUrl,
          fileNameSeed: `${mutationId}-editor`,
        });
      } catch (error) {
        await releaseClaim();
        return errorResponse(error, 500);
      }

      const previousQa = canvas.cloneQa;
      const qa = previousQa ? applyEditorSceneQa(previousQa, textByKey, regions) : undefined;
      const currentImageRef = cloneObject.content || cloneObject.assetId || "";
      const renderHistory = [...(canvas.renderHistory ?? []), currentImageRef]
        .filter(Boolean)
        .slice(-RENDER_HISTORY_LIMIT);
      const renderQaHistory = [...(canvas.renderQaHistory ?? []), ...(previousQa ? [previousQa] : [])]
        .slice(-RENDER_HISTORY_LIMIT);
      const nextCanvas: AdStudioCreative["canvas"] = {
        ...canvas,
        objects: [{ ...cloneObject, content: image, assetId: image }],
        cloneQa: qa ?? previousQa,
        renderHistory,
        renderQaHistory,
        redoHistory: [],
        redoQaHistory: [],
        cloneEdit: {
          ...canvas.cloneEdit,
          editorScene,
          editorSceneUpdatedAt: new Date().toISOString(),
        },
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
        await releaseClaim();
        return NextResponse.json(
          { code: "stale_revision", error: "This ad changed while your edit was saving. Reload and try again." },
          { status: 409 },
        );
      }

      return NextResponse.json({
        creativeId: id,
        image,
        qa: nextCanvas.cloneQa,
        renderHistory,
        renderQaHistory,
        redoHistory: [],
        redoQaHistory: [],
        cloneEdit: nextCanvas.cloneEdit,
        revisionId: revision.revisionId,
        revisionNumber: revision.revisionNumber,
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
            ? "This save retry no longer matches the original request. Save again."
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
      renderHistory: completedCanvas.renderHistory ?? [],
      renderQaHistory: completedCanvas.renderQaHistory ?? [],
      redoHistory: completedCanvas.redoHistory ?? [],
      redoQaHistory: completedCanvas.redoQaHistory ?? [],
      cloneEdit: completedCanvas.cloneEdit,
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
