// One-time backfill for creatives generated before clean plates existed:
// produce the text-free plate the embedded design editor needs, append it as a
// revision, and never run again for that creative. Text edits afterwards are
// deterministic editor saves — no AI, no vision QA.

import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { cleanPlateFileNameSeed, generateCleanPlate } from "@/lib/adstudio/clean-plate";
import {
  appendAdStudioCreativeRevision,
  executeAdStudioCreativeRevisionMutation,
  releaseAdStudioCreativeRevisionMutation,
} from "@/lib/adstudio/creative-revisions";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import type { AdStudioCreative } from "@/lib/adstudio/types";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type PrepareEditorBody = {
  expectedRevisionId?: string;
  mutationId?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { id } = await Promise.resolve(routeContext.params);
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  const rateLimit = await checkRateLimit(context.supabase, context.access.workspaceId, context.access.userId, {
    windowSeconds: 3600,
    maxRequests: 15,
    bucket: "editor-prepare",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const body = await readJsonBody<PrepareEditorBody>(request);
  const expectedRevisionId = body.expectedRevisionId?.trim() ?? "";
  const mutationId = body.mutationId?.trim() ?? "";
  if (!UUID_PATTERN.test(expectedRevisionId) || !UUID_PATTERN.test(mutationId)) {
    return NextResponse.json({ error: "Reload the ad before editing it." }, { status: 400 });
  }
  const requestHash = createHash("sha256")
    .update(JSON.stringify({
      workspaceId: context.access.workspaceId,
      creativeId: id,
      baseRevisionId: expectedRevisionId,
      action: "prepare_editor",
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
        .select("id, format, canvas_json, active_revision_id")
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
          { error: "The design editor is only available for AI-designed creatives." },
          { status: 400 },
        );
      }
      if (canvas.cloneEdit?.cleanPlate) {
        await releaseClaim();
        return NextResponse.json({
          creativeId: id,
          cleanPlate: canvas.cloneEdit.cleanPlate,
          revisionId: expectedRevisionId,
          alreadyPrepared: true,
        });
      }
      const regions = canvas.cloneQa?.regions ?? [];
      if (!regions.some((region) => region.kind === "text")) {
        await releaseClaim();
        return NextResponse.json(
          { error: "This ad has no editable text regions yet. Try again once review finishes." },
          { status: 409 },
        );
      }

      const currentImageRef = cloneObject.content || cloneObject.assetId || "";
      const currentImage = await resolveAdStudioImageForModel(
        context.supabase,
        context.access.workspaceId,
        currentImageRef,
      );
      if (!currentImage) {
        await releaseClaim();
        return NextResponse.json({ error: "The current creative image could not be read." }, { status: 400 });
      }

      const cleanPlate = await generateCleanPlate({
        supabase: context.supabase,
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId: mutationId,
        format: String(row.format ?? "4:5"),
        renderImage: currentImage,
        regions,
        quality: "fast",
        fileNameSeed: cleanPlateFileNameSeed(mutationId, String(row.format ?? "4:5")),
      });
      if (!cleanPlate) {
        await releaseClaim();
        return NextResponse.json(
          { error: "The editable layers could not be prepared. Try again shortly." },
          { status: 502 },
        );
      }

      const nextCanvas: AdStudioCreative["canvas"] = {
        ...canvas,
        cloneEdit: { version: 1, cleanPlate },
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
          { code: "stale_revision", error: "This ad changed while the editor was being prepared. Reload and try again." },
          { status: 409 },
        );
      }
      return NextResponse.json({
        creativeId: id,
        cleanPlate,
        revisionId: revision.revisionId,
        revisionNumber: revision.revisionNumber,
      });
    });
  } catch (error) {
    return errorResponse(error, 500);
  }

  if (!execution.ok) {
    const stale = execution.reason === "stale_revision";
    return NextResponse.json(
      {
        code: execution.reason,
        error: stale
          ? "This ad changed while you were editing. Reload and try again."
          : "Another update is already preparing this ad. Try again shortly.",
      },
      { status: 409 },
    );
  }
  if (execution.state === "completed") {
    const completedCanvas = execution.canvas as AdStudioCreative["canvas"];
    const cleanPlate = completedCanvas.cloneEdit?.cleanPlate;
    if (!cleanPlate) return NextResponse.json({ error: "The prepared editor state is incomplete." }, { status: 500 });
    return NextResponse.json({
      creativeId: id,
      cleanPlate,
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
