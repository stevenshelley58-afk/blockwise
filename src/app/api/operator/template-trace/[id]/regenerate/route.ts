import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { requireOperator } from "@/lib/operator/auth";
import { buildTemplateTrace } from "@/lib/operator/template-trace";
import {
  isApprovedTraceSamplePath,
  validatedTraceImageBytesDataUrl,
  validatedTraceImageDataUrl,
} from "@/lib/operator/template-trace-input";
import { buildCloneImageRequest } from "@/lib/adstudio/reference-clone";
import { AD_IMAGE_MAX_BYTES } from "@/lib/upload/asset-file";
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

async function boundedImageResponseBytes(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > AD_IMAGE_MAX_BYTES) {
    throw new Error("Sample image exceeds the upload limit.");
  }
  if (!response.body) throw new Error("Sample image returned no bytes.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > AD_IMAGE_MAX_BYTES) {
      await reader.cancel();
      throw new Error("Sample image exceeds the upload limit.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

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

  // Public samples are served by the deployment CDN. Fetching the approved
  // reference avoids a dynamic public-directory read, which would otherwise
  // make output tracing package every unrelated public asset with this route.
  if (!isApprovedTraceSamplePath(trace.sampleImagePath)) {
    return NextResponse.json({ error: "Template sample path is invalid." }, { status: 500 });
  }
  const deploymentHost = process.env.VERCEL_URL;
  const sampleOrigin = deploymentHost && /^[a-z0-9.-]+$/i.test(deploymentHost)
    ? `https://${deploymentHost}`
    : request.nextUrl.origin;
  const sampleUrl = new URL(trace.sampleImagePath, sampleOrigin);
  const sampleResponse = await fetch(sampleUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!sampleResponse.ok) {
    return NextResponse.json({ error: "Sample image could not be loaded." }, { status: 404 });
  }
  const sampleContentType = sampleResponse.headers.get("content-type")?.split(";", 1)[0] ?? "";
  let sampleDataUrl: string;
  try {
    const sampleBytes = await boundedImageResponseBytes(sampleResponse);
    sampleDataUrl = await validatedTraceImageBytesDataUrl(sampleBytes, sampleContentType);
  } catch {
    return NextResponse.json({ error: "Template sample is not a valid supported image." }, { status: 500 });
  }

  // Build image inputs: use operator overrides where provided, fall back to
  // the sample image as a placeholder for each required slot.
  const images: Record<string, string> = {};
  for (const img of trace.template.inputs.images) {
    const override = body.images?.[img.key]?.trim();
    if (!override) {
      images[img.key] = sampleDataUrl;
      continue;
    }
    try {
      images[img.key] = await validatedTraceImageDataUrl(override);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Image override is invalid." },
        { status: 400 },
      );
    }
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
      workspaceId: "operator-trace",
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
