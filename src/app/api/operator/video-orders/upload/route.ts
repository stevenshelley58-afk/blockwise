import { NextResponse, type NextRequest } from "next/server";
import { openAsBlob } from "node:fs";

import { readJsonBody } from "@/lib/adstudio/http";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { UPLOAD_REJECTION_MESSAGES, VIDEO_UPLOAD_CHUNK_BYTES } from "@/lib/adstudio/video-limits";
import { inspectVideoFile } from "@/lib/adstudio/video-media-inspect";
import { VIDEO_BUCKET, VIDEO_MIME_EXTENSIONS, versionObjectPath, type VideoMime } from "@/lib/adstudio/video-refs";
import {
  appendChunk,
  discardScratch,
  readHead,
  receivedBytes,
  scratchFilePath,
  scratchFileSize,
  VideoScratchError,
} from "@/lib/adstudio/video-upload-scratch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator upload of a draft or final.
 *
 * The operator's own work is customer-visible material: a draft the customer
 * watches and a final they download. It uses the same inspected, resumable path
 * as a customer upload, so an operator upload cannot become a way to place an
 * unvalidated object in the bucket either.
 *
 * `production_source` material, meaning the edit project itself, is never
 * uploaded through here and stays operator-only.
 */

type StartBody = {
  workspaceId?: string;
  projectId?: string;
  fileName?: string;
  declaredBytes?: number;
  declaredMime?: string;
  kind?: string;
};

async function requireOperator(request: NextRequest, workspaceId?: string | null) {
  const guard = await requireApiWorkspace(request, "operator", workspaceId);
  if (!guard.ok) return { ok: false as const, response: guard.response };
  if (!guard.access.isOperator) {
    return { ok: false as const, response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  return { ok: true as const, access: guard.access };
}

export async function POST(request: NextRequest) {
  const body = await readJsonBody<StartBody>(request);
  const guard = await requireOperator(request, body.workspaceId ?? undefined);
  if (!guard.ok) return guard.response;

  const service = createSupabaseServiceClient();

  // Finalise an existing operator upload.
  if (request.nextUrl.searchParams.get("finalise") === "1") {
    const uploadId = (request.nextUrl.searchParams.get("uploadId") ?? "").trim();
    if (!uploadId) return NextResponse.json({ error: "An upload is required." }, { status: 400 });

    const { data: asset } = await service
      .from("video_assets")
      .select("id, project_id, object_path, upload_state, mime_type")
      .eq("id", uploadId)
      .maybeSingle();

    if (!asset) return NextResponse.json({ error: "That upload was not found." }, { status: 404 });
    if (asset.upload_state === "ready") return NextResponse.json({ state: "ready" });
    if (asset.upload_state === "rejected") return NextResponse.json({ state: "rejected" }, { status: 422 });

    const size = await scratchFileSize(uploadId);
    if (size <= 0) return NextResponse.json({ error: "No bytes were received for that upload." }, { status: 400 });

    const inspection = await inspectVideoFile({
      filePath: scratchFilePath(uploadId),
      sizeBytes: size,
      head: await readHead(uploadId),
      declaredMime: asset.mime_type,
    });

    if (!inspection.ok) {
      await discardScratch(uploadId);
      const reason = inspection.reason ?? "corrupt_media";
      await service
        .from("video_assets")
        .update({ upload_state: "rejected", rejection_reason: reason })
        .eq("id", uploadId);
      return NextResponse.json({ error: UPLOAD_REJECTION_MESSAGES[reason], reason }, { status: 422 });
    }

    let blob: Blob;
    try {
      blob = await openAsBlob(scratchFilePath(uploadId));
    } catch {
      return NextResponse.json({ error: "That upload could not be read." }, { status: 500 });
    }

    const uploaded = await service.storage.from(VIDEO_BUCKET).upload(asset.object_path, blob, {
      contentType: inspection.mime ?? "video/mp4",
      upsert: false,
    });
    if (uploaded.error) return NextResponse.json({ error: "That upload could not be saved." }, { status: 500 });

    const { error } = await service
      .from("video_assets")
      .update({
        upload_state: "ready",
        validated_at: new Date().toISOString(),
        bytes: size,
        width: inspection.width ?? null,
        height: inspection.height ?? null,
        duration_seconds: inspection.durationSeconds ?? null,
      })
      .eq("id", uploadId)
      .in("upload_state", ["initiated", "uploaded", "validating"]);

    if (error) {
      await service.storage.from(VIDEO_BUCKET).remove([asset.object_path]).catch(() => {});
      await discardScratch(uploadId);
      return NextResponse.json({ error: "That upload could not be finalised." }, { status: 500 });
    }

    await discardScratch(uploadId);
    return NextResponse.json({ state: "ready" });
  }

  // Begin an operator upload.
  const projectId = (body.projectId ?? "").trim();
  const kind = body.kind === "final" ? "final" : body.kind === "draft" ? "draft" : null;
  if (!projectId) return NextResponse.json({ error: "A video is required." }, { status: 400 });
  if (!kind) return NextResponse.json({ error: "A draft or final kind is required." }, { status: 400 });

  const declaredMime = (body.declaredMime ?? "").trim().toLowerCase();
  if (!(declaredMime in VIDEO_MIME_EXTENSIONS)) {
    return NextResponse.json({ error: "Upload MP4, MOV or WebM video." }, { status: 415 });
  }

  const limited = await checkRateLimit(guard.access.workspaceId, guard.access.userId, {
    windowSeconds: 60,
    maxRequests: 60,
    bucket: "video-operator-upload",
  });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const { data: project } = await service
    .from("video_projects")
    .select("id, workspace_id")
    .eq("id", projectId)
    .eq("workspace_id", guard.access.workspaceId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "That video was not found." }, { status: 404 });

  const assetId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  // The asset id is the identity segment, so a re-upload is a new object and
  // never overwrites a draft or final the customer has already been shown.
  const objectPath = versionObjectPath({
    workspaceId: guard.access.workspaceId,
    projectId,
    versionId: assetId,
    kind,
  });

  const { error: insertError } = await service.from("video_assets").insert({
    id: assetId,
    workspace_id: guard.access.workspaceId,
    project_id: projectId,
    version_id: versionId,
    kind,
    // A draft the customer reviews and a final they download are both theirs.
    visibility: "customer",
    bucket_id: VIDEO_BUCKET,
    object_path: objectPath,
    original_name: (body.fileName ?? kind).slice(0, 200),
    mime_type: declaredMime,
    bytes: typeof body.declaredBytes === "number" ? body.declaredBytes : null,
    upload_state: "initiated",
    created_by: guard.access.userId,
  });

  if (insertError) return NextResponse.json({ error: "That upload could not be started." }, { status: 500 });

  return NextResponse.json(
    { uploadId: assetId, chunkBytes: VIDEO_UPLOAD_CHUNK_BYTES, offset: await receivedBytes(assetId) },
    { status: 201 },
  );
}

export async function PUT(request: NextRequest) {
  const guard = await requireOperator(request);
  if (!guard.ok) return guard.response;

  const uploadId = (request.nextUrl.searchParams.get("uploadId") ?? "").trim();
  const offsetRaw = request.nextUrl.searchParams.get("offset");
  const expectedOffset = offsetRaw === null ? 0 : Number.parseInt(offsetRaw, 10);
  if (!uploadId || !Number.isFinite(expectedOffset) || expectedOffset < 0) {
    return NextResponse.json({ error: "A valid upload and offset are required." }, { status: 400 });
  }

  const current = await receivedBytes(uploadId);
  if (current !== expectedOffset) {
    return NextResponse.json({ error: "Upload offset does not match.", offset: current }, { status: 409 });
  }

  try {
    const total = await appendChunk({ assetId: uploadId, expectedOffset, body: request.body });
    return NextResponse.json({ offset: total });
  } catch (error) {
    if (error instanceof VideoScratchError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "That chunk could not be stored." }, { status: 500 });
  }
}
