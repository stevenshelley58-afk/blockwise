import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { generateCloneWithCascade, persistCloneRender, resolveCloneProviders } from "@/lib/adstudio/clone-generation";
import { cloneQaCorrectionPrompt, runCloneQa } from "@/lib/adstudio/clone-qa";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { buildTargetedEditRequest } from "@/lib/adstudio/reference-clone";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import type { AdStudioCloneQa, AdStudioCreative } from "@/lib/adstudio/types";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type TargetedEditBody = {
  /** Copy-field key (text edit) or image-slot role (image edit) to change. */
  fieldKey?: string;
  /** The exact new text for a text edit. */
  newValue?: string;
  /** Replacement image (media path or data URL) for an image edit. */
  newImage?: string;
};

// The edit loop runs on the fast tier — attempts stay cheap and quick.
const MAX_ATTEMPTS = 2;
const RENDER_HISTORY_LIMIT = 10;

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { id } = await Promise.resolve(routeContext.params);
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  const rateLimit = await checkRateLimit(context.supabase, context.access.workspaceId, context.access.userId, {
    windowSeconds: 3600,
    maxRequests: 30,
    bucket: "ai-clone-edit",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const body = await readJsonBody<TargetedEditBody>(request);
  const fieldKey = body.fieldKey?.trim();
  const newValue = body.newValue?.trim() ?? "";
  const newImageRef = body.newImage?.trim();
  if (!fieldKey) {
    return NextResponse.json({ error: "fieldKey is required." }, { status: 400 });
  }
  if (!newValue && !newImageRef) {
    return NextResponse.json({ error: "Provide newValue (text edit) or newImage (image edit)." }, { status: 400 });
  }
  if (newValue.length > 200) {
    return NextResponse.json({ error: "Keep the new text to 200 characters or less." }, { status: 400 });
  }

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
    return NextResponse.json(
      { error: "In-place edits are only available for AI-designed creatives." },
      { status: 400 },
    );
  }

  const currentImageRef = cloneObject.content || cloneObject.assetId || "";
  const currentImage = await resolveAdStudioImageForModel(context.supabase, context.access.workspaceId, currentImageRef);
  if (!currentImage) {
    return NextResponse.json({ error: "The current creative image could not be read." }, { status: 400 });
  }
  const newImage = newImageRef
    ? await resolveAdStudioImageForModel(context.supabase, context.access.workspaceId, newImageRef)
    : undefined;
  if (newImageRef && !newImage) {
    return NextResponse.json({ error: "The replacement image could not be read." }, { status: 400 });
  }

  // Expected copy carries forward from the last QA verdict, with the edited
  // field overridden — so the verifier re-checks the WHOLE ad, catching drift
  // in elements the edit was not supposed to touch.
  const expectedCopy: Record<string, string> = {};
  for (const check of canvas.cloneQa?.copyChecks ?? []) {
    expectedCopy[check.key] = check.expected;
  }
  if (newValue) expectedCopy[fieldKey] = newValue;

  const fieldLabel = fieldKey.replace(/_/g, " ");
  const baseRequest = buildTargetedEditRequest({
    currentImage,
    fieldLabel,
    newValue,
    newImage,
    aspectRatio: String(row.format ?? "4:5"),
  });

  const providers = await resolveCloneProviders("preview");
  const correlationId = randomUUID();

  let qa: AdStudioCloneQa | null = null;
  let lastImage: { assetUrl: string; model: string; provider: string } | null = null;
  let correction = "";

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const generated = await generateCloneWithCascade({
        providers,
        request: {
          ...baseRequest,
          prompt: correction ? `${baseRequest.prompt} ${correction}` : baseRequest.prompt,
          seed: attempt,
        },
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId,
        tier: "preview",
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
      if (attempt >= MAX_ATTEMPTS) break;
      correction = cloneQaCorrectionPrompt(qa);
    }
  } catch (error) {
    return errorResponse(error, 502);
  }

  if (!lastImage || (qa && !qa.passed)) {
    return NextResponse.json(
      { error: "The edit did not render correctly. Try again.", qa },
      { status: 502 },
    );
  }

  const image = await persistCloneRender({
    supabase: context.supabase,
    workspaceId: context.access.workspaceId,
    assetUrl: lastImage.assetUrl,
    fileNameSeed: `${correlationId}-edit`,
  });

  // Previous render goes to history (undo); the new render becomes current.
  const renderHistory = [...(canvas.renderHistory ?? []), currentImageRef]
    .filter(Boolean)
    .slice(-RENDER_HISTORY_LIMIT);
  const nextCanvas: AdStudioCreative["canvas"] = {
    ...canvas,
    objects: [{ ...cloneObject, content: image, assetId: image }],
    cloneQa: qa ?? canvas.cloneQa,
    renderHistory,
  };

  const { error: updateError } = await context.supabase
    .from("adstudio_creatives")
    .update({ canvas_json: nextCanvas, updated_at: new Date().toISOString() })
    .eq("workspace_id", context.access.workspaceId)
    .eq("id", id);
  if (updateError) {
    return NextResponse.json({ error: `Edit could not be saved (${updateError.message}).` }, { status: 500 });
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
