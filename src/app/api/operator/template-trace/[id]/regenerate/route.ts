import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { requireOperator } from "@/lib/operator/auth";
import { buildTemplateTrace } from "@/lib/operator/template-trace";
import { buildCloneImageRequest } from "@/lib/adstudio/reference-clone";
import {
  generateCloneWithCascade,
  normalizeCloneRenderAspect,
  resolveCloneProviders,
  cloneModelProfileForQuality,
  type AdGenerationQuality,
} from "@/lib/adstudio/clone-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/operator/template-trace/[id]/regenerate
 * Body: {
 *   quality: "fast" | "high",
 *   copy?: Record<string, string>,       // text overrides
 *   images?: Record<string, string>,     // data-URL overrides per image key
 * }
 * Returns: { assetUrl (data URL), prompt, negativePrompt, model, provider }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const trace = buildTemplateTrace(decodeURIComponent(id));
  if (!trace) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({})) as {
    quality?: AdGenerationQuality;
    copy?: Record<string, string>;
    images?: Record<string, string>;
  };

  const quality: AdGenerationQuality = body.quality === "high" ? "high" : "fast";

  // Provider accounting is workspace-scoped and backed by UUID foreign keys.
  // Attribute this operator-only test render to the operator's real workspace
  // instead of inventing a synthetic identifier that the ledger cannot store.
  const { data: membership, error: membershipError } = await guard.supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("profile_id", guard.userId)
    .limit(1)
    .maybeSingle();
  if (membershipError || !membership?.workspace_id) {
    return NextResponse.json(
      { error: "A workspace membership is required to account for this test render." },
      { status: 409 },
    );
  }

  // Read the sample image from disk as a data URL (the reference design).
  const samplePath = join(resolve(process.cwd(), "public"), ...trace.sampleImagePath.slice(1).split("/"));
  if (!existsSync(samplePath)) {
    return NextResponse.json({ error: "Sample image not found on disk." }, { status: 404 });
  }
  const sampleBytes = readFileSync(samplePath);
  const sampleDataUrl = `data:image/png;base64,${sampleBytes.toString("base64")}`;

  // Build image inputs: use operator overrides where provided, fall back to
  // the sample image as a placeholder for each required slot.
  const images: Record<string, string> = {};
  for (const img of trace.template.inputs.images) {
    images[img.key] = body.images?.[img.key]?.trim() || sampleDataUrl;
  }

  const cloneRequest = buildCloneImageRequest(trace.template, {
    referenceImage: sampleDataUrl,
    images,
    copy: body.copy ?? {},
    aspectRatio: trace.template.format,
  });

  try {
    const providers = await resolveCloneProviders(quality);
    const correlationId = randomUUID();
    const result = await generateCloneWithCascade({
      providers,
      request: cloneRequest,
      workspaceId: membership.workspace_id,
      userId: guard.userId,
      correlationId,
      attempt: 1,
      modelProfile: cloneModelProfileForQuality(quality),
    });

    // Normalize to exact aspect ratio and return as data URL.
    const finalAsset = await normalizeCloneRenderAspect(result.assetUrl, trace.template.format);

    return NextResponse.json({
      assetUrl: finalAsset,
      prompt: cloneRequest.prompt,
      negativePrompt: cloneRequest.negativePrompt,
      model: result.model,
      provider: result.provider,
      providerAttempts: result.providerAttemptCount,
      quality,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
