import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { UPLOAD_REJECTION_MESSAGES } from "@/lib/adstudio/video-limits";
import { inspectVideoFile } from "@/lib/adstudio/video-media-inspect";
import { VIDEO_BUCKET } from "@/lib/adstudio/video-refs";
import { enqueueVideoOptimise } from "@/lib/adstudio/video-queue";
import { finaliseUpload, VideoUploadError } from "@/lib/adstudio/video-upload-ledger";
import {
  appendChunk,
  discardScratch,
  readHead,
  receivedBytes,
  scratchFileSize,
  scratchFilePath,
  VideoScratchError,
} from "@/lib/adstudio/video-upload-scratch";
import { openAsBlob } from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resumable source upload: one chunk at a time.
 *
 * PUT appends a chunk at an explicit offset, so a retried chunk cannot be
 * applied twice and two concurrent writers cannot interleave. GET reports the
 * offset actually received, which is what lets an interrupted mobile upload
 * resume instead of starting again.
 *
 * POST finalises: the assembled file is inspected, and only then streamed to
 * object storage and marked ready. A file that fails inspection is marked
 * rejected with a reason and its scratch copy is removed.
 */

type RouteContext = { params: Promise<{ uploadId: string }> | { uploadId: string } };

async function resolveUploadId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return (params?.uploadId ?? "").trim();
}

/** The upload row, scoped to the caller's workspace. Never trusted from input. */
async function loadUpload(workspaceId: string, uploadId: string) {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("video_assets")
    .select("id, workspace_id, project_id, object_path, upload_state, mime_type, original_name")
    .eq("id", uploadId)
    .eq("workspace_id", workspaceId)
    .eq("kind", "source_upload")
    .maybeSingle();
  if (error) throw new VideoUploadError("storage", "ledger_read_failed", error.message);
  return data;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const guard = await requireApiWorkspace(request, "adstudio");
  if (!guard.ok) return guard.response;

  const uploadId = await resolveUploadId(context);
  const upload = await loadUpload(guard.access.workspaceId, uploadId);
  if (!upload) return NextResponse.json({ error: "That upload was not found." }, { status: 404 });

  return NextResponse.json({
    uploadId: upload.id,
    state: upload.upload_state,
    offset: await receivedBytes(uploadId),
  });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const guard = await requireApiWorkspace(request, "adstudio");
  if (!guard.ok) return guard.response;

  const uploadId = await resolveUploadId(context);
  const upload = await loadUpload(guard.access.workspaceId, uploadId);
  if (!upload) return NextResponse.json({ error: "That upload was not found." }, { status: 404 });

  if (upload.upload_state === "ready" || upload.upload_state === "rejected") {
    return NextResponse.json(
      { error: "This upload has already been finalised.", state: upload.upload_state },
      { status: 409 },
    );
  }

  const limited = await checkRateLimit(guard.access.workspaceId, guard.access.userId, {
    windowSeconds: 60,
    maxRequests: 600,
    bucket: "video-upload-chunk",
  });
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const offsetRaw = request.nextUrl.searchParams.get("offset");
  const expectedOffset = offsetRaw === null ? 0 : Number.parseInt(offsetRaw, 10);
  if (!Number.isFinite(expectedOffset) || expectedOffset < 0) {
    return NextResponse.json({ error: "A valid offset is required." }, { status: 400 });
  }

  const current = await receivedBytes(uploadId);
  if (current !== expectedOffset) {
    // Tell the client exactly where the file actually is so it can resume.
    return NextResponse.json(
      { error: "Upload offset does not match.", offset: current },
      { status: 409 },
    );
  }

  try {
    const total = await appendChunk({
      assetId: uploadId,
      expectedOffset,
      body: request.body,
    });
    return NextResponse.json({ offset: total });
  } catch (error) {
    if (error instanceof VideoScratchError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "That chunk could not be stored." }, { status: 500 });
  }
}

type FinaliseBody = { totalBytes?: number };

export async function POST(request: NextRequest, context: RouteContext) {
  const guard = await requireApiWorkspace(request, "adstudio");
  if (!guard.ok) return guard.response;

  const workspaceId = guard.access.workspaceId;
  const uploadId = await resolveUploadId(context);
  const upload = await loadUpload(workspaceId, uploadId);
  if (!upload) return NextResponse.json({ error: "That upload was not found." }, { status: 404 });

  // Already settled: report the existing verdict rather than inspecting again,
  // so a repeated finalise cannot turn a valid asset into a failure.
  if (upload.upload_state === "ready" || upload.upload_state === "rejected") {
    return NextResponse.json({ state: upload.upload_state });
  }

  let body: FinaliseBody = {};
  try {
    body = (await request.json()) as FinaliseBody;
  } catch {
    body = {};
  }

  const service = createSupabaseServiceClient();
  const size = await scratchFileSize(uploadId);

  if (size <= 0) {
    return NextResponse.json({ error: "No bytes were received for that upload." }, { status: 400 });
  }
  if (typeof body.totalBytes === "number" && body.totalBytes !== size) {
    // A short file must never be treated as complete.
    return NextResponse.json(
      { error: "The upload is incomplete.", offset: size },
      { status: 409 },
    );
  }

  const head = await readHead(uploadId);
  const inspection = await inspectVideoFile({
    filePath: scratchFilePath(uploadId),
    sizeBytes: size,
    head,
    declaredMime: upload.mime_type,
  });

  if (!inspection.ok) {
    await discardScratch(uploadId);
    const reason = inspection.reason ?? "corrupt_media";
    await finaliseUpload({ supabase: service, workspaceId, projectId: upload.project_id, assetId: uploadId, inspection });
    return NextResponse.json(
      { error: UPLOAD_REJECTION_MESSAGES[reason], reason },
      { status: 422 },
    );
  }

  // Stream from disk: a 500 MB source is never buffered in memory.
  let blob: Blob;
  try {
    blob = await openAsBlob(scratchFilePath(uploadId));
  } catch {
    return NextResponse.json({ error: "That upload could not be read." }, { status: 500 });
  }

  const uploaded = await service.storage
    .from(VIDEO_BUCKET)
    .upload(upload.object_path, blob, {
      contentType: inspection.mime ?? "video/mp4",
      // The path carries a fresh version id, so an existing object at this path
      // would mean a collision rather than a retry.
      upsert: false,
    });

  if (uploaded.error) {
    return NextResponse.json({ error: "That upload could not be saved." }, { status: 500 });
  }

  try {
    const settled = await finaliseUpload({
      supabase: service,
      workspaceId,
      projectId: upload.project_id,
      assetId: uploadId,
      inspection,
    });

    // A large source is already accepted and downloadable; resizing is minutes
    // of CPU and belongs in the worker, not in this request. Enqueue failure is
    // reported rather than swallowed, because the customer has just been told a
    // lighter copy is coming.
    if (inspection.needsOptimisation === true) {
      try {
        await enqueueVideoOptimise({
          supabase: service,
          workspaceId,
          projectId: upload.project_id,
          assetId: uploadId,
        });
      } catch (enqueueError) {
        console.error("video optimisation enqueue failed", {
          reason: enqueueError instanceof Error ? enqueueError.message : "unknown",
        });
      }
    }

    await discardScratch(uploadId);
    return NextResponse.json({
      state: settled.state,
      needsOptimisation: inspection.needsOptimisation === true,
    });
  } catch (error) {
    // The object exists but the ledger did not advance. Remove the object so a
    // retry starts clean rather than leaving an unreferenced copy behind.
    await service.storage.from(VIDEO_BUCKET).remove([upload.object_path]).catch(() => {});
    await discardScratch(uploadId);
    const message = error instanceof VideoUploadError ? error.message : "That upload could not be finalised.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
