import type { SupabaseClient } from "@supabase/supabase-js";
import { VIDEO_MAX_SOURCE_BYTES, VIDEO_PROJECT_MAX_SOURCE_ITEMS } from "./video-limits.ts";
import {
  sourceObjectPath,
  visibilityForKind,
  type VideoAssetKind,
  type VideoMime,
} from "./video-refs.ts";
import type { MediaInspection, UploadState } from "./video-types.ts";

/**
 * The upload ledger.
 *
 * A row is created before any bytes exist, then advances only through states
 * the server can justify:
 *
 *   initiated -> uploaded -> validating -> ready
 *                                       -> rejected
 *
 * Nothing is `ready` until server-side inspection of the actual bytes has
 * passed, so a quarantined or half-uploaded object can never be selected for
 * production. A failed upload never deletes a referenced object, and a retry
 * writes a new object version rather than overwriting a valid one.
 */

export class VideoUploadError extends Error {
  readonly kind: "invalid" | "quota" | "storage";
  readonly reason: string;
  constructor(kind: "invalid" | "quota" | "storage", reason: string, message: string) {
    super(message);
    this.kind = kind;
    this.reason = reason;
  }
}

/** States that may still be moved forward by the owning customer. */
const MUTABLE_STATES: readonly UploadState[] = ["initiated", "uploaded", "validating"];

export function canTransition(from: UploadState, to: UploadState): boolean {
  switch (from) {
    case "initiated":
      return to === "uploaded" || to === "rejected";
    case "uploaded":
      return to === "validating" || to === "rejected";
    case "validating":
      return to === "ready" || to === "rejected";
    // ready and rejected are terminal: a new attempt is a new version.
    case "ready":
    case "rejected":
      return false;
    default:
      return false;
  }
}

export function isMutable(state: UploadState): boolean {
  return MUTABLE_STATES.includes(state);
}

export type InitiateUploadInput = {
  supabase: SupabaseClient;
  workspaceId: string;
  projectId: string;
  createdBy: string;
  kind: Extract<VideoAssetKind, "source_upload">;
  mime: VideoMime;
  originalName: string;
  declaredBytes?: number;
};

export type InitiatedUpload = {
  assetId: string;
  versionId: string;
  objectPath: string;
};

/**
 * Reserve an upload slot and its object path before the bytes arrive, so an
 * interrupted transfer leaves a recoverable record rather than an orphan.
 */
export async function initiateUpload(input: InitiateUploadInput): Promise<InitiatedUpload> {
  const { supabase, workspaceId, projectId, createdBy } = input;

  // Quota and ownership are checked server-side against the project, not the
  // individual id, so a swapped project id cannot attach material elsewhere.
  const { data: project, error: projectError } = await supabase
    .from("video_projects")
    .select("id, workspace_id")
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (projectError) throw new VideoUploadError("storage", "project_lookup_failed", projectError.message);
  if (!project) throw new VideoUploadError("invalid", "project_not_found", "That video project is not available.");

  const { count, error: countError } = await supabase
    .from("video_assets")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("workspace_id", workspaceId)
    .eq("kind", "source_upload")
    .neq("upload_state", "rejected");

  if (countError) throw new VideoUploadError("storage", "quota_lookup_failed", countError.message);
  if ((count ?? 0) >= VIDEO_PROJECT_MAX_SOURCE_ITEMS) {
    throw new VideoUploadError(
      "quota",
      "project_quota_exceeded",
      "This video project has reached its source limit.",
    );
  }

  if (input.declaredBytes !== undefined && input.declaredBytes > VIDEO_MAX_SOURCE_BYTES * 4) {
    throw new VideoUploadError("invalid", "too_large", "That file is too large to accept.");
  }

  const assetId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const objectPath = sourceObjectPath({ workspaceId, projectId, assetId, versionId, mime: input.mime });

  const { error: insertError } = await supabase.from("video_assets").insert({
    id: assetId,
    workspace_id: workspaceId,
    project_id: projectId,
    version_id: versionId,
    kind: input.kind,
    visibility: visibilityForKind(input.kind),
    object_path: objectPath,
    original_name: input.originalName.slice(0, 200),
    mime_type: input.mime,
    bytes: input.declaredBytes ?? null,
    upload_state: "initiated",
    created_by: createdBy,
  });

  if (insertError) throw new VideoUploadError("storage", "ledger_insert_failed", insertError.message);

  return { assetId, versionId, objectPath };
}

export type FinaliseUploadInput = {
  supabase: SupabaseClient;
  workspaceId: string;
  projectId: string;
  assetId: string;
  inspection: MediaInspection;
};

/**
 * Move a row to `ready` or `rejected` from the result of real inspection.
 * Terminal states are never re-opened: finalising twice keeps the first answer,
 * so a retry cannot overwrite a valid asset with a later failure.
 */
export async function finaliseUpload(input: FinaliseUploadInput): Promise<{ state: UploadState }> {
  const { supabase, workspaceId, projectId, assetId, inspection } = input;

  const { data: existing, error: readError } = await supabase
    .from("video_assets")
    .select("id, upload_state, visibility, project_id, workspace_id")
    .eq("id", assetId)
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (readError) throw new VideoUploadError("storage", "ledger_read_failed", readError.message);
  if (!existing) throw new VideoUploadError("invalid", "asset_not_found", "That upload is not available.");

  const current = existing.upload_state as UploadState;
  if (!isMutable(current)) return { state: current };

  const next: UploadState = inspection.ok ? "ready" : "rejected";
  if (!canTransition(current, next)) {
    throw new VideoUploadError("invalid", "invalid_transition", `Cannot move ${current} to ${next}.`);
  }

  // One statement, guarded on the mutable states. A concurrent finalise either
  // wins outright or matches no row, so a race cannot double-settle an asset
  // and a retry can never overwrite a valid asset with a later failure.
  const { data: settledRows, error: updateError } = await supabase
    .from("video_assets")
    .update({
      upload_state: next,
      // Record what inspection observed. A rejected row keeps its reason so the
      // customer is told why, and never silently disappears.
      mime_type: inspection.mime ?? null,
      bytes: inspection.bytes ?? null,
      width: inspection.width ?? null,
      height: inspection.height ?? null,
      duration_seconds: inspection.durationSeconds ?? null,
      rejection_reason: inspection.ok ? null : (inspection.reason ?? "corrupt_media"),
      validated_at: new Date().toISOString(),
    })
    .eq("id", assetId)
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .in("upload_state", [...MUTABLE_STATES])
    .select("id");

  if (updateError) throw new VideoUploadError("storage", "ledger_update_failed", updateError.message);

  if (!settledRows || settledRows.length === 0) {
    // Another writer settled it first. Report the state that actually holds
    // rather than claiming this call decided it.
    const { data: reread } = await supabase
      .from("video_assets")
      .select("upload_state")
      .eq("id", assetId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    return { state: (reread?.upload_state as UploadState | undefined) ?? current };
  }

  return { state: next };
}

/** Ready, customer-visible source material for a project. */
export async function listReadySources(
  supabase: SupabaseClient,
  workspaceId: string,
  projectId: string,
): Promise<Array<{ id: string; objectPath: string; mime: string | null; bytes: number | null }>> {
  const { data, error } = await supabase
    .from("video_assets")
    .select("id, object_path, mime_type, bytes")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .eq("upload_state", "ready")
    .eq("visibility", "customer")
    .order("created_at", { ascending: true });

  if (error) throw new VideoUploadError("storage", "source_list_failed", error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    objectPath: row.object_path as string,
    mime: (row.mime_type as string | null) ?? null,
    bytes: (row.bytes as number | null) ?? null,
  }));
}
