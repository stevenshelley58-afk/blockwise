import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { generateCloneWithCascade, persistCloneRender, resolveCloneProviders } from "@/lib/adstudio/clone-generation";
import { runCloneQa } from "@/lib/adstudio/clone-qa";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { buildRefineRequest } from "@/lib/adstudio/reference-clone";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import type { AdStudioCloneQa, AdStudioCreative } from "@/lib/adstudio/types";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Quality-tier rendering takes 60-120s per attempt.
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type EnhanceBody = {
  /**
   * The render the client is upgrading (media path of the draft). If the
   * creative has moved on since — the user edited it in place — the upgrade
   * would clobber their work, so the request is rejected instead.
   */
  expectedCurrentImage?: string;
};

// One quality render, one QA-guided retry.
const MAX_ATTEMPTS = 2;
const RENDER_HISTORY_LIMIT = 10;

/**
 * The quality-upgrade pass behind draft-then-upgrade generation: the fast
 * draft the user is already looking at gets re-rendered by the quality tier,
 * design pixel-stable, and swapped in when it verifies.
 */
export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { id } = await Promise.resolve(routeContext.params);
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  const rateLimit = await checkRateLimit(context.supabase, context.access.workspaceId, context.access.userId, {
    windowSeconds: 3600,
    maxRequests: 20,
    bucket: "ai-clone-enhance",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const body = await readJsonBody<EnhanceBody>(request);

  const { data: row, error: loadError } = await context.supabase
    .from("adstudio_creatives")
    .select("id, campaign_id, variant_id, format, canvas_json")
    .eq("workspace_id", context.access.workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Creative not found." }, { status: 404 });

  const canvas = row.canvas_json as AdStudioCreative["canvas"];
  const cloneObject = canvas?.objects?.[0];
  const isClone = canvas?.objects?.length === 1 && cloneObject?.objectId === "template_clone_image";
  if (!isClone) {
    return NextResponse.json({ error: "Enhance is only available for AI-designed creatives." }, { status: 400 });
  }

  const currentImageRef = cloneObject.content || cloneObject.assetId || "";
  if (body.expectedCurrentImage && body.expectedCurrentImage !== currentImageRef) {
    return NextResponse.json(
      { error: "The creative changed while the upgrade was queued — keeping the newer version." },
      { status: 409 },
    );
  }
  const currentImage = await resolveAdStudioImageForModel(context.supabase, context.access.workspaceId, currentImageRef);
  if (!currentImage) {
    return NextResponse.json({ error: "The current creative image could not be read." }, { status: 400 });
  }

  // The upgrade must not change any copy: verify the quality render against
  // the same expectations the draft passed.
  const expectedCopy: Record<string, string> = {};
  for (const check of canvas.cloneQa?.copyChecks ?? []) {
    expectedCopy[check.key] = check.expected;
  }

  const baseRequest = buildRefineRequest({
    currentImage,
    aspectRatio: String(row.format ?? "4:5"),
  });

  const providers = await resolveCloneProviders("final");
  const correlationId = randomUUID();

  let qa: AdStudioCloneQa | null = null;
  let lastImage: { assetUrl: string; model: string; provider: string } | null = null;

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const generated = await generateCloneWithCascade({
        providers,
        request: { ...baseRequest, seed: attempt },
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId,
        tier: "final",
        attempt,
      });
      lastImage = generated;

      qa = await runCloneQa({
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId,
        imageUrl: generated.assetUrl,
        expectedCopy,
        attempt,
      });

      if (qa.passed) break;
    }
  } catch (error) {
    return errorResponse(error, 502);
  }

  // An upgrade that fails verification is discarded — the draft the user
  // already has stays current. This endpoint never makes the ad worse.
  if (!lastImage || (qa && !qa.passed)) {
    return NextResponse.json(
      { error: "The quality upgrade did not verify — keeping the current version.", qa },
      { status: 502 },
    );
  }

  const image = await persistCloneRender({
    supabase: context.supabase,
    workspaceId: context.access.workspaceId,
    assetUrl: lastImage.assetUrl,
    fileNameSeed: `${correlationId}-enhance`,
  });

  // Re-read before writing: if the user edited the creative during the
  // 1-2 minute render, their newer version wins and the upgrade is dropped.
  const { data: freshRow } = await context.supabase
    .from("adstudio_creatives")
    .select("canvas_json")
    .eq("workspace_id", context.access.workspaceId)
    .eq("id", id)
    .maybeSingle();
  const freshCanvas = (freshRow?.canvas_json ?? canvas) as AdStudioCreative["canvas"];
  const freshObject = freshCanvas?.objects?.[0];
  const freshImageRef = freshObject?.content || freshObject?.assetId || "";
  if (freshImageRef !== currentImageRef) {
    return NextResponse.json(
      { error: "The creative changed while the upgrade rendered — keeping the newer version." },
      { status: 409 },
    );
  }

  const renderHistory = [...(freshCanvas.renderHistory ?? []), currentImageRef]
    .filter(Boolean)
    .slice(-RENDER_HISTORY_LIMIT);
  const nextCanvas: AdStudioCreative["canvas"] = {
    ...freshCanvas,
    objects: [{ ...freshObject, content: image, assetId: image }],
    cloneQa: qa ?? freshCanvas.cloneQa,
    renderHistory,
  };

  const { error: updateError } = await context.supabase
    .from("adstudio_creatives")
    .update({ canvas_json: nextCanvas, updated_at: new Date().toISOString() })
    .eq("workspace_id", context.access.workspaceId)
    .eq("id", id);
  if (updateError) {
    return NextResponse.json({ error: `Upgrade could not be saved (${updateError.message}).` }, { status: 500 });
  }

  return NextResponse.json({
    creativeId: id,
    image,
    qa,
    renderHistory,
    model: lastImage.model,
    provider: lastImage.provider,
  });
}
