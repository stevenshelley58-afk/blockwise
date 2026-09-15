/**
 * Upload limits for Ad Builder Video.
 *
 * These are deliberately separate from src/lib/upload/asset-file.ts, which is
 * image-only. A 500 MB source video must never inherit an image rule, and an
 * image rule must never be relaxed to accommodate video.
 */

/** Per-file source video ceiling. Larger files are optimised, not rejected. */
export const VIDEO_MAX_SOURCE_BYTES = 500 * 1024 * 1024;

/** Hard refusal point: beyond this a single upload is not accepted at all. */
export const VIDEO_ABSOLUTE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export const VIDEO_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/** Total accepted bytes across one project's source material. */
export const VIDEO_PROJECT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** Total number of source items on one project. */
export const VIDEO_PROJECT_MAX_SOURCE_ITEMS = 30;

/** Chunk size for the resumable server-mediated upload. */
export const VIDEO_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

/** Retained log of accepted media metadata for a supported container. */
export const VIDEO_ALLOWED_SOURCE_MIME = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const VIDEO_ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

/** Deliverable the paid order commits to. */
export const VIDEO_DELIVERABLE = {
  width: 1080,
  height: 1920,
  minDurationSeconds: 20,
  maxDurationSeconds: 30,
  container: "video/mp4",
} as const;

/**
 * Retention, approved 14 September 2026.
 * Unpaid abandoned upload projects are removed after 7 days with notice.
 * Paid source and editing files are retained 90 days after final delivery.
 * Final library videos are retained while the account is active.
 */
export const VIDEO_RETENTION = {
  abandonedUnpaidUploadDays: 7,
  paidSourceDays: 90,
} as const;

export type UploadRejectionReason =
  | "too_large"
  | "unsupported_type"
  | "type_mismatch"
  | "corrupt_media"
  | "no_video_stream"
  | "too_long"
  | "project_quota_exceeded"
  | "account_quota_exceeded";

export const UPLOAD_REJECTION_MESSAGES: Record<UploadRejectionReason, string> = {
  too_large: "That file is too large to accept. Try a shorter clip or a lower resolution export.",
  unsupported_type: "That file type is not supported. Upload MP4, MOV or WebM video.",
  type_mismatch: "The file contents do not match its file type, so it was not accepted.",
  corrupt_media: "That file could not be read as video. It may be incomplete or damaged.",
  no_video_stream: "That file has no playable video track.",
  too_long: "That video is longer than we accept for a single source clip.",
  project_quota_exceeded: "This video project has reached its source limit.",
  account_quota_exceeded: "Your account has reached its video upload limit.",
};
