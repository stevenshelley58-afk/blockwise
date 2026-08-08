import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, requireAdStudioRequest } from "@/lib/adstudio/http";
import { deriveAndPersistTemplateTextLayers } from "@/lib/adstudio/layer-derivation";
import { buildingTextLayers } from "@/lib/adstudio/text-layer-state";
import type { AdStudioCreative, AdStudioLegacyCanvas } from "@/lib/adstudio/types";
import { isAdDocInstanceShape } from "@/lib/adstudio/v2/template-doc";
import { deterministicEditingReadiness, resolveAdStudioTemplate } from "@/lib/adstudio/templates";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

/**
 * Build (or return) the creative's text-editing layers: a text-free background
 * plate plus per-region type treatments. Runs in the background from the
 * editor. Fully migrated templates wait for this exact layer contract and
 * never route text changes through the image model.
 */
export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { id } = await Promise.resolve(routeContext.params);
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  const { data: row, error: loadError } = await context.supabase
    .from("adstudio_creatives")
    .select("id, campaign_id, format, canvas_json, active_revision_id, updated_at")
    .eq("workspace_id", context.access.workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Creative not found." }, { status: 404 });

  const storedCanvas = row.canvas_json as AdStudioCreative["canvas"];
  if (isAdDocInstanceShape(storedCanvas)) {
    return NextResponse.json(
      {
        code: "v2_document_edit",
        error: `This creative uses the v2 document editor. Send edits to /api/adstudio/creatives/${id}/doc.`,
      },
      { status: 409 },
    );
  }
  const canvas: AdStudioLegacyCanvas = storedCanvas;
  const cloneObject = canvas?.objects?.[0];
  const isClone = canvas?.objects?.length === 1 && cloneObject?.objectId === "template_clone_image";
  if (!isClone) {
    return NextResponse.json({ error: "Layers are only available for AI-designed creatives." }, { status: 400 });
  }

  const currentImageRef = cloneObject.content || cloneObject.assetId || "";
  const { data: campaign, error: campaignError } = await context.supabase
    .from("adstudio_campaigns")
    .select("template_key")
    .eq("workspace_id", context.access.workspaceId)
    .eq("id", row.campaign_id)
    .maybeSingle();
  if (campaignError) return NextResponse.json({ error: campaignError.message }, { status: 500 });
  const template = resolveAdStudioTemplate(campaign?.template_key ?? undefined);
  if (!template) return NextResponse.json({ error: "The source template could not be resolved." }, { status: 409 });
  const deterministicOnly = deterministicEditingReadiness(template).status === "ready";

  const existing = canvas.textLayers;
  const allTextStylesLive = canvas.cloneQa?.regions
    ?.filter((region) => region.kind === "text")
    .every((region) => existing?.styles[region.key]?.mode === "live") ?? false;
  if (
    existing?.status === "ready"
    && existing.validFor.includes(currentImageRef)
    && (!deterministicOnly || (existing.deterministicOnly && allTextStylesLive))
  ) {
    return NextResponse.json({ creativeId: id, textLayers: existing });
  }
  // The generation pipeline persisted this before its background task began.
  // Returning it is the cross-process single-flight guard: opening the editor
  // cannot buy a second inpaint while that task owns this render.
  if (existing?.status === "building" && existing.derivedFrom === currentImageRef) {
    return NextResponse.json({ creativeId: id, textLayers: existing }, { status: 202 });
  }

  if (!canvas.cloneQa?.regions?.some((region) => region.kind === "text")) {
    return NextResponse.json({ error: "This creative has no editable text regions yet." }, { status: 409 });
  }

  const correlationId = randomUUID();

  const rateLimit = await checkRateLimit(context.supabase, context.access.workspaceId, context.access.userId, {
    windowSeconds: 3600,
    maxRequests: 20,
    bucket: "ai-layer-decompose",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  // Older creatives have no persisted lease. Claim this render before doing
  // any expensive work; new renders receive the same state at persistence.
  const building = buildingTextLayers(
    currentImageRef,
    deterministicOnly,
  );
  const claimedCanvas = { ...canvas, textLayers: building };
  let claim = context.supabase
    .from("adstudio_creatives")
    .update({ canvas_json: claimedCanvas, updated_at: new Date().toISOString() })
    .eq("workspace_id", context.access.workspaceId)
    .eq("id", id)
    .eq("updated_at", row.updated_at);
  claim = row.active_revision_id
    ? claim.eq("active_revision_id", row.active_revision_id)
    : claim.is("active_revision_id", null);
  const { data: claimed, error: claimError } = await claim.select("id");
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!claimed?.length) {
    return NextResponse.json({ error: "This ad changed. Reload it before editing." }, { status: 409 });
  }

  try {
    const textLayers = await deriveAndPersistTemplateTextLayers({
      supabase: context.supabase,
      workspaceId: context.access.workspaceId,
      userId: context.access.userId,
      correlationId,
      creativeId: id,
      activeRevisionId: row.active_revision_id,
      format: String(row.format ?? "4:5"),
      canvas: claimedCanvas,
      currentImageRef,
      template,
    });
    if (!textLayers) {
      return NextResponse.json(
        { code: "layers_unavailable", error: "Fast editing is not available for this render yet." },
        { status: 409 },
      );
    }

    return NextResponse.json({ creativeId: id, textLayers });
  } catch (error) {
    return errorResponse(error, 502);
  }
}
