import { createSupabaseServiceClient } from "../supabase/service.ts";

/**
 * Enqueue provider/background work for the VPS worker. Producers on Vercel do
 * only the workspace-fenced service-role RPC; the durable queue owns retries
 * and leases, and provider execution stays on the VPS.
 */

export async function enqueueQueuedJob(input: {
  workspaceId: string;
  kind: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  dedupeKey?: string | null;
  runAfter?: Date;
}): Promise<{ id: string | null }> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("enqueue_job_v2", {
    p_workspace_id: input.workspaceId,
    p_kind: input.kind,
    p_payload: input.payload,
    p_max_attempts: input.maxAttempts ?? 3,
    p_run_after: (input.runAfter ?? new Date()).toISOString(),
    p_dedupe_key: input.dedupeKey ?? null,
  });

  if (error) {
    throw new Error(`enqueue_job_v2 failed: ${error.message}`);
  }

  return { id: typeof data === "string" ? data : null };
}
