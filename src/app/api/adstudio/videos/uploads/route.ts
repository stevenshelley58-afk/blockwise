import { NextResponse, type NextRequest } from "next/server";

import { readJsonBody } from "@/lib/adstudio/http";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { VIDEO_UPLOAD_CHUNK_BYTES } from "@/lib/adstudio/video-limits";
import { VIDEO_MIME_EXTENSIONS, type VideoMime } from "@/lib/adstudio/video-refs";
import { isAcceptedSourceMime } from "@/lib/adstudio/video-media-inspect";
import { initiateUpload, VideoUploadError } from "@/lib/adstudio/video-upload-ledger";
import { receivedBytes } from "@/lib/adstudio/video-upload-scratch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Begin a resumable source upload.
 *
 * The ledger row and its object path are reserved before any bytes move, so an
 * interrupted transfer leaves a recoverable record rather than an orphan and
 * the customer can resume from the offset they actually reached.
 *
 * This route deliberately creates no payment record. Uploading an existing
 * video is free, and that is enforced here rather than in the UI.
 */

type InitBody = {
  workspaceId?: string;
  projectId?: string;
  fileName?: string;
  declaredBytes?: number;
  declaredMime?: string;
};

export async function POST(request: NextRequest) {
  const body = await readJsonBody<InitBody>(request);
  const guard = await requireApiWorkspace(request, "adstudio", body.workspaceId ?? undefined);
  if (!guard.ok) return guard.response;

  const { access } = guard;
  const workspaceId = access.workspaceId;
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ error: "Choose a video first." }, { status: 400 });
  }

  const declaredMime = (body.declaredMime ?? "").trim().toLowerCase();
  if (!isAcceptedSourceMime(declaredMime) || !(declaredMime in VIDEO_MIME_EXTENSIONS)) {
    return NextResponse.json(
      { error: "Upload MP4, MOV or WebM video." },
      { status: 415 },
    );
  }

  const limited = await checkRateLimit(workspaceId, access.userId, {
    windowSeconds: 60,
    maxRequests: 40,
    bucket: "video-upload-init",
  });
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const service = createSupabaseServiceClient();

  try {
    const initiated = await initiateUpload({
      supabase: service,
      workspaceId,
      projectId,
      createdBy: access.userId,
      kind: "source_upload",
      mime: declaredMime as VideoMime,
      originalName: (body.fileName ?? "video").slice(0, 200),
      declaredBytes: typeof body.declaredBytes === "number" ? body.declaredBytes : undefined,
    });

    return NextResponse.json(
      {
        uploadId: initiated.assetId,
        chunkBytes: VIDEO_UPLOAD_CHUNK_BYTES,
        offset: await receivedBytes(initiated.assetId),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof VideoUploadError) {
      const status = error.kind === "quota" ? 409 : error.kind === "invalid" ? 400 : 500;
      return NextResponse.json({ error: error.message, reason: error.reason }, { status });
    }
    return NextResponse.json({ error: "That upload could not be started." }, { status: 500 });
  }
}
