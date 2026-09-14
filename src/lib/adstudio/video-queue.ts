import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Enqueue a video job on the product's existing durable queue.
 *
 * This deliberately reuses `job_queue` rather than adding a second queue: that
 * one already provides leases, bounded retries, dead-worker reaping and a
 * stalled-job alert, and it has a workspace-scoped dedupe key. A parallel queue
 * would have needed all of that written again, and would not have been watched
 * by the existing watchdog.
 */

export const VIDEO_OPTIMISE_KIND = "adstudio.video.optimise_source";

export type VideoOptimisePayload = {
  workspaceId: string;
  projectId: string;
  assetId: string;
};

export function videoOptimiseDedupeKey(assetId: string): string {
  return `${VIDEO_OPTIMISE_KIND}:${assetId}`;
}

/**
 * Enqueue the resize for one source. Deduplicated on the asset, so a retried
 * finalise cannot queue the same work twice while a job is still open. A
 * duplicate is expected and returns `false` rather than throwing.
 */
export async function enqueueVideoOptimise(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  projectId: string;
  assetId: string;
}): Promise<boolean> {
  const { error } = await input.supabase.from("job_queue").insert({
    workspace_id: input.workspaceId,
    kind: VIDEO_OPTIMISE_KIND,
    dedupe_key: videoOptimiseDedupeKey(input.assetId),
    max_attempts: 3,
    payload: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      assetId: input.assetId,
    } satisfies VideoOptimisePayload,
  });

  if (!error) return true;
  // 23505 is the open-job unique index: the work is already queued.
  if (error.code === "23505" || /duplicate key|unique/i.test(error.message)) return false;

  // Anything else is a real failure and the caller must know, so the customer
  // is not left waiting on a copy that was never queued.
  throw new Error(`Failed to enqueue the video optimisation: ${error.message}`);
}
