import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, requireAdStudioRequest } from "@/lib/adstudio/http";
import { deriveAndPersistTemplateTextLayers } from "@/lib/adstudio/layer-derivation";
import type { AdStudioCreative } from "@/lib/adstudio/types";
import { resolveAdStudioTemplate } from "@/lib/adstudio/templates";
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
 * editor; while it runs, edits keep working through the model path.
 */
export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { id } = await Promise.resolve(routeContext.params);
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

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

  const { data: row, error: loadError } = await context.supabase
    .from("adstudio_creatives")
    .select("id, campaign_id, format, canvas_json, active_revision_id")
    .eq("workspace_id", context.access.workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Creative not found." }, { status: 404 });

  const canvas = row.canvas_json as AdStudioCreative["canvas"];
  const cloneObject = canvas?.objects?.[0];
  const isClone = canvas?.objects?.length === 1 && cloneObject?.objectId === "template_clone_image";
  if (!isClone) {
    return NextResponse.json({ error: "Layers are only available for AI-designed creatives." }, { status: 400 });
  }

  const currentImageRef = cloneObject.content || cloneObject.assetId || "";
  const existing = canvas.textLayers;
  if (existing?.status === "ready" && existing.validFor.includes(currentImageRef)) {
    return NextResponse.json({ creativeId: id, textLayers: existing });
  }

  if (!canvas.cloneQa?.regions?.some((region) => region.kind === "text")) {
    return NextResponse.json({ error: "This creative has no editable text regions yet." }, { status: 409 });
  }

  const correlationId = randomUUID();
  const { data: campaign, error: campaignError } = await context.supabase
    .from("adstudio_campaigns")
    .select("template_key")
    .eq("workspace_id", context.access.workspaceId)
    .eq("id", row.campaign_id)
    .maybeSingle();
  if (campaignError) return NextResponse.json({ error: campaignError.message }, { status: 500 });
  const template = resolveAdStudioTemplate(campaign?.template_key ?? undefined);
  if (!template) return NextResponse.json({ error: "The source template could not be resolved." }, { status: 409 });

  try {
    const textLayers = await deriveAndPersistTemplateTextLayers({
      supabase: context.supabase,
      workspaceId: context.access.workspaceId,
      userId: context.access.userId,
      correlationId,
      creativeId: id,
      activeRevisionId: row.active_revision_id,
      format: String(row.format ?? "4:5"),
      canvas,
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
