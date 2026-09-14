/**
 * Ad Studio Video object paths.
 *
 * Every path begins with the workspace id, so the storage policy that derives a
 * workspace from the first path segment covers this bucket exactly like
 * `workspace-artifacts`. Paths are generated server-side from authorised
 * records: an original filename is display metadata and never a path component.
 *
 * Layout inside the private `adstudio-video` bucket:
 *
 *   {workspace_id}/projects/{project_id}/sources/{asset_id}/{version_id}.{ext}
 *   {workspace_id}/projects/{project_id}/previews/{asset_id}/{version_id}.mp4
 *   {workspace_id}/projects/{project_id}/thumbnails/{asset_id}/{version_id}.jpg
 *   {workspace_id}/projects/{project_id}/production/{run_id}/project.json
 *   {workspace_id}/projects/{project_id}/production/{run_id}/review.json
 *   {workspace_id}/projects/{project_id}/drafts/{version_id}.mp4
 *   {workspace_id}/projects/{project_id}/finals/{version_id}.mp4
 */

export const VIDEO_BUCKET = "adstudio-video";
export const VIDEO_MEDIA_PREFIX = "/api/adstudio/videos/media?";

/** Mirrors the video_assets.kind check constraint. */
export const VIDEO_ASSET_KINDS = [
  "source_upload",
  "source_workspace",
  "preview",
  "thumbnail",
  "production_source",
  "draft",
  "final",
] as const;
export type VideoAssetKind = (typeof VIDEO_ASSET_KINDS)[number];

/** Production material stays operator-only even inside the owning workspace. */
export const OPERATOR_ONLY_KINDS: readonly VideoAssetKind[] = ["production_source"];

export type VideoAssetVisibility = "customer" | "operator";

export function visibilityForKind(kind: VideoAssetKind): VideoAssetVisibility {
  return OPERATOR_ONLY_KINDS.includes(kind) ? "operator" : "customer";
}

export const VIDEO_MIME_EXTENSIONS = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
} as const;
export type VideoMime = keyof typeof VIDEO_MIME_EXTENSIONS;

export const VIDEO_IMAGE_MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
export type VideoImageMime = keyof typeof VIDEO_IMAGE_MIME_EXTENSIONS;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Identity segments are server-generated: uuid, or a lowercase sha256. */
const IDENTITY_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-f0-9]{64})$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isSafeIdentitySegment(value: string): boolean {
  return IDENTITY_PATTERN.test(value);
}

export type VideoPathParts = {
  workspaceId: string;
  projectId: string;
  stage: "sources" | "previews" | "thumbnails" | "production" | "drafts" | "finals";
  /** Present for sources, previews, thumbnails and production runs. */
  assetId?: string;
  runId?: string;
  versionId?: string;
  extension: string;
};

function assertSegment(label: string, value: string): void {
  if (!isUuid(value)) throw new Error(`video path ${label} must be a uuid`);
}

export function sourceObjectPath(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  versionId: string;
  mime: VideoMime;
}): string {
  assertSegment("workspaceId", input.workspaceId);
  assertSegment("projectId", input.projectId);
  assertSegment("assetId", input.assetId);
  assertSegment("versionId", input.versionId);
  return `${input.workspaceId}/projects/${input.projectId}/sources/${input.assetId}/${input.versionId}.${VIDEO_MIME_EXTENSIONS[input.mime]}`;
}

export function previewObjectPath(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  versionId: string;
}): string {
  assertSegment("workspaceId", input.workspaceId);
  assertSegment("projectId", input.projectId);
  assertSegment("assetId", input.assetId);
  assertSegment("versionId", input.versionId);
  return `${input.workspaceId}/projects/${input.projectId}/previews/${input.assetId}/${input.versionId}.mp4`;
}

export function thumbnailObjectPath(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  versionId: string;
}): string {
  assertSegment("workspaceId", input.workspaceId);
  assertSegment("projectId", input.projectId);
  assertSegment("assetId", input.assetId);
  assertSegment("versionId", input.versionId);
  return `${input.workspaceId}/projects/${input.projectId}/thumbnails/${input.assetId}/${input.versionId}.jpg`;
}

export function productionObjectPath(input: {
  workspaceId: string;
  projectId: string;
  runId: string;
  file: "project.json" | "review.json" | "manifest.json";
}): string {
  assertSegment("workspaceId", input.workspaceId);
  assertSegment("projectId", input.projectId);
  assertSegment("runId", input.runId);
  return `${input.workspaceId}/projects/${input.projectId}/production/${input.runId}/${input.file}`;
}

export function versionObjectPath(input: {
  workspaceId: string;
  projectId: string;
  versionId: string;
  kind: "draft" | "final";
}): string {
  assertSegment("workspaceId", input.workspaceId);
  assertSegment("projectId", input.projectId);
  assertSegment("versionId", input.versionId);
  const folder = input.kind === "draft" ? "drafts" : "finals";
  return `${input.workspaceId}/projects/${input.projectId}/${folder}/${input.versionId}.mp4`;
}

/**
 * Parse a stored object path back into its parts. Returns null for anything
 * malformed, so a corrupted or hand-written database value cannot be used to
 * reach an object outside the expected layout.
 */
export function parseVideoObjectPath(value: string): VideoPathParts | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;
  if (value.startsWith("/") || value.includes("..") || value.includes("//")) return null;
  const segments = value.split("/");
  // workspaceId/projects/projectId/<stage>/...
  if (segments.length < 5) return null;
  if (segments[1] !== "projects") return null;

  const workspaceId = segments[0];
  const projectId = segments[2];
  const stage = segments[3] as VideoPathParts["stage"];
  if (!isUuid(workspaceId) || !isUuid(projectId)) return null;
  if (!["sources", "previews", "thumbnails", "production", "drafts", "finals"].includes(stage)) return null;

  const file = segments[segments.length - 1];
  const extension = file.includes(".") ? file.slice(file.lastIndexOf(".") + 1).toLowerCase() : "";
  if (extension === "" || !/^[a-z0-9]{2,8}$/.test(extension)) return null;

  if (stage === "production") {
    if (segments.length !== 6) return null;
    const runId = segments[4];
    if (!isSafeIdentitySegment(runId)) return null;
    if (!["project.json", "review.json", "manifest.json"].includes(file)) return null;
    return { workspaceId, projectId, stage, runId, extension };
  }

  if (stage === "drafts" || stage === "finals") {
    if (segments.length !== 5) return null;
    const versionId = file.slice(0, file.lastIndexOf("."));
    if (!isSafeIdentitySegment(versionId) || extension !== "mp4") return null;
    return { workspaceId, projectId, stage, versionId, extension };
  }

  // sources | previews | thumbnails: <stage>/<assetId>/<versionId>.<ext>
  if (segments.length !== 6) return null;
  const assetId = segments[4];
  if (!isSafeIdentitySegment(assetId)) return null;
  const versionId = file.slice(0, file.lastIndexOf("."));
  if (!isSafeIdentitySegment(versionId)) return null;

  if (stage === "previews" && extension !== "mp4") return null;
  if (stage === "thumbnails" && extension !== "jpg") return null;
  if (stage === "sources" && !Object.values(VIDEO_MIME_EXTENSIONS).includes(extension as never)) return null;

  return { workspaceId, projectId, stage, assetId, versionId, extension };
}

export function isPathInWorkspace(objectPath: string, workspaceId: string): boolean {
  const parts = parseVideoObjectPath(objectPath);
  return parts !== null && parts.workspaceId === workspaceId;
}

/**
 * Media references stored in the database are API routes, never a signed URL.
 * A signed URL expires, so persisting one would leave a dead reference; the
 * route re-authorises on every read and issues a short-lived link then.
 */
export function buildVideoMediaRef(input: {
  workspaceId: string;
  assetId: string;
  objectPath: string;
}): string {
  const params = new URLSearchParams({
    workspaceId: input.workspaceId,
    assetId: input.assetId,
    path: input.objectPath,
  });
  return `${VIDEO_MEDIA_PREFIX}${params.toString()}`;
}

export function parseVideoMediaRef(
  value: string,
  workspaceId: string,
): { assetId: string; path: string } | null {
  if (typeof value !== "string" || !value.startsWith(VIDEO_MEDIA_PREFIX)) return null;
  const params = new URLSearchParams(value.slice(VIDEO_MEDIA_PREFIX.length));
  if (params.get("workspaceId") !== workspaceId) return null;
  const assetId = params.get("assetId") ?? "";
  const path = params.get("path") ?? "";
  if (!isSafeIdentitySegment(assetId)) return null;
  if (!isPathInWorkspace(path, workspaceId)) return null;
  return { assetId, path };
}
