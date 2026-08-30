import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const VIDEO_BUCKET = "adstudio-videos";
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
export const VIDEO_MAX_DURATION_MS = 90_000;
export const VIDEO_MIME_TYPES = ["video/mp4", "video/webm"] as const;
export type VideoMime = (typeof VIDEO_MIME_TYPES)[number];
export type VideoValidationStatus = "pending" | "validated" | "rejected";

export type VideoStorageContext = { supabase: SupabaseClient; workspaceId: string; projectId: string };
export type VideoUploadMetadata = {
  sha256: string;
  mimeType: VideoMime;
  byteSize: number;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  posterPath?: string | null;
  provenance?: Record<string, unknown>;
  rights?: Record<string, unknown>;
  consent?: Record<string, unknown>;
};

export type PreparedVideoUpload = {
  assetId: string;
  path: string;
  token: string | null;
  reused: boolean;
  validationStatus: VideoValidationStatus;
};

export type FinalizedVideoAsset = {
  id: string;
  workspaceId: string;
  projectId: string;
  objectPath: string;
  sha256: string;
  mimeType: VideoMime;
  byteSize: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  validationStatus: VideoValidationStatus;
  validationPendingReason: string | null;
};

export class VideoStorageError extends Error {
  readonly code: "video_invalid_metadata" | "video_magic_mismatch" | "video_hash_mismatch" | "video_missing" | "video_storage";
  constructor(code: VideoStorageError["code"], message: string) { super(message); this.name = "VideoStorageError"; this.code = code; }
}

export async function prepareVideoUpload(ctx: VideoStorageContext, metadata: VideoUploadMetadata): Promise<PreparedVideoUpload> {
  validateMetadata(metadata);
  const path = buildVideoObjectPath(ctx.workspaceId, ctx.projectId, metadata.sha256, metadata.mimeType);
  const existing = await ctx.supabase.from("ad_video_assets")
    .select("id, object_path, validation_status")
    .eq("workspace_id", ctx.workspaceId).eq("project_id", ctx.projectId)
    .eq("object_path", path).maybeSingle();
  if (existing.error) throw new VideoStorageError("video_storage", existing.error.message);
  if (existing.data) return { assetId: existing.data.id, path, token: null, reused: true, validationStatus: existing.data.validation_status };

  const inserted = await ctx.supabase.from("ad_video_assets").insert({
    workspace_id: ctx.workspaceId, project_id: ctx.projectId, asset_role: "source", object_path: path,
    sha256: metadata.sha256, mime_type: metadata.mimeType, byte_size: metadata.byteSize,
    duration_ms: metadata.durationMs ?? null, width: metadata.width ?? null, height: metadata.height ?? null,
    poster_path: metadata.posterPath ?? null, provenance_json: metadata.provenance ?? {},
    rights_json: metadata.rights ?? {}, consent_json: metadata.consent ?? {}, validation_status: "pending",
  }).select("id, validation_status").single();
  if (inserted.error || !inserted.data) throw new VideoStorageError("video_storage", inserted.error?.message ?? "Video upload could not be prepared.");
  const signed = await ctx.supabase.storage.from(VIDEO_BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (signed.error || !signed.data?.token) {
    await ctx.supabase.from("ad_video_assets").delete().eq("id", inserted.data.id).eq("workspace_id", ctx.workspaceId);
    throw new VideoStorageError("video_storage", signed.error?.message ?? "Video upload URL could not be created.");
  }
  return { assetId: inserted.data.id, path, token: signed.data.token, reused: false, validationStatus: "pending" };
}

export async function finalizeVideoUpload(ctx: VideoStorageContext, assetId: string, metadata: VideoUploadMetadata): Promise<FinalizedVideoAsset> {
  validateMetadata(metadata);
  const row = await ctx.supabase.from("ad_video_assets")
    .select("id, workspace_id, project_id, object_path, sha256, mime_type, byte_size, duration_ms, width, height, validation_status")
    .eq("id", assetId).eq("workspace_id", ctx.workspaceId).eq("project_id", ctx.projectId).maybeSingle();
  if (row.error) throw new VideoStorageError("video_storage", row.error.message);
  if (!row.data) throw new VideoStorageError("video_missing", "Video upload reservation was not found.");
  const expectedPath = buildVideoObjectPath(ctx.workspaceId, ctx.projectId, metadata.sha256, metadata.mimeType);
  if (row.data.object_path !== expectedPath || row.data.sha256 !== metadata.sha256 || row.data.mime_type !== metadata.mimeType) {
    throw new VideoStorageError("video_invalid_metadata", "Video upload metadata does not match its reservation.");
  }
  const bucket = ctx.supabase.storage.from(VIDEO_BUCKET);
  const info = await bucket.info(expectedPath);
  const infoSize = info.data?.size;
  const infoMime = typeof info.data?.contentType === "string" ? info.data.contentType.toLowerCase() : null;
  if (info.error || typeof infoSize !== "number" || infoSize !== metadata.byteSize || infoSize > VIDEO_MAX_BYTES || (infoMime && infoMime !== metadata.mimeType)) {
    throw new VideoStorageError("video_invalid_metadata", "Uploaded video metadata did not match the declared file.");
  }
  const downloaded = await bucket.download(expectedPath);
  if (downloaded.error || !downloaded.data) throw new VideoStorageError("video_missing", downloaded.error?.message ?? "Uploaded video is missing.");
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  if (bytes.length !== metadata.byteSize || hashVideoBytes(bytes) !== metadata.sha256) throw new VideoStorageError("video_hash_mismatch", "Uploaded video content hash did not match.");
  if (!hasVideoMagic(bytes, metadata.mimeType)) throw new VideoStorageError("video_magic_mismatch", "Uploaded video does not match MP4/WebM magic bytes.");

  // Browser/Vercel metadata is not a codec/duration attestation. Keep the
  // asset pending until a render/validation worker records an attestation.
  const update = await ctx.supabase.from("ad_video_assets").update({
    byte_size: bytes.length, duration_ms: metadata.durationMs ?? null, width: metadata.width ?? null,
    height: metadata.height ?? null, validation_status: "pending", validation_attestation_json: {
      source: "upload_finalize", magicChecked: true, pendingReason: "worker_codec_duration_attestation_required",
    },
  }).eq("id", assetId).eq("workspace_id", ctx.workspaceId).select("id, workspace_id, project_id, object_path, sha256, mime_type, byte_size, duration_ms, width, height, validation_status").single();
  if (update.error || !update.data) throw new VideoStorageError("video_storage", update.error?.message ?? "Video upload could not be finalized.");
  return mapAsset(update.data);
}

export async function attestVideoAsset(ctx: VideoStorageContext, assetId: string, attestation: { codec: string; durationMs: number; width?: number; height?: number; worker: string }): Promise<FinalizedVideoAsset> {
  if (!attestation.codec.trim() || !Number.isFinite(attestation.durationMs) || attestation.durationMs <= 0 || attestation.durationMs > VIDEO_MAX_DURATION_MS) throw new VideoStorageError("video_invalid_metadata", "Video worker attestation is invalid.");
  const updated = await ctx.supabase.from("ad_video_assets").update({
    duration_ms: Math.round(attestation.durationMs), width: attestation.width ?? null, height: attestation.height ?? null,
    validation_status: "validated", validated_at: new Date().toISOString(), validation_attestation_json: attestation,
  }).eq("id", assetId).eq("workspace_id", ctx.workspaceId).eq("project_id", ctx.projectId)
    .select("id, workspace_id, project_id, object_path, sha256, mime_type, byte_size, duration_ms, width, height, validation_status").single();
  if (updated.error || !updated.data) throw new VideoStorageError("video_storage", updated.error?.message ?? "Video attestation could not be saved.");
  return mapAsset(updated.data);
}

export function hashVideoBytes(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
export function buildVideoObjectPath(workspaceId: string, projectId: string, sha256: string, mimeType: VideoMime): string {
  if (!isPathSegment(workspaceId) || !isPathSegment(projectId)) throw new VideoStorageError("video_invalid_metadata", "Invalid workspace or project id.");
  return `${workspaceId}/adstudio/videos/${projectId}/${sha256}.${mimeType === "video/mp4" ? "mp4" : "webm"}`;
}

export function hasVideoMagic(bytes: Uint8Array, mimeType: VideoMime): boolean {
  if (mimeType === "video/mp4") return bytes.length >= 12 && Buffer.from(bytes).subarray(4, 8).toString("ascii") === "ftyp";
  return bytes.length >= 4 && Buffer.from(bytes).subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
}

function validateMetadata(metadata: VideoUploadMetadata): void {
  if (!VIDEO_MIME_TYPES.includes(metadata.mimeType) || !/^[a-f0-9]{64}$/i.test(metadata.sha256) || !Number.isInteger(metadata.byteSize) || metadata.byteSize <= 0 || metadata.byteSize > VIDEO_MAX_BYTES) throw new VideoStorageError("video_invalid_metadata", `Video must be MP4 or WebM under ${VIDEO_MAX_BYTES / (1024 * 1024)} MB.`);
  if (metadata.durationMs !== undefined && metadata.durationMs !== null && (!Number.isFinite(metadata.durationMs) || metadata.durationMs <= 0 || metadata.durationMs > VIDEO_MAX_DURATION_MS)) throw new VideoStorageError("video_invalid_metadata", "Video duration exceeds the 90 second limit.");
}
function mapAsset(row: any): FinalizedVideoAsset {
  return { id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, objectPath: row.object_path, sha256: row.sha256, mimeType: row.mime_type, byteSize: row.byte_size, durationMs: row.duration_ms ?? null, width: row.width ?? null, height: row.height ?? null, validationStatus: row.validation_status, validationPendingReason: row.validation_status === "pending" ? "worker_codec_duration_attestation_required" : null };
}
function isPathSegment(value: string): boolean { return /^[A-Za-z0-9_-]+$/.test(value); }
