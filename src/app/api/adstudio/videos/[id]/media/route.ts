import { NextResponse, type NextRequest } from "next/server";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { getVideoProject } from "@/lib/adstudio/video/repository";
import { finalizeVideoUpload, prepareVideoUpload, VIDEO_MAX_BYTES, VIDEO_MIME_TYPES, type VideoMime } from "@/lib/adstudio/video/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> | { id: string } };

/** Metadata-only endpoint. Video bytes go directly to the private bucket. */
export async function POST(request: NextRequest, context: RouteContext) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const { id } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const operation = body.operation === "prepare" || body.operation === "finalize" ? body.operation : null;
  const metadata = parseMetadata(body);
  if (!operation || !metadata.ok) return NextResponse.json({ error: metadata.ok ? "Invalid media operation." : metadata.error }, { status: 400 });
  try {
    await getVideoProject({ supabase: access.supabase, workspaceId: access.access.workspaceId, userId: access.access.userId }, id);
    const ctx = { supabase: access.supabase, workspaceId: access.access.workspaceId, projectId: id };
    if (operation === "prepare") {
      const result = await prepareVideoUpload(ctx, metadata.value);
      return NextResponse.json(result, { headers: { "cache-control": "private, no-store" } });
    }
    if (typeof body.assetId !== "string" || !body.assetId) return NextResponse.json({ error: "Video reservation is required." }, { status: 400 });
    const result = await finalizeVideoUpload(ctx, body.assetId, metadata.value);
    return NextResponse.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "video_storage";
    const status = code === "video_project_not_found" || code === "video_missing" ? 404 : code.startsWith("video_invalid") || code.includes("mismatch") ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Video upload failed.", code }, { status });
  }
}

function parseMetadata(body: Record<string, unknown>): { ok: true; value: Parameters<typeof prepareVideoUpload>[1] } | { ok: false; error: string } {
  const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.toLowerCase() as VideoMime : null;
  const byteSize = typeof body.byteSize === "number" ? body.byteSize : NaN;
  const durationMs = body.durationMs === null || body.durationMs === undefined ? null : typeof body.durationMs === "number" ? body.durationMs : NaN;
  const width = body.width === null || body.width === undefined ? null : body.width;
  const height = body.height === null || body.height === undefined ? null : body.height;
  if (!/^[a-f0-9]{64}$/.test(sha256) || !mimeType || !(VIDEO_MIME_TYPES as readonly string[]).includes(mimeType) || !Number.isInteger(byteSize) || byteSize <= 0 || byteSize > VIDEO_MAX_BYTES || (durationMs !== null && (!Number.isInteger(durationMs) || !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 90_000)) || (width !== null && (!Number.isInteger(width) || Number(width) <= 0 || Number(width) > 7680)) || (height !== null && (!Number.isInteger(height) || Number(height) <= 0 || Number(height) > 7680))) {
    return { ok: false, error: `Video must be MP4 or WebM under ${VIDEO_MAX_BYTES / (1024 * 1024)} MB.` };
  }
  return { ok: true, value: { sha256, mimeType, byteSize, durationMs, width: integerOrNull(width), height: integerOrNull(height), provenance: objectOrEmpty(body.provenance), rights: objectOrEmpty(body.rights), consent: objectOrEmpty(body.consent) } };
}
function integerOrNull(value: unknown): number | null { return value === null || value === undefined ? null : Number.isInteger(value) && Number(value) > 0 ? Number(value) : null; }
function objectOrEmpty(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
