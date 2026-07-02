import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { generateCloneWithCascade, persistCloneRender, resolveCloneProviders } from "@/lib/adstudio/clone-generation";
import { cloneQaCorrectionPrompt, runCloneQa } from "@/lib/adstudio/clone-qa";
import { runComplianceGate } from "@/lib/adstudio/creative-qa";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { ensureRasterReferenceImage } from "@/lib/adstudio/rasterize-reference";
import { buildCloneImageRequest, resolveCloneCopy } from "@/lib/adstudio/reference-clone";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import { getTemplateBrief } from "@/lib/adstudio/template-brief";
import type { AdStudioCloneQa } from "@/lib/adstudio/types";
import type { ImageProviderRequest } from "@/lib/adstudio/providers";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type GenerateCloneBody = {
  /** The gallery template whose design we clone. */
  templateId?: string;
  /** Customer images keyed by the template's image-slot role (media path or data URL). */
  images?: Record<string, string>;
  /** Copy values keyed by the template's copy-field key (falls back to defaults). */
  copy?: Record<string, string>;
  /** Optional brand accent hex override (from the brand kit). */
  brandHex?: string;
  /** "preview" = fast/cheap tier (edit loop); "final" = quality tier (default). */
  tier?: "preview" | "final";
};

// Keep headroom under maxDuration for persistence + response.
const ROUTE_DEADLINE_MS = 100_000;
const MAX_ATTEMPTS: Record<"preview" | "final", number> = { preview: 3, final: 2 };

export async function POST(request: NextRequest) {
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  const rateLimit = await checkRateLimit(context.supabase, context.access.workspaceId, context.access.userId, {
    windowSeconds: 3600,
    maxRequests: 12,
    bucket: "ai-generate-clone",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const body = await readJsonBody<GenerateCloneBody>(request);
  if (!body.templateId) {
    return NextResponse.json({ error: "templateId is required." }, { status: 400 });
  }

  const brief = getTemplateBrief(body.templateId);
  if (!brief) {
    return NextResponse.json({ error: `Unknown template: ${body.templateId}` }, { status: 404 });
  }

  // Resolve each supplied customer image to something the model can consume.
  const suppliedImages = body.images ?? {};
  const resolvedImages: Record<string, string> = {};
  for (const slot of brief.imageSlots) {
    const ref = suppliedImages[slot.role] ?? (slot.objectId ? suppliedImages[slot.objectId] : undefined);
    if (ref && ref.trim()) {
      const resolved = await resolveAdStudioImageForModel(context.supabase, context.access.workspaceId, ref.trim());
      if (!resolved) {
        return NextResponse.json({ error: `Image for "${slot.role}" could not be read.` }, { status: 400 });
      }
      resolvedImages[slot.role] = resolved;
    } else if (slot.required) {
      return NextResponse.json({ error: `Missing required image: ${slot.role}` }, { status: 400 });
    }
  }

  // The design-to-clone is the template's public sample, made absolute so any
  // provider can fetch it — and rasterized, because the samples are SVGs and
  // image providers only accept JPEG/PNG/WebP.
  const referenceImage = await ensureRasterReferenceImage(
    new URL(brief.referenceImage, request.nextUrl.origin).toString(),
  );
  const tier: "preview" | "final" = body.tier === "preview" ? "preview" : "final";

  let expectedCopy: Record<string, string>;
  let baseRequest: ImageProviderRequest;
  try {
    expectedCopy = resolveCloneCopy(brief, body.copy);
    baseRequest = buildCloneImageRequest(brief, {
      referenceImage,
      images: resolvedImages,
      copy: body.copy,
      brandHex: body.brandHex,
    });
  } catch (error) {
    return errorResponse(error, 400);
  }

  const providers = await resolveCloneProviders(tier);
  const correlationId = randomUUID();
  const deadline = Date.now() + ROUTE_DEADLINE_MS;
  const maxAttempts = MAX_ATTEMPTS[tier];

  let qa: AdStudioCloneQa | null = null;
  let lastImage: { assetUrl: string; model: string; provider: string } | null = null;
  let correction = "";

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const generated = await generateCloneWithCascade({
        providers,
        request: {
          ...baseRequest,
          prompt: correction ? `${baseRequest.prompt} ${correction}` : baseRequest.prompt,
          seed: (baseRequest.seed ?? 0) + attempt,
        },
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId,
        tier,
        attempt,
      });
      lastImage = generated;

      // QA on the raw model output (data: URL) — the persisted media path is
      // auth-protected and unreachable for the vision model.
      qa = await runCloneQa({
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId,
        imageUrl: generated.assetUrl,
        expectedCopy,
        attempt,
      });

      if (qa.passed) break;
      if (attempt >= maxAttempts || Date.now() >= deadline) break;
      correction = cloneQaCorrectionPrompt(qa);
    }
  } catch (error) {
    return errorResponse(error, 502);
  }

  if (!lastImage) {
    return NextResponse.json({ error: "Clone generation failed. Try again." }, { status: 502 });
  }

  // A clone that failed copy verification never ships silently: the caller gets
  // the report and decides (the dialog surfaces it as a retryable error).
  if (qa && !qa.passed) {
    return NextResponse.json(
      {
        error: "The generated ad did not render your copy correctly. Please try again.",
        qa,
      },
      { status: 502 },
    );
  }

  const image = await persistCloneRender({
    supabase: context.supabase,
    workspaceId: context.access.workspaceId,
    assetUrl: lastImage.assetUrl,
    fileNameSeed: `${correlationId}-clone`,
  });

  return NextResponse.json({
    templateId: body.templateId,
    image,
    model: lastImage.model,
    provider: lastImage.provider,
    qa,
    compliance: runComplianceGate(Object.values(expectedCopy).join(" ")),
  });
}
