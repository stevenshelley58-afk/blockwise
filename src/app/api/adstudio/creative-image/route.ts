import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EnqueueBody = {
  templateKey?: string;
  imageDataUrl?: string;
  headline?: string;
  primaryText?: string;
  cta?: string;
  aspectRatio?: string;
  brand?: { businessName?: string; primary?: string; accent?: string };
};

const MEDIA_PREFIX = "/api/adstudio/media?path=";

// The agent's photo arrives as a media-proxy URL; store the underlying storage
// path so the worker can download it directly from Supabase Storage.
function storagePathFromMediaUrl(value: string | undefined): string | null {
  if (!value) return null;
  const idx = value.indexOf(MEDIA_PREFIX);
  if (idx === -1) return null;
  try {
    return decodeURIComponent(value.slice(idx + MEDIA_PREFIX.length).split("&")[0]) || null;
  } catch {
    return null;
  }
}

// POST = enqueue a high-quality generation job (a background worker does the
// actual image generation, so there is no request timeout).
export async function POST(request: NextRequest) {
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  const rateLimit = await checkRateLimit(context.supabase, context.access.workspaceId, context.access.userId, {
    windowSeconds: 3600,
    maxRequests: 60,
    bucket: "ai-creative-image",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const body = await readJsonBody<EnqueueBody>(request);
  const headline = body.headline?.trim();
  if (!headline) return NextResponse.json({ error: "A headline is required." }, { status: 400 });
  const imagePath = storagePathFromMediaUrl(body.imageDataUrl);
  if (!imagePath) return NextResponse.json({ error: "A listing photo is required." }, { status: 400 });

  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("adstudio_creative_jobs")
      .insert({
        workspace_id: context.access.workspaceId,
        created_by: context.access.userId,
        template_key: body.templateKey ?? null,
        image_path: imagePath,
        headline,
        primary_text: body.primaryText?.trim() ?? null,
        cta: body.cta?.trim() ?? null,
        aspect_ratio: body.aspectRatio || "4:5",
        brand: {
          businessName: body.brand?.businessName?.trim() ?? "",
          primary: body.brand?.primary ?? "#123e75",
          accent: body.brand?.accent ?? "#e7b24b",
        },
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not queue the ad.");
    return NextResponse.json({ jobId: data.id, status: "queued" }, { status: 202 });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

// GET ?jobId= = poll a job's status; returns the finished image URL when done.
export async function GET(request: NextRequest) {
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId is required." }, { status: 400 });

  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("adstudio_creative_jobs")
      .select("status,result_path,error")
      .eq("id", jobId)
      .eq("workspace_id", context.access.workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    const image =
      data.status === "done" && data.result_path
        ? `${MEDIA_PREFIX}${encodeURIComponent(data.result_path)}`
        : null;
    return NextResponse.json({ status: data.status, image, error: data.error ?? null });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
