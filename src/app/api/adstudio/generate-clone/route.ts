import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { dataUrlToUploadBytes } from "@/lib/adstudio/generated-media";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { createFalImageProvider } from "@/lib/adstudio/fal-image-provider";
import { buildCloneImageRequest } from "@/lib/adstudio/reference-clone";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import { getTemplateBrief } from "@/lib/adstudio/template-brief";
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
};

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
    const ref = suppliedImages[slot.role];
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

  // The design-to-clone is the template's public sample, made absolute so fal can fetch it.
  const referenceImage = new URL(brief.referenceImage, request.nextUrl.origin).toString();

  let request_;
  try {
    request_ = buildCloneImageRequest(brief, {
      referenceImage,
      images: resolvedImages,
      copy: body.copy,
      brandHex: body.brandHex,
    });
  } catch (error) {
    return errorResponse(error, 400);
  }

  const correlationId = randomUUID();
  try {
    const provider = createFalImageProvider({ env: process.env });
    const result = await provider.generate(request_);

    const image = await persistGeneratedImage({
      supabase: context.supabase,
      workspaceId: context.access.workspaceId,
      assetUrl: result.assetUrl,
      fileNameSeed: `${correlationId}-clone`,
    });

    return NextResponse.json({
      templateId: body.templateId,
      image,
      model: result.model,
      provider: result.providerMetadata?.provider ?? "fal",
    });
  } catch (error) {
    return errorResponse(error, 502);
  }
}

async function persistGeneratedImage(input: {
  supabase: any;
  workspaceId: string;
  assetUrl: string;
  fileNameSeed: string;
}): Promise<string> {
  if (!input.assetUrl || !input.assetUrl.startsWith("data:image/")) return input.assetUrl;
  const decoded = dataUrlToUploadBytes(input.assetUrl);
  const storagePath = `${input.workspaceId}/adstudio/clones/${input.fileNameSeed}.${decoded.extension}`;
  const { error } = await input.supabase.storage
    .from("workspace-artifacts")
    .upload(storagePath, decoded.bytes, { contentType: decoded.contentType, upsert: false });
  if (error) throw new Error("Generated clone could not be stored.");
  return `/api/adstudio/media?path=${encodeURIComponent(storagePath)}`;
}
